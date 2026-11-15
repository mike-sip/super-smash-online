/**
 * Disposition de l'état de match dans la zone réservée de `sim-core` (`rulesState(sim)`).
 *
 * Tout ce qui évolue pendant le match est ici, en mots Int32 : c'est ce qui rend l'état de
 * match sauvegardé, restauré et compté par le checksum avec le reste de la simulation.
 * Ajouter une valeur = lui donner un index libre ci-dessous.
 */
import { MAX_PLAYERS, RULES_WORDS } from '@game/sim-core';

// Valeurs globales.
/** `PHASE_*`. 0 : zone jamais initialisée (simulation sans règles de match). */
export const W_PHASE = 0;
/** Frames restantes avant la fin du temps, ou -1 sans limite. */
export const W_FRAMES_LEFT = 1;
/** Frame de fin du match, ou -1. */
export const W_END_FRAME = 2;
/** `REASON_*` une fois le match terminé, 0 avant. */
export const W_REASON = 3;
/** Nombre de morts subites jouées. */
export const W_SUDDEN_ROUNDS = 4;
export const GLOBAL_WORDS = 16;

export const PHASE_PLAYING = 1;
export const PHASE_SUDDEN_DEATH = 2;
export const PHASE_OVER = 3;

export const REASON_LAST_STANDING = 1;
export const REASON_TIME = 2;
export const REASON_SUDDEN_DEATH = 3;

// Valeurs par joueur, à l'adresse `GLOBAL_WORDS + joueur * PLAYER_STRIDE + P_*`.
/** Vies restantes (0 en mode Temps hors mort subite : vies illimitées). */
export const P_STOCKS = 0;
/** 1 si le combattant est en jeu (ni KO en attente, ni éliminé). */
export const P_ALIVE = 1;
/** 1 si éliminé du tour en cours. */
export const P_OUT = 2;
/** 1 si le joueur dispute le tour en cours (match, puis mort subite). */
export const P_IN_ROUND = 3;
/** Frames avant réapparition, 0 si aucune n'est prévue. */
export const P_RESPAWN = 4;
/** Dernier attaquant adverse, ou -1 ; frame du coup. */
export const P_LAST_HITTER = 5;
export const P_LAST_HIT_FRAME = 6;
/** Dégâts lus à la frame précédente (virgule fixe), pour mesurer leur hausse. */
export const P_PREV_DAMAGE = 7;
/** Jauge d'ultime, en virgule fixe, de 0 à `METER_FULL`. */
export const P_METER = 8;
export const P_KOS = 9;
export const P_FALLS = 10;
export const P_SDS = 11;
/** Dégâts infligés et subis, en virgule fixe. */
export const P_DEALT = 12;
export const P_TAKEN = 13;
export const P_ULTIMATES = 14;
/** Frame d'élimination, ou -1. */
export const P_ELIM_AT = 15;
/** Place finale (1 = premier), 0 tant qu'elle n'est pas connue. */
export const P_PLACE = 16;
export const PLAYER_STRIDE = 20;

export const RULES_USED = GLOBAL_WORDS + MAX_PLAYERS * PLAYER_STRIDE;
if (RULES_USED > RULES_WORDS) {
  throw new Error(
    `L'état de match (${RULES_USED} mots) dépasse la zone réservée (${RULES_WORDS}).`,
  );
}

/** Adresse de la valeur `field` du joueur `player`. */
export const at = (player: number, field: number): number =>
  GLOBAL_WORDS + player * PLAYER_STRIDE + field;
