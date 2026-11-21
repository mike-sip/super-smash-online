/**
 * Musiques du jeu (SPEC-finition.md, phase 5) : un thème par stage, celui des menus, et le jingle
 * de victoire de chaque personnage (d'après le thème de ses effets).
 */
import { TRACK_STYLES } from '@game/render';
import { lookOf } from './content.ts';

/** Thème des menus. */
export const MENU_MUSIC = 'menu';

/** Thème du stage `stage`, ou celui de l'arène d'essai pour un stage sans thème propre. */
export function stageMusic(stage: string): string {
  return TRACK_STYLES.some((t) => t.name === stage) ? stage : 'arena';
}

/** Jingle de victoire du personnage `fighter`, ou `null` s'il n'en a pas. */
export function victoryJingle(fighter: string): string | null {
  const theme = lookOf(fighter)?.vfx;
  return theme === undefined ? null : `victory-${theme}`;
}
