/**
 * Combattants dessinés par des modèles glTF animés à la main (docs : `assets/fighters/README.md`).
 * Même interface que les figurines (`FighterVisuals`) : le renderer ne voit pas la différence.
 *
 * Le temps de chaque clip se calcule à partir de l'état lu dans la simulation (action, frame
 * d'action, distance parcourue), jamais d'une horloge murale : l'image reste juste en pause, au
 * ralenti, image par image et après un rollback, comme celle des figurines. Une attaque est étirée
 * sur sa durée en frames : le clip suit la frame data même si sa longueur diffère un peu.
 *
 * Un joueur dont le personnage n'a pas de modèle chargé garde la figurine (`fallback`) : on peut
 * mêler figurines et modèles dans un même match, et ajouter les modèles un par un.
 */
import {
  A_AIR,
  A_ATTACK,
  A_DASH,
  A_DEAD,
  A_HITSTUN,
  A_RUN,
  A_WALK,
  createFighterView,
  fxToFloat,
  type FighterDef,
  type FighterView,
} from '@game/sim-core';
import {
  AnimationMixer,
  Color,
  Group,
  Material,
  Mesh,
  MeshStandardMaterial,
  SkinnedMesh,
  Vector3,
  type AnimationAction,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { QualityPreset } from '../quality.ts';
import {
  AIR_DOUBLE,
  AIR_FALL,
  AIR_RISE,
  CHARGE_SUFFIX,
  LOOP_CLIPS,
  STRIDE_CLIPS,
  clipCandidates,
} from './clips.ts';
import { blendFrames } from './driver.ts';
import { OUTLINE, entrance, outlineMaterial } from './figurine.ts';
import { fighterModel, type FighterModel, type MaterialVariant } from './model.ts';
import { actionTiming, createPoseInput, displayFrame, type PoseInput } from './poses.ts';
import { squashOf, type Squash } from './squash.ts';
import { PLAYER_COLORS, type FighterVisuals, type FighterVisualsFactory } from './visual.ts';

/** Nom de la matière teinte à la couleur du joueur. */
export const PLAYER_MATERIAL = 'player';

/** Frames de la simulation par seconde : un clip non étiré se déroule à cette cadence. */
const FPS = 60;
/** Rotation vers la caméra, comme les figurines : on voit les visages de trois quarts. */
const FACE_CAMERA = 0.35;
/** Fondu quand le clip change sans que l'action change (montée puis chute, fin de charge). */
const SOFT_BLEND = 4;
/** Part de blanc mêlée à la couleur d'un combattant intangible. */
const PALE_MIX = 0.6;

const smooth = (t: number): number => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};
const isStride = (action: number): boolean =>
  action === A_WALK || action === A_RUN || action === A_DASH;

/** Premier clip de `names` présent dans le modèle (`idle` est toujours en dernier recours). */
function resolve(model: FighterModel, names: readonly string[]): string {
  for (let i = 0; i < names.length; i++) if (model.clips.has(names[i]!)) return names[i]!;
  return model.names[0] ?? '';
}

interface Uniforms {
  readonly uFlash: { value: number };
  readonly uPale: { value: number };
}

/**
 * Copie d'une matière pour un joueur : éclat blanc d'impact et pâleur d'intangibilité ajoutés au
 * shader, couleur alternative appliquée par nom de matière. La matière nommée `player` prend la
 * couleur du joueur (bandeau, écharpe…), comme la zone du même nom des figurines.
 */
function playerMaterial(
  source: Material,
  uniforms: Uniforms,
  variant: MaterialVariant,
  player: number,
): Material {
  const material = source.clone();
  const tint =
    material.name === PLAYER_MATERIAL
      ? PLAYER_COLORS[player % PLAYER_COLORS.length]
      : variant[material.name];
  if (tint !== undefined && 'color' in material && material.color instanceof Color) {
    material.color.set(tint);
  }
  if (material instanceof MeshStandardMaterial) {
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uFlash;\nuniform float uPale;',
        )
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb = mix( diffuseColor.rgb, vec3( 1.0 ), uPale );',
        )
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3( uFlash );',
        );
    };
    material.customProgramCacheKey = () => 'gltf-fighter';
  }
  return material;
}

/** Les deux clips joués (le précédent en fondu sortant) et leur réglage. */
interface Slot {
  name: string;
  bank: number;
  time: number;
}

interface Instance {
  readonly model: FighterModel;
  readonly def: FighterDef;
  readonly anchor: Group;
  readonly body: Group;
  readonly mixer: AnimationMixer;
  readonly actions: ReadonlyMap<string, readonly [AnimationAction, AnimationAction]>;
  readonly uniforms: Uniforms;
  readonly outlines: readonly Mesh[];
  readonly materials: readonly Material[];
  readonly copy: Object3D;
  readonly timing: PoseInput;
  readonly scale: number;
  readonly cur: Slot;
  readonly prev: Slot;
  /** Actions activées à la dernière image, à couper à la suivante. */
  shownA: AnimationAction | null;
  shownB: AnimationAction | null;
  hasPrev: boolean;
  fresh: boolean;
  action: number;
  frame: number;
  move: number;
  prevAction: number;
  prevFrame: number;
  age: number;
  blend: number;
  /** Frames simulées hors gel d'impact : l'horloge des clips en boucle. */
  clock: number;
  /** Frames simulées depuis le début (entrée en scène). */
  life: number;
  stride: number;
  prevStride: number;
  doubleJump: boolean;
  pale: boolean;
}

function createInstance(
  model: FighterModel,
  def: FighterDef,
  variantIndex: number,
  player: number,
): Instance {
  const copy = cloneSkinned(model.scene);
  copy.name = `model-${player}`;
  const uniforms: Uniforms = { uFlash: { value: 0 }, uPale: { value: 0 } };
  const variant = model.variants[variantIndex % model.variants.length] ?? {};
  const copies = new Map<Material, Material>();
  const materials: Material[] = [];
  const own = (m: Material): Material => {
    let c = copies.get(m);
    if (c === undefined) {
      c = playerMaterial(m, uniforms, variant, player);
      copies.set(m, c);
      materials.push(c);
    }
    return c;
  };
  // Contour : la même peau gonflée le long des normales, comme les figurines, sur les maillages
  // skinnés seulement (les petites pièces fixes, yeux ou bijoux, n'en ont pas). Son épaisseur se
  // donne dans le repère de chaque maillage, d'où la division par son échelle dans le modèle.
  const meshes: Mesh[] = [];
  copy.traverse((o) => {
    if (o instanceof Mesh) meshes.push(o);
  });
  const outlines: Mesh[] = [];
  const worldScale = new Vector3();
  for (const mesh of meshes) {
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
    mesh.frustumCulled = false;
    if (!(mesh instanceof SkinnedMesh) || mesh.parent === null) continue;
    if (mesh.geometry.getAttribute('normal') === undefined) continue;
    mesh.getWorldScale(worldScale);
    const line = outlineMaterial((OUTLINE * model.height) / Math.max(1e-6, worldScale.y));
    materials.push(line);
    const outline = new SkinnedMesh(mesh.geometry, line);
    outline.bind(mesh.skeleton, mesh.bindMatrix);
    outline.name = `${mesh.name}-outline`;
    outline.position.copy(mesh.position);
    outline.quaternion.copy(mesh.quaternion);
    outline.scale.copy(mesh.scale);
    outline.frustumCulled = false;
    outline.visible = false;
    outline.userData.noShadow = true;
    mesh.parent.add(outline);
    outlines.push(outline);
  }

  const mixer = new AnimationMixer(copy);
  const actions = new Map<string, readonly [AnimationAction, AnimationAction]>();
  for (const [name, [a, b]] of model.clips) {
    const pair = [mixer.clipAction(a), mixer.clipAction(b)] as const;
    for (const act of pair) {
      act.play();
      act.paused = true;
      act.enabled = false;
    }
    actions.set(name, pair);
  }

  const body = new Group();
  body.name = 'body';
  body.add(copy);
  const anchor = new Group();
  anchor.name = `fighter-${player}`;
  anchor.visible = false;
  anchor.add(body);
  return {
    model,
    def,
    anchor,
    body,
    mixer,
    actions,
    uniforms,
    outlines,
    materials,
    copy,
    timing: createPoseInput(),
    scale: fxToFloat(def.height) / model.height,
    cur: { name: '', bank: 0, time: 0 },
    prev: { name: '', bank: 0, time: 0 },
    shownA: null,
    shownB: null,
    hasPrev: false,
    fresh: true,
    action: -1,
    frame: 0,
    move: 0,
    prevAction: -1,
    prevFrame: 0,
    age: 0,
    blend: 1,
    clock: 0,
    life: 0,
    stride: 0,
    prevStride: 0,
    doubleJump: false,
    pale: false,
  };
}

/** Passe au clip `name` en fondant le précédent sur `blend` frames. */
function switchClip(it: Instance, name: string, blend: number): void {
  if (it.fresh) {
    it.cur.name = name;
    it.fresh = false;
    it.hasPrev = false;
  } else {
    it.prev.name = it.cur.name;
    it.prev.bank = it.cur.bank;
    it.prev.time = it.cur.time;
    it.cur.name = name;
    // L'autre exemplaire du clip : un clip peut se fondre dans lui-même (jab après jab).
    it.cur.bank = it.prev.bank ^ 1;
    it.hasPrev = it.prev.name !== '';
  }
  it.age = 0;
  it.blend = blend;
}

function capture(
  it: Instance,
  view: FighterView,
  swing: FighterDef['moves'][number] | undefined,
): void {
  const restarted =
    view.action !== it.action || view.actionFrame < it.frame || view.move !== it.move;
  if (restarted) {
    it.doubleJump = view.action === A_AIR && it.action === A_AIR && view.velY > 0;
    actionTiming(it.def, view.action, view.move, it.timing, swing);
    if (!(isStride(view.action) && isStride(it.action))) {
      it.stride = 0;
      it.prevStride = 0;
    }
    it.prevAction = -1;
  } else {
    it.prevAction = it.action;
  }
  if (view.action === A_AIR && view.velY <= 0) it.doubleJump = false;
  const charging =
    view.action === A_ATTACK && view.charge > 0 && !restarted && view.actionFrame === it.frame;
  const air = it.doubleJump ? AIR_DOUBLE : view.velY > 0 ? AIR_RISE : AIR_FALL;
  const name = resolve(it.model, clipCandidates(view.action, view.move, air, charging));
  if (restarted) switchClip(it, name, blendFrames(view.action));
  else if (name !== it.cur.name) switchClip(it, name, SOFT_BLEND);

  it.prevStride = it.stride;
  if (isStride(view.action)) it.stride += Math.abs(view.velX) / fxToFloat(it.def.height);
  it.prevFrame = it.frame;
  it.action = view.action;
  it.frame = view.actionFrame;
  it.move = view.move;
  it.age++;
  it.life++;
  if (view.hitlag === 0) it.clock++;
}

/** Temps du clip courant, en secondes, à l'instant `alpha` entre les deux dernières frames. */
function clipTime(it: Instance, duration: number, alpha: number, frozen: boolean): number {
  const name = it.cur.name;
  if (duration <= 0) return 0;
  if (LOOP_CLIPS.has(name) || name.endsWith(CHARGE_SUFFIX)) {
    if (STRIDE_CLIPS.has(name) && isStride(it.action)) {
      const cycle = name === 'walk' ? it.model.walkCycle : it.model.runCycle;
      const s = it.prevStride + (it.stride - it.prevStride) * alpha;
      const t = (s / cycle) % 1;
      return t * duration;
    }
    const clock = it.clock - 1 + (frozen ? 1 : alpha);
    return (((Math.max(0, clock) / FPS) % duration) + duration) % duration;
  }
  const f = displayFrame(it.prevAction, it.prevFrame, it.action, it.frame, alpha);
  const total = it.timing.total;
  if (total > 0) return Math.min(1, Math.max(0, f / total)) * duration;
  return Math.min(duration, Math.max(0, f / FPS));
}

function show(it: Instance, alpha: number, frozen: boolean): void {
  const cur = it.actions.get(it.cur.name)?.[it.cur.bank] ?? null;
  const prev = it.hasPrev ? (it.actions.get(it.prev.name)?.[it.prev.bank] ?? null) : null;
  if (it.shownA !== null && it.shownA !== cur && it.shownA !== prev) it.shownA.enabled = false;
  if (it.shownB !== null && it.shownB !== cur && it.shownB !== prev) it.shownB.enabled = false;
  const w = prev === null ? 1 : smooth((it.age - 1 + alpha) / it.blend);
  if (cur !== null) {
    it.cur.time = clipTime(it, cur.getClip().duration, alpha, frozen);
    cur.enabled = true;
    cur.time = it.cur.time;
    cur.setEffectiveWeight(w);
  }
  if (prev !== null) {
    if (w >= 1) {
      prev.enabled = false;
      it.hasPrev = false;
    } else {
      prev.enabled = true;
      prev.time = it.prev.time;
      prev.setEffectiveWeight(1 - w);
    }
  }
  it.shownA = cur;
  it.shownB = it.hasPrev ? prev : null;
  it.mixer.update(0);
}

/**
 * Combattants glTF : `modelOf(player)` donne le chemin du modèle du joueur (relatif à l'adresse des
 * assets, par exemple `fighters/sorel/model.glb`) ou `undefined` ; `variantOf(player)` sa couleur
 * alternative. Les joueurs sans modèle prêt sont dessinés par `fallback` (les figurines).
 */
export function createGltfFighters(
  modelOf: (player: number) => string | undefined,
  fallback: FighterVisualsFactory,
  variantOf: (player: number) => number = () => 0,
): FighterVisualsFactory {
  return (config) => {
    const players = config.fighters.length;
    const root = new Group();
    root.name = 'fighters';
    const backup = fallback(config);
    root.add(backup.root);
    const swing = config.entities?.find((def) => def.item?.swing !== undefined)?.item?.swing;
    // Vue « hors jeu » donnée à la figurine des joueurs dessinés par un modèle : elle se cache.
    const hidden = createFighterView();
    hidden.action = A_DEAD;

    const instances: (Instance | null)[] = [];
    for (let p = 0; p < players; p++) {
      const path = modelOf(p);
      const model = path === undefined ? undefined : fighterModel(path);
      if (model === undefined || model.clips.size === 0) {
        instances.push(null);
        continue;
      }
      const it = createInstance(model, config.fighters[p]!, variantOf(p), p);
      root.add(it.anchor);
      instances.push(it);
    }
    const squash: Squash = { y: 1 };

    return {
      root,

      capture(player, view) {
        const it = instances[player];
        if (it == null) backup.capture(player, view);
        else capture(it, view, swing);
      },

      update(player, x, y, view, alpha) {
        const it = instances[player];
        if (it == null) {
          backup.update(player, x, y, view, alpha);
          return;
        }
        backup.update(player, x, y, hidden, alpha);
        it.anchor.visible = view.action !== A_DEAD;
        if (!it.anchor.visible) return;
        it.anchor.position.set(x, y, 0);
        // Les modèles glTF regardent vers +z : un quart de tour les tourne vers +x (la droite).
        it.body.rotation.y =
          view.facing === 1 ? Math.PI / 2 - FACE_CAMERA : -Math.PI / 2 + FACE_CAMERA;

        const frozen = view.hitlag > 0;
        show(it, alpha, frozen);

        // Écrasement et étirement depuis les pieds, entrée en scène : comme les figurines.
        const f = displayFrame(it.prevAction, it.prevFrame, it.action, it.frame, alpha);
        squashOf(view.action, f, it.timing.total, view.velY, view.hitlag, squash);
        const appear = entrance(it.life - 1 + alpha);
        const s = it.scale * appear;
        it.body.scale.set(s / Math.sqrt(squash.y), s * squash.y, s / Math.sqrt(squash.y));

        if (view.intangible !== it.pale) {
          it.pale = view.intangible;
          it.uniforms.uPale.value = it.pale ? PALE_MIX : 0;
        }
        it.uniforms.uFlash.value =
          view.action === A_HITSTUN && view.hitlag > 0 ? (view.hitlag % 4 < 2 ? 0.9 : 0.35) : 0;
      },

      theme(player) {
        return backup.theme?.(player);
      },

      setQuality(preset: QualityPreset) {
        backup.setQuality?.(preset);
        const lines = preset.quality === 'high' || preset.quality === 'ultra';
        for (const it of instances) if (it !== null) for (const o of it.outlines) o.visible = lines;
      },

      dispose() {
        backup.dispose();
        for (const it of instances) {
          if (it === null) continue;
          it.mixer.stopAllAction();
          it.mixer.uncacheRoot(it.copy);
          for (const m of it.materials) m.dispose();
          it.copy.traverse((o) => {
            if (o instanceof SkinnedMesh) o.skeleton.dispose();
          });
        }
      },
    } satisfies FighterVisuals;
  };
}
