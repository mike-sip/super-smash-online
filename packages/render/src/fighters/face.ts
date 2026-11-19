/**
 * Expressions du visage des figurines (SPEC-visuals.md, phase 3) : ouverture des yeux et de la
 * bouche selon l'état du combattant, et clignement. Logique pure.
 */
import {
  A_ATTACK,
  A_DOWN,
  A_GRABBED,
  A_HELPLESS,
  A_HITSTUN,
  A_SHIELD_BREAK,
  A_TUMBLE,
} from '@game/sim-core';

export interface Expression {
  /** Ouverture des yeux : 0 fermés, 1 ouverts, au-delà écarquillés. */
  eyes: number;
  /** Ouverture de la bouche : 0 fermée, 1 grande ouverte. */
  mouth: number;
}

export function createExpression(): Expression {
  return { eyes: 1, mouth: 0 };
}

/** Période et durée du clignement, en frames ; le décalage varie d'un joueur à l'autre. */
const BLINK_PERIOD = 197;
const BLINK_FRAMES = 6;

/**
 * Expression d'un combattant. `clock` compte ses frames capturées, `player` décale son
 * clignement pour que tous ne clignent pas ensemble.
 */
export function expressionOf(
  action: number,
  hitlag: number,
  charge: number,
  clock: number,
  player: number,
  out: Expression,
): Expression {
  if (action === A_HITSTUN || action === A_GRABBED) {
    // Touché : yeux plissés, bouche ouverte ; écarquillé pendant le gel d'un coup.
    out.eyes = hitlag > 0 ? 1.25 : 0.18;
    out.mouth = 0.9;
  } else if (action === A_TUMBLE || action === A_HELPLESS) {
    out.eyes = 1.2;
    out.mouth = 0.7;
  } else if (action === A_SHIELD_BREAK || action === A_DOWN) {
    out.eyes = 0.35;
    out.mouth = 0.35;
  } else if (charge > 0) {
    // Charge d'un smash : effort.
    out.eyes = 0.4;
    out.mouth = 0.25;
  } else if (action === A_ATTACK) {
    out.eyes = 0.7;
    out.mouth = 0.45;
  } else {
    out.eyes = 1;
    out.mouth = 0;
  }
  const phase = (clock + player * 61) % BLINK_PERIOD;
  if (out.eyes >= 0.9 && out.eyes <= 1.05 && phase < BLINK_FRAMES) {
    out.eyes = 0.08;
  }
  return out;
}
