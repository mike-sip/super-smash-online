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
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { BELVEDERE_THEME } from './belvedere.ts';
import { CANAL_THEME } from './canal.ts';
import { GEYSERS_THEME } from './geysers.ts';
import { facets, merge, seeded } from './lowpoly.ts';
import { RECIF_THEME } from './recif.ts';
import { NEUTRAL_THEME, SOLID_DEPTH, slab, type DecorContext, type Theme } from './theme.ts';

export { NEUTRAL_THEME, type Theme } from './theme.ts';

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
}

export function createStageVisuals(stage: StageDef): StageVisuals {
  const theme = themeFor(stage);
  const root = new Group();
  root.name = 'stage';
  const random = seeded(theme.seed);
  const animations: ((frame: number) => void)[] = [];
  const ctx: DecorContext = {
    stage,
    random,
    lit: [],
    glow: [],
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
      ctx.lit.push(facets(box, theme.solid, 0.05, random));
    }
  }

  const movers: MoverVisual[] = [];
  const moverMaterial = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  stage.platforms.forEach((platform, index) => {
    const x1 = fxToFloat(platform.x1);
    const x2 = fxToFloat(platform.x2);
    const y = fxToFloat(platform.y);
    if (platform.motion === undefined) {
      const geometry = slab(x2 - x1, theme.platform, random);
      geometry.translate((x1 + x2) / 2, y, 0);
      ctx.lit.push(geometry);
      return;
    }
    const mesh = new Mesh(slab(x2 - x1, theme.mover, random), moverMaterial);
    mesh.name = `mover-${index}`;
    mesh.position.set((x1 + x2) / 2, y, 0);
    root.add(mesh);
    movers.push({ index, mesh });
  });

  theme.decorate?.(ctx);
  addMerged(root, ctx.lit, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  addMerged(root, ctx.glow, new MeshBasicMaterial({ vertexColors: true, fog: false }));

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
  };
}

function addMerged(
  root: Object3D,
  parts: BufferGeometry[],
  material: MeshLambertMaterial | MeshBasicMaterial,
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
