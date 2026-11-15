/**
 * Règles des mots de passe, d'après NIST 800-63B : une longueur minimale, aucune règle de
 * composition, refus des mots de passe connus. Sans import Node (utilisé aussi par le client).
 */
import { pseudoKey } from './names.ts';
import type { PasswordProblem } from './protocol.ts';
import { COMMON_PASSWORDS } from './wordlists.ts';

export const PASSWORD_MIN = 8;
/** Au-delà, le hachage coûterait plus cher sans rien apporter. */
export const PASSWORD_MAX = 128;

const COMMON = new Set(COMMON_PASSWORDS);

/**
 * Forme sous laquelle un mot de passe est haché : NFKC, pour qu'un « é » tapé d'une seule touche
 * ou composé de deux donne le même résultat. Les espaces sont gardés.
 */
export function normalizePassword(password: string): string {
  return password.normalize('NFKC');
}

export type PasswordValidation =
  { readonly ok: true } | { readonly ok: false; readonly problem: PasswordProblem };

export function validatePassword(password: string, pseudo: string): PasswordValidation {
  const normalized = normalizePassword(password);
  const length = [...normalized].length;
  if (length < PASSWORD_MIN || length > PASSWORD_MAX) return { ok: false, problem: 'length' };
  if (pseudoKey(normalized) === pseudoKey(pseudo)) return { ok: false, problem: 'same_as_pseudo' };
  if (COMMON.has(normalized.toLowerCase())) return { ok: false, problem: 'too_common' };
  return { ok: true };
}
