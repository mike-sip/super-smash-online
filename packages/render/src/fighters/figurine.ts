/**
 * Figurines (SPEC-visuals.md, phase 3) : des corps lisses déformés par un squelette, à la place
 * des mannequins en boîtes. Même interface (`FighterVisuals`), mêmes poses (`driver.ts`).
 *
 * Pour chaque personnage, les volumes (`body.ts`) sont convertis une fois en maillage, puis gardés
 * en mémoire pour les renderers suivants. Chaque joueur a son squelette et sa matière ; la couleur
 * d'un sommet vient de sa zone et de la palette du joueur, dans le shader.
 *
 * Appels de dessin par joueur : le corps, son ombre, et son contour en qualité haute ; les yeux et
 * les bouches de tous les joueurs tiennent en deux appels.
 */
import { A_ATTACK, A_DEAD, A_HITSTUN, A_ITEM_SWING, fxToFloat } from '@game/sim-core';
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Mesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SkinnedMesh,
  SphereGeometry,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { QualityPreset } from '../quality.ts';
import { figurineSculpt, paletteOf, type FigurineStyle, type VfxTheme } from './body.ts';
import { createPoseDriver, type PoseDriver } from './driver.ts';
import { createChain, resetChain, stepChain, type Chain } from './dynamics.ts';
import { squashOf, type Squash } from './squash.ts';
import { createTrails } from './trails.ts';
import { isTeleport } from '../interpolation.ts';
import { createExpression, expressionOf } from './face.ts';
import { dimsOf, type Dims } from './mannequin.ts';
import { meshSculpt, type MeshData } from './mesher.ts';
import { SPIN_PIVOT_Y, type Pose } from './poses.ts';
import { ZONES, compileSculpt, type ZoneName } from './sdf.ts';
import { createRig, type Rig } from './skeleton.ts';
import { PLAYER_COLORS, type FighterVisuals, type FighterVisualsFactory } from './visual.ts';

/** Côté d'une cellule du maillage, en hauteurs de combattant. */
const CELL = 1 / 60;
/** Rotation du corps vers la caméra : on voit les visages de trois quarts, comme dans le genre. */
const FACE_CAMERA = 0.35;
/** La tête se tourne encore un peu plus : le visage se lit, la silhouette du corps reste fidèle. */
const HEAD_TURN = 0.5;
/** Couleur des traînées de coups par thème d'effets (en lumière). */
const TRAIL_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
  wind: [1.5, 2.5, 2.7],
  feather: [2.7, 2.2, 1.4],
  ember: [3.6, 1.4, 0.3],
  pearl: [2.2, 2.4, 2.7],
};
/** Bouts des membres qui peuvent frapper : os et point de frappe dans son repère. */
const STRIKERS = [
  ['handF', 0, -0.05, 0],
  ['handB', 0, -0.05, 0],
  ['footF', 0.06, -0.015, 0],
  ['footB', 0.06, -0.015, 0],
] as const;

/** Vrai pendant les frames actives d'un coup (une frame de marge de part et d'autre). */
export function striking(action: number, frame: number, start: number, end: number): boolean {
  return (
    (action === A_ATTACK || action === A_ITEM_SWING) &&
    start > 0 &&
    frame >= start - 1 &&
    frame <= end + 1
  );
}

/** Durée de l'entrée en scène, en frames. */
const ENTRANCE_FRAMES = 30;

/** Échelle de la figurine pendant son entrée en scène : de 0 à 1 avec un léger dépassement. */
export function entrance(time: number): number {
  if (time >= ENTRANCE_FRAMES) return 1;
  const t = Math.max(0, time) / ENTRANCE_FRAMES - 1;
  return 1 + 2.4 * t * t * t + 1.4 * t * t;
}

/** Saut de temps au-delà duquel les ressorts repartent du repos, en frames. */
const MAX_SPRING_STEP = 4;
/** Part du balancement des cheveux reprise par la jupe, plus lourde. */
const SKIRT_SWAY = 0.6;
/** Épaisseur du contour, en hauteurs de combattant. */
const OUTLINE = 0.007;
/** Part de blanc mêlée à la couleur d'un combattant intangible. */
const PALE_MIX = 0.6;

/** Maillages déjà calculés, par style (objet figé du module `fighters`) : calculés une fois. */
const meshCache = new WeakMap<object, MeshData>();
const DEFAULT_KEY = {};

function meshFor(style: FigurineStyle | undefined, d: Dims, rig: Rig): MeshData {
  const key = style ?? DEFAULT_KEY;
  let mesh = meshCache.get(key);
  if (mesh === undefined) {
    mesh = meshSculpt(compileSculpt(figurineSculpt(d, style), rig.bind), CELL);
    meshCache.set(key, mesh);
  }
  return mesh;
}

function geometryOf(mesh: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  g.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  g.setAttribute('aZone', new BufferAttribute(mesh.zones, 1));
  g.setAttribute('aZone2', new BufferAttribute(mesh.zones2, 1));
  g.setAttribute('aZoneMix', new BufferAttribute(mesh.zoneMix, 1));
  g.setAttribute('skinIndex', new BufferAttribute(mesh.skinIndex, 4));
  g.setAttribute('skinWeight', new BufferAttribute(mesh.skinWeight, 4));
  g.setIndex(new BufferAttribute(mesh.index, 1));
  g.computeBoundingSphere();
  return g;
}

interface FigurineUniforms {
  readonly uPalette: { value: Color[] };
  readonly uPale: { value: number };
  readonly uFlash: { value: number };
  /** Intensité de la zone qui rayonne (0 : aucune zone ne rayonne). */
  readonly uGlow: { value: number };
}

/** Rayonnement de la zone incandescente, au repos et en pleine charge. */
const GLOW_IDLE = 0.6;
const GLOW_CHARGED = 4;
/** Frames de charge au bout desquelles l'embrasement est complet. */
const CHARGE_FULL = 40;

/**
 * Matière d'un joueur : couleur par zone (palette), pâleur d'intangibilité, éclat d'impact, zone
 * qui rayonne et zone irisée (indices de zone, -1 pour aucune).
 */
function figurineMaterial(
  palette: readonly number[],
  emissiveZone: number,
  iridescentZone: number,
): { material: MeshStandardMaterial; uniforms: FigurineUniforms } {
  const uniforms: FigurineUniforms = {
    uPalette: { value: palette.map((c) => new Color(c)) },
    uPale: { value: 0 },
    uFlash: { value: 0 },
    uGlow: { value: emissiveZone >= 0 ? GLOW_IDLE : 0 },
  };
  const zoneWeight = (target: number): string =>
    target < 0
      ? '0.0'
      : `mix( step( abs( aZone - ${target}.0 ), 0.5 ), step( abs( aZone2 - ${target}.0 ), 0.5 ), aZoneMix )`;
  const material = new MeshStandardMaterial({ roughness: 0.58, metalness: 0, vertexColors: true });
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'attribute float aZone;',
          'attribute float aZone2;',
          'attribute float aZoneMix;',
          `uniform vec3 uPalette[ ${palette.length} ];`,
          'uniform float uPale;',
          'varying vec3 vZoneColor;',
          'varying float vGlowZone;',
          'varying float vIridZone;',
        ].join('\n'),
      )
      .replace(
        '#include <color_vertex>',
        [
          '#include <color_vertex>',
          'vec3 zoneColor = mix( uPalette[ int( aZone + 0.5 ) ], uPalette[ int( aZone2 + 0.5 ) ], aZoneMix );',
          'vColor.rgb = mix( zoneColor, vec3( 1.0 ), uPale );',
          'vZoneColor = zoneColor;',
          `vGlowZone = ${zoneWeight(emissiveZone)};`,
          `vIridZone = ${zoneWeight(iridescentZone)};`,
        ].join('\n'),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform float uFlash;',
          'uniform float uGlow;',
          'varying vec3 vZoneColor;',
          'varying float vGlowZone;',
          'varying float vIridZone;',
        ].join('\n'),
      )
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          'totalEmissiveRadiance += vec3( uFlash ) + vZoneColor * vGlowZone * uGlow;',
          // Irisation : un arc-en-ciel discret qui glisse avec l'angle de vue.
          'float iridFacing = 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) );',
          'vec3 rainbow = 0.5 + 0.5 * cos( 6.2832 * ( iridFacing * 1.3 + vec3( 0.0, 0.33, 0.67 ) ) );',
          'totalEmissiveRadiance += rainbow * vIridZone * ( 0.12 + 0.45 * iridFacing * iridFacing );',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => `figurine|${emissiveZone}|${iridescentZone}`;
  return { material, uniforms };
}

/** Contour : la même peau, gonflée le long des normales, vue de dos, sombre. */
function outlineMaterial(): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ color: 0x12141b, side: BackSide });
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uOutline = { value: OUTLINE };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutline;')
      .replace(
        '#include <skinning_vertex>',
        '#include <skinning_vertex>\ntransformed += normalize( objectNormal ) * uOutline;',
      );
  };
  material.customProgramCacheKey = () => 'figurine-outline';
  return material;
}

interface Body {
  readonly anchor: Group;
  readonly pose: Group;
  readonly rig: Rig;
  readonly mesh: SkinnedMesh;
  readonly outline: SkinnedMesh;
  readonly uniforms: FigurineUniforms;
  readonly driver: PoseDriver;
  readonly scale: number;
  readonly headRadius: number;
  readonly glows: boolean;
  readonly theme: VfxTheme | undefined;
  clock: number;
  /** Instant de la dernière image (frames) et action vue, pour les ressorts. */
  lastTime: number;
  lastAction: number;
  readonly hair: Chain;
  readonly cloth: Chain;
  readonly skirt: Chain;
  /** Membre qui frappe (indice dans STRIKERS, -1 : aucun) et position précédente des bouts. */
  striker: number;
  readonly tips: Float64Array;
  pale: boolean;
}

/** Une figurine seule, hors combat : pour les portraits et l'écran de victoire (phase 7). */
export interface FigurineModel {
  /** Repère du corps, à l'échelle d'un combattant d'une hauteur 1 (pieds à l'origine). */
  readonly root: Group;
  /** Oriente le squelette selon `pose`, tête tournée de `headTurn`, visage selon `face`. */
  apply(pose: Pose, headTurn: number, eyes: number, mouth: number): void;
  setQuality(outline: boolean): void;
  dispose(): void;
}

export function createFigurineModel(
  style: FigurineStyle | undefined,
  variant: number,
  player = 0,
): FigurineModel {
  const d = dimsOf(style);
  const rig = createRig(d);
  const geometry = geometryOf(meshFor(style, d, rig));
  const zone = (name: ZoneName | undefined): number =>
    name === undefined ? -1 : ZONES.indexOf(name);
  const { material } = figurineMaterial(
    paletteOf(style, player, variant),
    zone(style?.emissive),
    zone(style?.iridescent),
  );
  const mesh = new SkinnedMesh(geometry, material);
  const outline = outlineMaterial();
  const line = new SkinnedMesh(geometry, outline);
  rig.root.add(mesh, line);
  mesh.bind(rig.skeleton);
  line.bind(rig.skeleton);
  mesh.frustumCulled = false;
  line.frustumCulled = false;

  // Visage : pièces portées par l'os de la tête (mêmes places que dans le combat).
  const ball = new SphereGeometry(1, 16, 12);
  const white = new MeshStandardMaterial({ color: 0xfbfaf7, roughness: 0.35 });
  const dark = new MeshStandardMaterial({ color: 0x15131a, roughness: 0.25 });
  const head = rig.bone('head');
  const r = d.headRadius;
  const eyes: Mesh[] = [];
  const pupils: Mesh[] = [];
  for (const z of [0.36, -0.36]) {
    const e = new Mesh(ball, white);
    e.position.set(0.8 * r, 1.06 * r, z * r);
    const p = new Mesh(ball, dark);
    p.position.set(0.93 * r, 1.05 * r, z * 1.04 * r);
    head.add(e, p);
    eyes.push(e);
    pupils.push(p);
  }
  const mouth = new Mesh(ball, dark);
  mouth.position.set(0.9 * r, 0.62 * r, 0);
  head.add(mouth);

  const root = new Group();
  root.scale.setScalar(d.normalize);
  root.add(rig.root);
  return {
    root,
    apply(pose, headTurn, open, talk) {
      rig.apply(pose, headTurn);
      for (const e of eyes) e.scale.set(0.2 * r, 0.27 * r * open, 0.15 * r);
      for (const p of pupils) p.scale.set(0.11 * r, 0.16 * r * open, 0.09 * r);
      mouth.scale.set(0.05 * r, (0.03 + 0.09 * talk) * r, (0.12 + 0.03 * talk) * r);
      root.updateMatrixWorld(true);
    },
    setQuality(lines) {
      line.visible = lines;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      outline.dispose();
      ball.dispose();
      white.dispose();
      dark.dispose();
      rig.skeleton.dispose();
    },
  };
}

/**
 * Figurines : `styleOf(player)` donne le style de chaque joueur (celui du mannequin, plus des
 * volumes et teintes facultatifs), ou `undefined` pour la figurine standard aux couleurs du joueur ;
 * `paletteOf(player)` la couleur alternative choisie (0 par défaut).
 */
export function createFigurines(
  styleOf: (player: number) => FigurineStyle | undefined,
  variantOf: (player: number) => number = () => 0,
): FighterVisualsFactory {
  return (config) => {
    const players = config.fighters.length;
    const root = new Group();
    root.name = 'fighters';
    const swing = config.entities?.find((def) => def.item?.swing !== undefined)?.item?.swing;
    const geometries = new Map<MeshData, BufferGeometry>();
    const outline = outlineMaterial();

    // Yeux (blancs) et pupilles et bouches (sombres) de tous les joueurs : deux appels de dessin.
    const ball = new SphereGeometry(1, 14, 10);
    const whiteMaterial = new MeshStandardMaterial({ color: 0xfbfaf7, roughness: 0.35 });
    const darkMaterial = new MeshStandardMaterial({ color: 0x15131a, roughness: 0.25 });
    const whites = new InstancedMesh(ball, whiteMaterial, players * 2);
    const darks = new InstancedMesh(ball, darkMaterial, players * 3);
    for (const m of [whites, darks]) {
      m.frustumCulled = false;
      m.userData.noShadow = true;
      root.add(m);
    }

    const bodies: Body[] = [];
    for (let i = 0; i < players; i++) {
      const def = config.fighters[i]!;
      const style = styleOf(i);
      const d = dimsOf(style);
      const rig = createRig(d);
      const data = meshFor(style, d, rig);
      let geometry = geometries.get(data);
      if (geometry === undefined) {
        geometry = geometryOf(data);
        geometries.set(data, geometry);
      }
      const zone = (name: ZoneName | undefined): number =>
        name === undefined ? -1 : ZONES.indexOf(name);
      const { material, uniforms } = figurineMaterial(
        paletteOf(style, i, variantOf(i)),
        zone(style?.emissive),
        zone(style?.iridescent),
      );
      const mesh = new SkinnedMesh(geometry, material);
      mesh.name = `figurine-${i}`;
      mesh.frustumCulled = false;
      const line = new SkinnedMesh(geometry, outline);
      line.name = `outline-${i}`;
      line.frustumCulled = false;
      line.userData.noShadow = true;
      line.visible = false;
      rig.root.add(mesh, line);
      mesh.bind(rig.skeleton);
      line.bind(rig.skeleton);

      const anchor = new Group();
      anchor.name = `fighter-${i}`;
      anchor.visible = false;
      const pose = new Group();
      pose.matrixAutoUpdate = false;
      pose.add(rig.root);
      anchor.add(pose);
      root.add(anchor);
      bodies.push({
        anchor,
        pose,
        rig,
        mesh,
        outline: line,
        uniforms,
        driver: createPoseDriver(def, swing),
        scale: fxToFloat(def.height) * d.normalize,
        headRadius: d.headRadius,
        glows: style?.emissive !== undefined,
        theme: style?.vfx,
        clock: 0,
        lastTime: 0,
        lastAction: -1,
        hair: createChain(),
        cloth: createChain(),
        skirt: createChain(),
        striker: -1,
        tips: new Float64Array(STRIKERS.length * 3),
        pale: false,
      });
    }

    const scale = new Matrix4();
    const yaw = new Matrix4();
    const spin = new Matrix4();
    const local = new Matrix4();
    const world = new Matrix4();
    const hidden = new Matrix4().makeScale(0, 0, 0);
    const at = new Vector3();
    const size = new Vector3();
    const noRotation = new Quaternion();
    const face = createExpression();
    const squash: Squash = { y: 1 };

    function hideFace(player: number): void {
      for (let k = 0; k < 2; k++) whites.setMatrixAt(player * 2 + k, hidden);
      for (let k = 0; k < 3; k++) darks.setMatrixAt(player * 3 + k, hidden);
    }

    /** Pièce du visage, en repère de la tête (unités : rayon de la tête). */
    function feature(
      mesh: InstancedMesh,
      index: number,
      head: Matrix4,
      r: number,
      x: number,
      y: number,
      z: number,
      sx: number,
      sy: number,
      sz: number,
    ): void {
      local.compose(at.set(x * r, y * r, z * r), noRotation, size.set(sx * r, sy * r, sz * r));
      mesh.setMatrixAt(index, world.multiplyMatrices(head, local));
    }

    for (let i = 0; i < players; i++) hideFace(i);

    // Traînées des coups : à la couleur du thème du personnage, sinon à celle du joueur.
    const trails = createTrails(players);
    root.add(trails.mesh);
    for (let i = 0; i < players; i++) {
      const themed = TRAIL_COLORS[bodies[i]!.theme ?? ''];
      if (themed !== undefined) trails.color(i, themed[0], themed[1], themed[2]);
      else {
        const c = new Color(PLAYER_COLORS[i % PLAYER_COLORS.length]!).multiplyScalar(2.4);
        trails.color(i, c.r, c.g, c.b);
      }
    }
    const tip = new Vector3();

    return {
      root,

      capture(player, view) {
        const body = bodies[player]!;
        body.driver.capture(view);
        body.clock++;
      },

      update(player, x, y, view, alpha) {
        const body = bodies[player]!;
        const anchor = body.anchor;
        whites.instanceMatrix.needsUpdate = true;
        darks.instanceMatrix.needsUpdate = true;
        anchor.visible = view.action !== A_DEAD;
        if (!anchor.visible) {
          hideFace(player);
          resetChain(body.hair);
          resetChain(body.cloth);
          resetChain(body.skirt);
          return;
        }
        anchor.position.set(x, y, 0);
        anchor.rotation.y = view.facing === 1 ? -FACE_CAMERA : Math.PI + FACE_CAMERA;

        const pose = body.driver.update(view, alpha);
        // Repère du corps : z vers la caméra quand il regarde à droite, à l'opposé sinon.
        body.rig.apply(pose, view.facing === 1 ? -HEAD_TURN : HEAD_TURN);

        // Mouvements secondaires : les ressorts avancent du temps de simulation écoulé depuis la
        // dernière image ; un saut dans le temps (rollback, réapparition) les remet au repos.
        const time = body.clock + alpha;
        const dt = time - body.lastTime;
        body.lastTime = time;
        if (dt < 0 || dt > MAX_SPRING_STEP || isTeleport(body.lastAction, view.action)) {
          resetChain(body.hair);
          resetChain(body.cloth);
          resetChain(body.skirt);
        } else if (dt > 0) {
          const vx = view.velX * view.facing;
          const vy = view.velY;
          stepChain(body.hair, dt, pose.spin + pose.torso + pose.head, vx, vy);
          stepChain(body.cloth, dt, pose.spin + pose.torso, vx, vy);
          stepChain(body.skirt, dt, pose.spin, vx, vy);
        }
        body.lastAction = view.action;
        const rig = body.rig;
        rig.bone('tail1').rotation.z = body.hair.angle[0]!;
        rig.bone('tail2').rotation.z = body.hair.angle[1]!;
        rig.bone('cloth1').rotation.z = body.cloth.angle[0]!;
        rig.bone('cloth2').rotation.z = body.cloth.angle[1]!;
        rig.bone('skirt').rotation.z = body.skirt.angle[0]! * SKIRT_SWAY;

        // Repère du corps : échelle (écrasement et étirement depuis les pieds), décalages et
        // rotation verticale, rotation autour du centre (comme le mannequin).
        const timing = body.driver.input;
        squashOf(view.action, timing.frame, timing.total, view.velY, view.hitlag, squash);
        const h = body.scale;
        // Entrée en scène : la figurine surgit en début de match (avec un léger rebond).
        const appear = entrance(time);
        const sy = h * squash.y * appear;
        const sxz = (h / Math.sqrt(squash.y)) * appear;
        const sinSpin = Math.sin(pose.spin);
        const cosSpin = Math.cos(pose.spin);
        body.pose.matrix
          .copy(scale.makeScale(sxz, sy, sxz))
          .multiply(
            yaw.makeRotationY(pose.yaw).setPosition(pose.offsetX, pose.offsetY, pose.offsetZ),
          )
          .multiply(
            spin
              .makeRotationZ(-pose.spin)
              .setPosition(-SPIN_PIVOT_Y * sinSpin, SPIN_PIVOT_Y * (1 - cosSpin), 0),
          );
        anchor.updateMatrixWorld(true);

        // Traînée : le bout le plus rapide au début des frames actives est suivi jusqu'au bout.
        const active = striking(view.action, timing.frame, timing.start, timing.end);
        let fastest = -1;
        let best = 0;
        for (let k = 0; k < STRIKERS.length; k++) {
          const [bone, tx, ty, tz] = STRIKERS[k]!;
          tip.set(tx, ty, tz).applyMatrix4(rig.bone(bone).matrixWorld);
          const o = k * 3;
          const moved = Math.hypot(tip.x - body.tips[o]!, tip.y - body.tips[o + 1]!);
          if (moved > best) {
            best = moved;
            fastest = k;
          }
          body.tips[o] = tip.x;
          body.tips[o + 1] = tip.y;
          body.tips[o + 2] = tip.z;
        }
        if (!active) body.striker = -1;
        else {
          if (body.striker < 0) body.striker = fastest;
          const o = body.striker * 3;
          if (o >= 0)
            trails.push(player, time, body.tips[o]!, body.tips[o + 1]!, body.tips[o + 2]!);
        }
        if (player === players - 1) trails.update(time);

        if (view.intangible !== body.pale) {
          body.pale = view.intangible;
          body.uniforms.uPale.value = body.pale ? PALE_MIX : 0;
        }
        // Éclat blanc de la victime pendant le gel d'un coup, en clignotant.
        body.uniforms.uFlash.value =
          view.action === A_HITSTUN && view.hitlag > 0 ? (view.hitlag % 4 < 2 ? 0.9 : 0.35) : 0;
        if (time < ENTRANCE_FRAMES) {
          body.uniforms.uFlash.value = Math.max(body.uniforms.uFlash.value, 1 - time / ENTRANCE_FRAMES);
        }
        // La zone incandescente s'embrase pendant la charge d'un smash.
        if (body.glows) {
          const heat = Math.min(1, view.charge / CHARGE_FULL);
          body.uniforms.uGlow.value = GLOW_IDLE + (GLOW_CHARGED - GLOW_IDLE) * heat;
        }

        // Visage : yeux de part et d'autre du nez, bouche dessous.
        expressionOf(view.action, view.hitlag, view.charge, body.clock, player, face);
        const head = body.rig.bone('head').matrixWorld;
        const r = body.headRadius;
        const open = face.eyes;
        for (let k = 0; k < 2; k++) {
          const z = k === 0 ? 0.36 : -0.36;
          feature(whites, player * 2 + k, head, r, 0.8, 1.06, z, 0.2, 0.27 * open, 0.15);
          feature(darks, player * 3 + k, head, r, 0.93, 1.05, z * 1.04, 0.11, 0.16 * open, 0.09);
        }
        const mouth = face.mouth;
        feature(
          darks,
          player * 3 + 2,
          head,
          r,
          0.9,
          0.62,
          0,
          0.05,
          0.03 + 0.09 * mouth,
          0.12 + 0.03 * mouth,
        );
      },

      theme(player: number) {
        return bodies[player]?.theme;
      },

      setQuality(preset: QualityPreset) {
        const lines = preset.quality === 'high' || preset.quality === 'ultra';
        for (const body of bodies) body.outline.visible = lines;
      },

      dispose() {
        for (const g of geometries.values()) g.dispose();
        for (const body of bodies) {
          (body.mesh.material as MeshStandardMaterial).dispose();
          body.rig.skeleton.dispose();
        }
        outline.dispose();
        ball.dispose();
        whiteMaterial.dispose();
        darkMaterial.dispose();
        trails.dispose();
        whites.dispose();
        darks.dispose();
      },
    } satisfies FighterVisuals;
  };
}
