/**
 * Pseudos : normalisation, clé d'unicité, validation. Sans import Node : ce fichier est aussi
 * utilisé dans le navigateur, par le client, pour vérifier un pseudo avant de l'envoyer.
 */
import type { PseudoProblem } from './protocol.ts';
import { FORBIDDEN_ANYWHERE, FORBIDDEN_PREFIX, FORBIDDEN_WHOLE } from './wordlists.ts';

export const PSEUDO_MIN = 3;
export const PSEUDO_MAX = 16;

/**
 * Lettres latines (accents compris : Latin-1 et Latin étendu A), chiffres, `_` et `-`. Pas
 * d'autre écriture : une lettre cyrillique ou grecque identique à l'œil à une lettre latine
 * permettrait d'usurper un pseudo.
 */
const ALLOWED = /^[A-Za-z0-9_\-À-ÖØ-öø-ſ]+$/u;
const LETTER_FIRST = /^\p{L}/u;
const DOUBLE_SEPARATOR = /[_-]{2}/;

/** Lettres que la décomposition Unicode ne ramène pas à une lettre de base. */
const FOLDED: Readonly<Record<string, string>> = {
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
  ħ: 'h',
  ŧ: 't',
  ŋ: 'n',
  ĸ: 'k',
};

/** Chiffres employés pour déguiser une lettre (« 4dm1n »). */
const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
};

/** Forme normalisée d'un pseudo saisi : NFKC, espaces de bord retirés. */
export function normalizePseudo(raw: string): string {
  return raw.normalize('NFKC').trim();
}

/** Clé d'unicité : minuscules, sans accent. `Élodie` et `elodie` ont la même clé. */
export function pseudoKey(raw: string): string {
  const lower = normalizePseudo(raw).toLowerCase();
  const stripped = lower.normalize('NFD').replace(/\p{M}/gu, '');
  let key = '';
  for (const char of stripped) key += FOLDED[char] ?? char;
  return key;
}

function isForbidden(key: string): boolean {
  const plain = key.replace(/[_-]/g, '');
  const leet = plain.replace(/[0-9]/g, (digit) => LEET[digit] ?? digit);
  const wholes = [plain.replace(/[0-9]+$/, ''), leet];
  for (const candidate of [plain, leet]) {
    if (FORBIDDEN_ANYWHERE.some((word) => candidate.includes(word))) return true;
    if (FORBIDDEN_PREFIX.some((word) => candidate.startsWith(word))) return true;
  }
  return wholes.some((candidate) => FORBIDDEN_WHOLE.includes(candidate));
}

export type PseudoValidation =
  | { readonly ok: true; readonly pseudo: string; readonly key: string }
  | { readonly ok: false; readonly problem: PseudoProblem };

/** Pseudo normalisé et sa clé, ou la première raison de refus. */
export function validatePseudo(raw: string): PseudoValidation {
  const pseudo = normalizePseudo(raw);
  const length = [...pseudo].length;
  if (length < PSEUDO_MIN || length > PSEUDO_MAX) return { ok: false, problem: 'length' };
  if (!ALLOWED.test(pseudo)) return { ok: false, problem: 'characters' };
  if (!LETTER_FIRST.test(pseudo)) return { ok: false, problem: 'start' };
  if (DOUBLE_SEPARATOR.test(pseudo)) return { ok: false, problem: 'separators' };
  const key = pseudoKey(pseudo);
  if (isForbidden(key)) return { ok: false, problem: 'forbidden' };
  return { ok: true, pseudo, key };
}

/**
 * Pseudo tiré au hasard pour un invité qui n'en choisit pas : « Invité-48213 ». Le préfixe est
 * interdit aux joueurs, qui ne peuvent donc pas se faire passer pour un invité tiré au sort.
 */
export function generateGuestPseudo(): string {
  const value = new Uint32Array(1);
  globalThis.crypto.getRandomValues(value);
  return `Invité-${String(value[0]! % 100_000).padStart(5, '0')}`;
}
