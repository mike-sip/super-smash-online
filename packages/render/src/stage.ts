/** Décor construit à partir de `StageDef` : blocs pleins et plateformes. */
import { fxToFloat, type StageDef } from '@game/sim-core';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';

/** Profondeur des blocs pleins et des plateformes, de part et d'autre du plan de jeu. */
const SOLID_DEPTH = 36;
const PLATFORM_DEPTH = 16;
const PLATFORM_THICKNESS = 1.2;

/** Surfaces sur lesquelles on peut se tenir : dessus des blocs pleins et plateformes. */
export interface Surfaces {
  readonly count: number;
  readonly x1: Float64Array;
  readonly x2: Float64Array;
  readonly y: Float64Array;
}

export function stageSurfaces(stage: StageDef): Surfaces {
  const count = stage.solids.length + stage.platforms.length;
  const x1 = new Float64Array(count);
  const x2 = new Float64Array(count);
  const y = new Float64Array(count);
  let n = 0;
  for (const solid of stage.solids) {
    x1[n] = fxToFloat(solid.x1);
    x2[n] = fxToFloat(solid.x2);
    y[n] = fxToFloat(solid.y2);
    n++;
  }
  for (const platform of stage.platforms) {
    x1[n] = fxToFloat(platform.x1);
    x2[n] = fxToFloat(platform.x2);
    y[n] = fxToFloat(platform.y);
    n++;
  }
  return { count, x1, x2, y };
}

/** Tolérance verticale : un combattant posé sur une surface est « au-dessus » d'elle. */
const GROUND_EPSILON = 0.01;

/**
 * Hauteur de la surface la plus haute située sous le point (x, y), ou `-Infinity` s'il n'y a que
 * le vide. Sert à poser l'ombre d'un combattant.
 */
export function groundBelow(surfaces: Surfaces, x: number, y: number): number {
  let best = -Infinity;
  for (let i = 0; i < surfaces.count; i++) {
    if (x < surfaces.x1[i]! || x > surfaces.x2[i]!) continue;
    const top = surfaces.y[i]!;
    if (top <= y + GROUND_EPSILON && top > best) best = top;
  }
  return best;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Rectangle englobant les blocs pleins et les plateformes. */
export function stageBounds(stage: StageDef): Bounds {
  const b: Bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const solid of stage.solids) {
    b.minX = Math.min(b.minX, fxToFloat(solid.x1));
    b.maxX = Math.max(b.maxX, fxToFloat(solid.x2));
    b.minY = Math.min(b.minY, fxToFloat(solid.y1));
    b.maxY = Math.max(b.maxY, fxToFloat(solid.y2));
  }
  for (const platform of stage.platforms) {
    b.minX = Math.min(b.minX, fxToFloat(platform.x1));
    b.maxX = Math.max(b.maxX, fxToFloat(platform.x2));
    b.minY = Math.min(b.minY, fxToFloat(platform.y));
    b.maxY = Math.max(b.maxY, fxToFloat(platform.y));
  }
  return b;
}

/** Construit les objets du décor. Géométries et matériaux sont libérés par le renderer. */
export function buildStage(stage: StageDef): Group {
  const group = new Group();
  group.name = 'stage';

  const solidMaterial = new MeshStandardMaterial({ color: 0x6b7280 });
  for (const solid of stage.solids) {
    const x1 = fxToFloat(solid.x1);
    const x2 = fxToFloat(solid.x2);
    const y1 = fxToFloat(solid.y1);
    const y2 = fxToFloat(solid.y2);
    const mesh = new Mesh(new BoxGeometry(x2 - x1, y2 - y1, SOLID_DEPTH), solidMaterial);
    mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0);
    group.add(mesh);
  }

  const platformMaterial = new MeshStandardMaterial({ color: 0x9ca3af });
  for (const platform of stage.platforms) {
    const x1 = fxToFloat(platform.x1);
    const x2 = fxToFloat(platform.x2);
    const y = fxToFloat(platform.y);
    const mesh = new Mesh(
      new BoxGeometry(x2 - x1, PLATFORM_THICKNESS, PLATFORM_DEPTH),
      platformMaterial,
    );
    // Le dessus de la plateforme est à la hauteur où la simulation pose les combattants.
    mesh.position.set((x1 + x2) / 2, y - PLATFORM_THICKNESS / 2, 0);
    group.add(mesh);
  }
  return group;
}
