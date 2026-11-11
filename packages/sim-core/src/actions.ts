/** Actions du combattant, stockées dans `state.action`. Les valeurs font partie du format d'état. */
import type { SimState } from './state.ts';

export const A_IDLE = 0;
export const A_WALK = 1;
export const A_DASH = 2;
export const A_RUN = 3;
/** Freinage en sortie de course. */
export const A_BRAKE = 4;
/** Demi-tour en course : dérapage, puis changement de sens. */
export const A_TURN = 5;
export const A_CROUCH = 6;
/** Pré-saut : frames au sol entre l'appui et le décollage. */
export const A_JUMPSQUAT = 7;
/** En l'air, en montée comme en chute. */
export const A_AIR = 8;
/** Lag d'atterrissage. */
export const A_LAND = 9;
/** Éjecté hors des zones limites, en attente de réapparition. */
export const A_DEAD = 10;
/** Attaque en cours ; l'emplacement est dans `state.move`. */
export const A_ATTACK = 11;
/** Vient d'être frappé : aucun contrôle jusqu'à la fin du hitstun. */
export const A_HITSTUN = 12;
/** Chute désordonnée après une forte éjection : contrôlable, mais atterrir fait tomber au sol. */
export const A_TUMBLE = 13;
/** Rétablissement réussi au contact du sol. */
export const A_TECH = 14;
/** À terre après un rétablissement manqué. */
export const A_DOWN = 15;

/**
 * Change d'action. `actionFrame` compte les frames passées dans l'action, frame du changement
 * incluse : il vaut 1 à la fin de la frame où l'action a commencé.
 */
export function setAction(s: SimState, i: number, action: number): void {
  s.action[i] = action;
  s.actionFrame[i] = 0;
}
