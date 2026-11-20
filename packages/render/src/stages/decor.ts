/**
 * Décor d'un stage : blocs pleins, plateformes (fixes et mobiles), fond, lumières et décor
 * procédural propre au thème. Le thème est choisi d'après le nom du stage ; un stage inconnu
 * (le stage de test de `sim-core`) reçoit le décor neutre d'origine.
 *
 * Coût de dessin : le décor fixe d'un thème tient en deux géométries fusionnées (éclairée et
 * lumineuse), plus une par plateforme mobile et une par élément animé.
 */
import {
  fxToFloat,
  readPlatform,
  type PlatformView,
  type Sim,
  type StageDef,
} from '@game/sim-core';
import type { StageId } from '@game/stages-items';
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { BELVEDERE_THEME } from './belvedere.ts';
import { CANAL_THEME } from './canal.ts';
import { GEYSERS_THEME } from './geysers.ts';
import { facets, merge, seeded } from './lowpoly.ts';
import { RECIF_THEME } from './recif.ts';
import { createCloudSea } from './cloudsea.ts';
import { createRays } from './rays.ts';
import { createSky } from './sky.ts';
import { addSurfaceDetail } from './surface.ts';
import { createTriplanarMaterial } from './triplanar.ts';
import { releaseMaterials, setAnisotropy } from '../assets/loader.ts';
import type { QualityPreset } from '../quality.ts';
import { createMotes, createWater, type Animated } from './water.ts';
import { NEUTRAL_THEME, SOLID_DEPTH, slab, type DecorContext, type Theme } from './theme.ts';

export { NEUTRAL_THEME, type Theme } from './theme.ts';

/** Intensité des lueurs du décor quand le thème n'en précise pas. */
const GLOW = 1.8;

const THEMES: Readonly<Record<StageId, Theme>> = {
  belvedere: BELVEDERE_THEME,
  recif: RECIF_THEME,
  canal: CANAL_THEME,
  geysers: GEYSERS_THEME,
};

export function themeFor(stage: StageDef): Theme {
  return (THEMES as Readonly<Record<string, Theme>>)[stage.name] ?? NEUTRAL_THEME;
}

export interface MoverVisual {
  /** Index dans `StageDef.platforms`. */
  readonly index: number;
  readonly mesh: Mesh;
}

export interface StageVisuals {
  readonly root: Group;
  readonly theme: Theme;
  readonly movers: readonly MoverVisual[];
  /** Mémorise la position des plateformes mobiles ; `sequential` faux : pas d'interpolation. */
  capture(sim: Sim, sequential: boolean): void;
  /** Place les plateformes mobiles entre les deux dernières captures, et anime le décor. */
  update(frame: number, alpha: number): void;
  /** Matières texturées ou couleurs simples, selon le préréglage. */
  setQuality(preset: QualityPreset): void;
  /** Libère les matières de rechange (celles que la scène ne porte pas en ce moment). */
  dispose(): void;
}

export function createStageVisuals(stage: StageDef): StageVisuals {
  const theme = themeFor(stage);
  const root = new Group();
  root.name = 'stage';
  const random = seeded(theme.seed);
  const animations: ((frame: number) => void)[] = [];
  const buckets = new Map<string, BufferGeometry[]>();
  const surfaceOf = (name: string): BufferGeometry[] => {
    let parts = buckets.get(name);
    if (parts === undefined) buckets.set(name, (parts = []));
    return parts;
  };
  const surfaces = theme.surfaces ?? {};
  const ctx: DecorContext = {
    stage,
    random,
    lit: [],
    glow: [],
    surface: surfaceOf,
    root,
    animate: (update) => animations.push(update),
  };

  for (const solid of stage.solids) {
    const x1 = fxToFloat(solid.x1);
    const x2 = fxToFloat(solid.x2);
    const y1 = fxToFloat(solid.y1);
    const y2 = fxToFloat(solid.y2);
    if (theme.solidShape !== undefined) {
      theme.solidShape(x1, y1, x2, y2, ctx);
    } else {
      const box = new BoxGeometry(x2 - x1, y2 - y1, SOLID_DEPTH);
      box.translate((x1 + x2) / 2, (y1 + y2) / 2, 0);
      (surfaces.solid !== undefined ? surfaceOf('solid') : ctx.lit).push(
        facets(box, theme.solid, 0.05, random),
      );
    }
  }

  const movers: MoverVisual[] = [];
  const moverMaterial = new MeshStandardMaterial({ vertexColors: true });
  stage.platforms.forEach((platform, index) => {
    const x1 = fxToFloat(platform.x1);
    const x2 = fxToFloat(platform.x2);
    const y = fxToFloat(platform.y);
    if (platform.motion === undefined && theme.platformShape !== undefined) {
      theme.platformShape(x1, x2, y, ctx);
      return;
    }
    if (platform.motion === undefined) {
      const geometry = slab(x2 - x1, theme.platform, random);
      geometry.translate((x1 + x2) / 2, y, 0);
      (surfaces.platform !== undefined ? surfaceOf('platform') : ctx.lit).push(geometry);
      return;
    }
    const shape = theme.moverShape?.(x2 - x1, index, ctx) ?? slab(x2 - x1, theme.mover, random);
    const mesh = new Mesh(shape, moverMaterial);
    mesh.name = `mover-${index}`;
    mesh.position.set((x1 + x2) / 2, y, 0);
    root.add(mesh);
    movers.push({ index, mesh });
  });

  theme.decorate?.(ctx);
  // Ciel, eau et particules d'ambiance (phase 6), animés par la frame affichée.
  const living: Animated[] = [];
  if (theme.skyLook !== undefined) living.push(createSky(theme.skyLook));
  if (theme.water !== undefined) living.push(createWater(theme.water));
  if (theme.cloudSea !== undefined) living.push(createCloudSea(theme.cloudSea));
  for (const motes of theme.motes ?? []) living.push(createMotes(motes));
  const rays = theme.rays === undefined ? null : createRays(theme.rays);
  if (rays !== null) living.push(rays);
  for (const thing of living) {
    root.add(thing.mesh);
    animations.push((frame) => thing.update(frame));
  }
  // Grain des matières : pierre, bois et roche ne sont plus des aplats.
  const litMaterial = new MeshStandardMaterial({ vertexColors: true });
  addSurfaceDetail(litMaterial, theme.surface);
  addSurfaceDetail(moverMaterial, theme.surface);
  // Surfaces texturées : une géométrie et deux matières (texturée, ou couleurs et grain en Bas).
  const swaps: { mesh: Mesh; plain: MeshStandardMaterial; textured: MeshStandardMaterial }[] = [];
  for (const [name, parts] of buckets) {
    const look = surfaces[name];
    // Une surface sans matière déclarée rejoint le décor éclairé.
    if (look === undefined) {
      ctx.lit.push(...parts);
      continue;
    }
    if (parts.length === 0) continue;
    const plain = new MeshStandardMaterial({ vertexColors: true });
    addSurfaceDetail(plain, theme.surface);
    const mesh = new Mesh(merge(parts), plain);
    mesh.name = `surface-${name}`;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    swaps.push({ mesh, plain, textured: createTriplanarMaterial(look) });
  }
  if (surfaces.mover !== undefined && movers.length > 0) {
    const textured = createTriplanarMaterial(surfaces.mover);
    for (const m of movers) swaps.push({ mesh: m.mesh, plain: moverMaterial, textured });
  }
  addMerged(root, ctx.lit, litMaterial);
  const textureNames = new Set(Object.values(surfaces).map((l) => l.texture));
  // Au-delà de 1, les lueurs rayonnent (bloom) ; sans bloom, le mappage de tons les adoucit.
  const glow = theme.glow ?? GLOW;
  addMerged(
    root,
    ctx.glow,
    new MeshBasicMaterial({ vertexColors: true, fog: false, color: new Color(glow, glow, glow) }),
  );

  const view: PlatformView = { x1: 0, x2: 0, y: 0 };
  const prevX = new Float64Array(movers.length);
  const prevY = new Float64Array(movers.length);
  const currX = new Float64Array(movers.length);
  const currY = new Float64Array(movers.length);

  return {
    root,
    theme,
    movers,
    capture(sim, sequential) {
      for (let m = 0; m < movers.length; m++) {
        readPlatform(sim, movers[m]!.index, view);
        prevX[m] = sequential ? currX[m]! : (view.x1 + view.x2) / 2;
        prevY[m] = sequential ? currY[m]! : view.y;
        currX[m] = (view.x1 + view.x2) / 2;
        currY[m] = view.y;
      }
    },
    update(frame, alpha) {
      for (let m = 0; m < movers.length; m++) {
        movers[m]!.mesh.position.set(
          prevX[m]! + (currX[m]! - prevX[m]!) * alpha,
          prevY[m]! + (currY[m]! - prevY[m]!) * alpha,
          0,
        );
      }
      for (let a = 0; a < animations.length; a++) animations[a]!(frame + alpha);
    },
    setQuality(preset) {
      if (preset.textures) {
        // Seules les matières de ce stage restent en mémoire graphique.
        releaseMaterials(textureNames);
        setAnisotropy(preset.anisotropy);
      }
      for (const s of swaps) s.mesh.material = preset.textures ? s.textured : s.plain;
      // Rayons de lumière : réservés aux préréglages avec étalonnage (Haut, Ultra).
      if (rays !== null) rays.mesh.visible = preset.grading;
    },
    dispose() {
      for (const s of swaps) {
        s.plain.dispose();
        s.textured.dispose();
      }
    },
  };
}

function addMerged(
  root: Object3D,
  parts: BufferGeometry[],
  material: MeshStandardMaterial | MeshBasicMaterial,
): void {
  if (parts.length === 0) {
    material.dispose();
    return;
  }
  const mesh = new Mesh(merge(parts), material);
  mesh.name = 'decor';
  mesh.matrixAutoUpdate = false;
  root.add(mesh);
}
