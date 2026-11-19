/**
 * Écrasement et étirement (SPEC-visuals.md, phase 5) : le corps se tasse avant un saut et à
 * l'atterrissage, s'étire en pleine montée, se comprime sous l'impact d'un coup. Le volume est
 * conservé (la largeur compense la hauteur). Logique pure ; le corps est mis à l'échelle depuis
 * ses pieds, qui restent donc au sol.
 */
import { A_AIR, A_HITSTUN, A_JUMPSQUAT, A_LAND, A_TUMBLE } from '@game/sim-core';

export interface Squash {
  /** Facteur de hauteur ; la largeur et la profondeur valent 1 / √y. */
  y: number;
}

/** Tassement maximal avant un saut et à l'atterrissage, étirement maximal en montée. */
const JUMP_SQUASH = 0.12;
const LAND_SQUASH = 0.15;
const RISE_STRETCH = 0.07;
/** Vitesse de montée (unités par frame) à laquelle l'étirement est complet. */
const RISE_SPEED = 3;
const IMPACT_SQUASH = 0.08;

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * Facteur de hauteur pour l'action `action` à la frame `frame` (sur `total`), vitesse verticale
 * `velY`, gel `hitlag`.
 */
export function squashOf(
  action: number,
  frame: number,
  total: number,
  velY: number,
  hitlag: number,
  out: Squash,
): Squash {
  const progress = total > 0 ? clamp01(frame / total) : 1;
  switch (action) {
    case A_JUMPSQUAT:
      out.y = 1 - JUMP_SQUASH * progress;
      return out;
    case A_LAND: {
      const left = 1 - progress;
      out.y = 1 - LAND_SQUASH * left * left;
      return out;
    }
    case A_AIR:
      out.y = velY > 0 ? 1 + RISE_STRETCH * clamp01(velY / RISE_SPEED) : 1;
      return out;
    case A_HITSTUN:
    case A_TUMBLE:
      // Sous le coup, le corps encaisse ; une fois éjecté, il reprend sa forme.
      out.y = hitlag > 0 ? 1 - IMPACT_SQUASH : 1;
      return out;
    default:
      out.y = 1;
      return out;
  }
}
