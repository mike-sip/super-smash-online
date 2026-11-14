/** Contrat d'un thème de décor, et pièces communes à tous les thèmes. */
import type { StageDef } from '@game/sim-core';
import type { StageId } from '@game/stages-items';
import { BoxGeometry, type BufferGeometry, type Group } from 'three';
import { facets } from './lowpoly.ts';

/** Profondeur des blocs pleins et des plateformes, de part et d'autre du plan de jeu. */
export const SOLID_DEPTH = 36;
export const PLATFORM_DEPTH = 16;
export const PLATFORM_THICKNESS = 1.2;

/** Ce qu'un thème reçoit pour construire son décor. */
export interface DecorContext {
  /** Le stage tel que simulé : dangers absents s'ils ont été désactivés. */
  readonly stage: StageDef;
  readonly random: () => number;
  /** Géométries éclairées, préparées par `facets`, fusionnées en une seule à la fin. */
  readonly lit: BufferGeometry[];
  /** Géométries lumineuses (fenêtres, lanternes, coraux), non éclairées, fusionnées aussi. */
  readonly glow: BufferGeometry[];
  /** Pour les éléments à part : fond, eau, pièces animées. */
  readonly root: Group;
  /** Enregistre une animation, appelée à chaque image avec la frame de simulation affichée. */
  animate(update: (frame: number) => void): void;
}

export interface Theme {
  readonly id: StageId | 'neutral';
  readonly background: number;
  readonly fog?: { readonly color: number; readonly near: number; readonly far: number };
  /** Lumière d'ambiance (ciel, sol) et soleil. */
  readonly sky: number;
  readonly ground: number;
  readonly ambient: number;
  readonly sun: number;
  readonly sunIntensity: number;
  readonly solid: number;
  readonly platform: number;
  readonly mover: number;
  readonly seed: number;
  /** Ajoute le décor propre au thème. */
  decorate?(ctx: DecorContext): void;
  /** Remplace le bloc plein par défaut (une boîte) par une forme à soi. */
  solidShape?(x1: number, y1: number, x2: number, y2: number, ctx: DecorContext): void;
}

/** Le décor d'origine de `render` : gris, sans ornement. */
export const NEUTRAL_THEME: Theme = {
  id: 'neutral',
  background: 0x1b2233,
  sky: 0xffffff,
  ground: 0x3b4252,
  ambient: 1.6,
  sun: 0xffffff,
  sunIntensity: 1.8,
  solid: 0x6b7280,
  platform: 0x9ca3af,
  mover: 0xa8b0bd,
  seed: 1,
};

/** Dalle d'une plateforme, dessus à y = 0, centrée en x. */
export function slab(width: number, color: number, random: () => number): BufferGeometry {
  const geometry = new BoxGeometry(width, PLATFORM_THICKNESS, PLATFORM_DEPTH);
  geometry.translate(0, -PLATFORM_THICKNESS / 2, 0);
  return facets(geometry, color, 0.06, random);
}
