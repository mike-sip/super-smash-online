/**
 * Studio de portraits (SPEC-visuals.md, phase 7) : photographie les figurines hors écran pour les
 * menus, sans aucune image stockée. Trois cadrages : buste (sélection), tête (icône de vies dans
 * le HUD), corps entier dans une pose de victoire (écran de résultats).
 *
 * Un personnage dont le modèle glTF animé est chargé (`fighters/model.ts`) est photographié dans
 * son modèle, comme en combat : première image de `idle`, ou dernière image d'un clip de victoire.
 * Sinon, sa figurine.
 *
 * Un seul contexte WebGL, créé à la première demande ; chaque image est gardée en mémoire.
 */
import {
  AnimationMixer,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
  type WebGLRenderTarget,
} from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { FigurineStyle } from './fighters/body.ts';
import { VICTORY_CLIPS } from './fighters/clips.ts';
import { createFigurineModel } from './fighters/figurine.ts';
import { fighterModel, type FighterModel } from './fighters/model.ts';
import { createPose, victoryPose, computePose, createPoseInput } from './fighters/poses.ts';
import { PLAYER_COLORS } from './fighters/visual.ts';
import { createLighting } from './lighting.ts';
import { skyEnvironment } from './post/pipeline.ts';

export type PortraitKind = 'portrait' | 'stock' | 'victory';

export interface PortraitStudio {
  /**
   * Image (URL de données PNG, fond transparent) de la figurine `style` dans sa couleur
   * `variant`. `size` : côté en pixels (hauteur pour `victory`, largeur aux 3/4). `pose` : pose de
   * victoire (0 à 2), pour `victory`. `model` : chemin du modèle glTF du personnage, photographié
   * à la place de la figurine s'il est déjà chargé.
   */
  render(
    style: FigurineStyle | undefined,
    variant: number,
    kind: PortraitKind,
    size: number,
    pose?: number,
    model?: string,
  ): string;
  dispose(): void;
}

/**
 * Cadrages : centre visé (hauteurs de combattant), distance, rotation du corps vers la caméra,
 * rotation de la tête en plus (visage de trois quarts).
 */
const FRAMES: Readonly<
  Record<PortraitKind, { y: number; distance: number; yaw: number; head: number }>
> = {
  portrait: { y: 0.84, distance: 1.3, yaw: -0.85, head: -0.45 },
  stock: { y: 0.97, distance: 0.85, yaw: -0.9, head: -0.5 },
  victory: { y: 0.6, distance: 2.9, yaw: -0.6, head: -0.4 },
};

const UP = new Vector3(0, 1, 0);

/** Clip photographié : la pose de victoire `pose` si le modèle l'a, sinon le repos. */
export function portraitClip(model: FighterModel, kind: PortraitKind, pose: number): string {
  const victory = VICTORY_CLIPS[pose % VICTORY_CLIPS.length]!;
  return kind === 'victory' && model.clips.has(victory) ? victory : 'idle';
}

/**
 * Copie posée du modèle glTF : couleur alternative `variant` (la matière `player` prend la
 * couleur du joueur 1), figée sur la première image de `idle` ou la dernière d'un clip de
 * victoire, tête tournée de `headTurn`, à la hauteur 1. Le modèle regarde vers +z.
 */
function posedModel(
  model: FighterModel,
  variant: number,
  clipName: string,
  headTurn: number,
): { root: Group; materials: Material[] } {
  const copy = cloneSkinned(model.scene);
  const tints = model.variants[variant % Math.max(1, model.variants.length)] ?? {};
  const materials: Material[] = [];
  const copies = new Map<Material, Material>();
  const own = (m: Material): Material => {
    let c = copies.get(m);
    if (c === undefined) {
      c = m.clone();
      const tint = c.name === 'player' ? PLAYER_COLORS[0] : tints[c.name];
      if (tint !== undefined && 'color' in c && c.color instanceof Color) c.color.set(tint);
      copies.set(m, c);
      materials.push(c);
    }
    return c;
  };
  copy.traverse((o: Object3D) => {
    if (o instanceof Mesh) {
      o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
      o.frustumCulled = false;
    }
  });
  const clip = model.clips.get(clipName)?.[0];
  if (clip !== undefined) {
    const mixer = new AnimationMixer(copy);
    const action = mixer.clipAction(clip);
    action.play();
    action.time = clipName === 'idle' ? 0 : clip.duration;
    mixer.update(0);
  }
  const head = copy.getObjectByName('head');
  if (head !== undefined) head.quaternion.multiply(new Quaternion().setFromAxisAngle(UP, headTurn));
  const root = new Group();
  root.add(copy);
  root.scale.setScalar(1 / model.height);
  return { root, materials };
}

export function createPortraitStudio(): PortraitStudio {
  let gl: WebGLRenderer | null = null;
  let env: WebGLRenderTarget | null = null;
  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.05, 50);
  const lighting = createLighting({
    sky: 0xffffff,
    ground: 0x556070,
    ambient: 1.3,
    sun: 0xfff2e2,
    sunIntensity: 2.3,
    rim: 0xc4dcff,
  });
  lighting.sun.position.set(-1.5, 2.5, 3);
  lighting.rim.strength.value = 0.9;
  scene.add(lighting.root);
  const cache = new Map<string, string>();
  const ids = new WeakMap<object, number>();
  let nextId = 1;
  const keyOf = (style: FigurineStyle | undefined): number => {
    if (style === undefined) return 0;
    let id = ids.get(style);
    if (id === undefined) {
      id = nextId++;
      ids.set(style, id);
    }
    return id;
  };

  function context(): WebGLRenderer {
    if (gl !== null) return gl;
    const canvas = document.createElement('canvas');
    gl = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    gl.toneMapping = NeutralToneMapping;
    gl.setClearColor(0x000000, 0);
    env = skyEnvironment(gl, { sky: 0xffffff, horizon: 0xc0cbdb, ground: 0x3a4250 });
    scene.environment = env.texture;
    scene.environmentIntensity = 0.5;
    return gl;
  }

  /** Dessine la scène et la rend en image. */
  function shoot(renderer: WebGLRenderer): string {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  }

  return {
    render(style, variant, kind, size, pose = 0, modelPath) {
      const gltf = modelPath === undefined ? undefined : fighterModel(modelPath);
      const useModel = gltf !== undefined && gltf.clips.has('idle');
      // Le modèle, une fois chargé, remplace la figurine : il a sa propre entrée dans le cache.
      const key = `${keyOf(style)}|${variant}|${kind}|${size}|${pose}|${useModel ? modelPath : ''}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const renderer = context();
      const width = kind === 'victory' ? Math.round(size * 0.75) : size;
      renderer.setPixelRatio(1);
      renderer.setSize(width, size, false);
      camera.aspect = width / size;
      camera.updateProjectionMatrix();
      const frame = FRAMES[kind];
      camera.position.set(0, frame.y + frame.distance * 0.08, frame.distance);
      camera.lookAt(0, frame.y, 0);

      let url: string;
      if (useModel) {
        const { root, materials } = posedModel(
          gltf,
          variant,
          portraitClip(gltf, kind, pose),
          frame.head,
        );
        // Un quart de tour en plus : la figurine regarde vers +x, le modèle vers +z.
        root.rotation.y = frame.yaw + Math.PI / 2;
        for (const m of materials) if (m instanceof MeshStandardMaterial) lighting.addRim(m);
        scene.add(root);
        url = shoot(renderer);
        scene.remove(root);
        for (const m of materials) m.dispose();
      } else {
        const model = createFigurineModel(style, variant);
        model.setQuality(true);
        // Lumière de contour sur les matières du corps, comme en combat.
        model.root.traverse((o) => {
          if (o instanceof Mesh && o.material instanceof MeshStandardMaterial) {
            lighting.addRim(o.material);
          }
        });
        const p = createPose();
        if (kind === 'victory') victoryPose(pose, 0, p);
        else {
          const input = createPoseInput();
          computePose(input, p);
        }
        model.root.rotation.y = frame.yaw;
        // Victoire : bouche ouverte, poings serrés ; ailleurs, visage au repos.
        model.apply(
          p,
          frame.head,
          1,
          kind === 'victory' ? 0.5 : 0,
          0,
          kind === 'victory' ? 1 : 0.45,
        );
        scene.add(model.root);
        url = shoot(renderer);
        scene.remove(model.root);
        model.dispose();
      }
      cache.set(key, url);
      return url;
    },
    dispose() {
      env?.dispose();
      gl?.dispose();
      gl = null;
      cache.clear();
    },
  };
}
