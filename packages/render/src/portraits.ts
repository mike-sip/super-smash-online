/**
 * Studio de portraits (SPEC-visuals.md, phase 7) : photographie les figurines hors écran pour les
 * menus, sans aucune image stockée. Trois cadrages : buste (sélection), tête (icône de vies dans
 * le HUD), corps entier dans une pose de victoire (écran de résultats).
 *
 * Un seul contexte WebGL, créé à la première demande ; chaque image est gardée en mémoire.
 */
import {
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import type { FigurineStyle } from './fighters/body.ts';
import { createFigurineModel } from './fighters/figurine.ts';
import { createPose, victoryPose, computePose, createPoseInput } from './fighters/poses.ts';
import { createLighting } from './lighting.ts';
import { skyEnvironment } from './post/pipeline.ts';

export type PortraitKind = 'portrait' | 'stock' | 'victory';

export interface PortraitStudio {
  /**
   * Image (URL de données PNG, fond transparent) de la figurine `style` dans sa couleur
   * `variant`. `size` : côté en pixels (hauteur pour `victory`, largeur aux 3/4). `pose` : pose de
   * victoire (0 à 2), pour `victory`.
   */
  render(
    style: FigurineStyle | undefined,
    variant: number,
    kind: PortraitKind,
    size: number,
    pose?: number,
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

  return {
    render(style, variant, kind, size, pose = 0) {
      const key = `${keyOf(style)}|${variant}|${kind}|${size}|${pose}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const renderer = context();
      const width = kind === 'victory' ? Math.round(size * 0.75) : size;
      renderer.setPixelRatio(1);
      renderer.setSize(width, size, false);
      camera.aspect = width / size;
      camera.updateProjectionMatrix();

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
      const frame = FRAMES[kind];
      model.root.rotation.y = frame.yaw;
      model.apply(p, frame.head, 1, kind === 'victory' ? 0.5 : 0);
      scene.add(model.root);
      camera.position.set(0, frame.y + frame.distance * 0.08, frame.distance);
      camera.lookAt(0, frame.y, 0);
      renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL('image/png');
      scene.remove(model.root);
      model.dispose();
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
