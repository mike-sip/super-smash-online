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
  /** Sourcils : -1 froncés (colère, effort), 0 au repos, 1 relevés au milieu (inquiétude). */
  brow: number;
}

export function createExpression(): Expression {
  return { eyes: 1, mouth: 0, brow: 0 };
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
    out.brow = 0.9;
  } else if (action === A_TUMBLE || action === A_HELPLESS) {
    out.eyes = 1.2;
    out.mouth = 0.7;
    out.brow = 1;
  } else if (action === A_SHIELD_BREAK || action === A_DOWN) {
    out.eyes = 0.35;
    out.mouth = 0.35;
    out.brow = 0.6;
  } else if (charge > 0) {
    // Charge d'un smash : effort.
    out.eyes = 0.4;
    out.mouth = 0.25;
    out.brow = -1;
  } else if (action === A_ATTACK) {
    out.eyes = 0.8;
    out.mouth = 0.45;
    out.brow = -0.8;
  } else {
    out.eyes = 1;
    out.mouth = 0;
    out.brow = 0;
  }
  const phase = (clock + player * 61) % BLINK_PERIOD;
  if (out.eyes >= 0.9 && out.eyes <= 1.05 && phase < BLINK_FRAMES) {
    out.eyes = 0.08;
  }
  return out;
}

/** Pièces du visage, dans l'ordre : deux blancs, deux iris, deux pupilles, deux reflets, deux sourcils, la bouche. */
export const FACE_FEATURES = 11;
export const F_WHITE = 0;
export const F_IRIS = 2;
export const F_PUPIL = 4;
export const F_SHINE = 6;
export const F_BROW = 8;
export const F_MOUTH = 10;

/** Place d'une pièce dans le repère de la tête, en rayons de tête : position, taille, rotation (x). */
export interface Feature {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  roll: number;
}

export function createFace(): Feature[] {
  return Array.from({ length: FACE_FEATURES }, () => ({
    x: 0,
    y: 0,
    z: 0,
    sx: 0,
    sy: 0,
    sz: 0,
    roll: 0,
  }));
}

/** Écart des yeux de part et d'autre du nez, en rayons de tête. */
const EYE_Z = 0.37;
const EYE_Y = 0.98;

/**
 * Visage (SPEC-finition.md, phase 2) : grands yeux à iris et reflet, sourcils expressifs, bouche.
 * `gazeY` et `gazeZ` (en rayons de tête) déplacent iris, pupilles et reflets : le regard suit
 * l'adversaire. N'alloue rien.
 */
export function faceLayout(e: Expression, gazeY: number, gazeZ: number, out: Feature[]): Feature[] {
  const set = (
    f: Feature,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    roll = 0,
  ): void => {
    f.x = x;
    f.y = y;
    f.z = z;
    f.sx = sx;
    f.sy = sy;
    f.sz = sz;
    f.roll = roll;
  };
  const open = e.eyes;
  for (let k = 0; k < 2; k++) {
    const side = k === 0 ? 1 : -1;
    const z = EYE_Z * side;
    set(out[F_WHITE + k]!, 0.78, EYE_Y, z, 0.17, 0.3 * open, 0.19);
    set(out[F_IRIS + k]!, 0.9, EYE_Y + gazeY, z + gazeZ, 0.07, 0.18 * open, 0.13);
    set(out[F_PUPIL + k]!, 0.95, EYE_Y + gazeY, z + gazeZ, 0.045, 0.1 * open, 0.07);
    set(
      out[F_SHINE + k]!,
      0.97,
      EYE_Y + 0.07 * open + gazeY,
      z + gazeZ + 0.04,
      0.03,
      0.035 * open,
      0.03,
    );
    // Sourcils : le bout intérieur monte (inquiétude) ou descend (colère).
    set(
      out[F_BROW + k]!,
      0.86,
      EYE_Y + 0.3 + 0.03 * e.brow,
      z,
      0.05,
      0.04,
      0.17,
      side * e.brow * 0.4,
    );
  }
  set(out[F_MOUTH]!, 0.9, 0.58, 0, 0.05, 0.03 + 0.09 * e.mouth, 0.12 + 0.03 * e.mouth);
  return out;
}
