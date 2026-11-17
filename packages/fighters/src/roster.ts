/** Les personnages jouables de la v1. */
import type { Character, FighterId } from './character.ts';
import { FERROC } from './characters/ferroc.ts';
import { NACRE } from './characters/nacre.ts';
import { SOREL } from './characters/sorel.ts';
import { ZEPHINE } from './characters/zephine.ts';

/** Dans l'ordre d'affichage. Rempli personnage par personnage (SPEC-fighters.md, ordre imposé). */
export const ROSTER: readonly Character[] = Object.freeze([SOREL, ZEPHINE, FERROC, NACRE]);

export function isFighterId(id: string): id is FighterId {
  return ROSTER.some((c) => c.id === id);
}

/** Le personnage d'identifiant `id`. Lève une erreur s'il n'existe pas (encore). */
export function character(id: FighterId): Character {
  const found = ROSTER.find((c) => c.id === id);
  if (found === undefined) throw new Error(`Personnage inconnu : « ${id} ».`);
  return found;
}
