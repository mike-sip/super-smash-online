/**
 * Empreinte des données de jeu d'un personnage : deux pairs d'un match en ligne doivent obtenir la
 * même, sans quoi leurs simulations divergeront. L'apparence n'y entre pas.
 */
import type { Character } from './character.ts';

/** Sérialisation canonique : clés triées, `undefined` noté explicitement. */
function canonical(value: unknown): string {
  if (value === undefined) return 'u';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

/** FNV-1a 32 bits des données de jeu (identifiant, nom, `FighterDef`, projectiles). */
export function fingerprint(c: Character): number {
  const text = canonical({ id: c.id, name: c.name, def: c.def, entities: c.entities });
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
