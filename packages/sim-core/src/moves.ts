/**
 * Emplacements d'attaque : la simulation choisit l'emplacement d'après l'input, le combattant
 * fournit (ou non) une attaque pour chacun dans `FighterDef.moves`.
 */
export const M_JAB = 0;
/** Suites du jab, atteignables uniquement par annulation. */
export const M_JAB2 = 1;
export const M_JAB3 = 2;
export const M_FTILT = 3;
export const M_UTILT = 4;
export const M_DTILT = 5;
export const M_DASH_ATTACK = 6;
export const M_FSMASH = 7;
export const M_USMASH = 8;
export const M_DSMASH = 9;
export const M_NAIR = 10;
export const M_FAIR = 11;
export const M_BAIR = 12;
export const M_UAIR = 13;
export const M_DAIR = 14;
export const M_NSPECIAL = 15;
export const M_SSPECIAL = 16;
export const M_USPECIAL = 17;
export const M_DSPECIAL = 18;
/** Attaque de remontée depuis un rebord. */
export const M_LEDGE_ATTACK = 19;
// Emplacements ajoutés pour le module `fighters` (SPEC-fighters.md). Le 20 est réservé à l'attaque
// ultime (E6).
/** Emplacements libres, atteignables seulement par annulation ou par un contre (E5). */
export const M_EXTRA1 = 21;
export const M_EXTRA2 = 22;
export const MOVE_SLOTS = 23;
