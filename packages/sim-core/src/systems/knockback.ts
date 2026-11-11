/**
 * Dégâts et éjection.
 *
 * Les constantes de ce fichier règlent le ressenti global du combat. Elles sont propres au jeu
 * et destinées à être ajustées manette en main (SPEC-sim-core.md : « Demander d'abord »).
 */
import { A_HITSTUN, setAction } from '../actions.ts';
import { FX_ONE, FX_SHIFT, fx, fxCos, fxDiv, fxMul, fxSin, type Fx } from '../fixed.ts';
import { STICK_MAX, inputStickX, inputStickY } from '../input.ts';
import type { Sim } from '../step.ts';

/** Vitesse de départ par point d'éjection. */
const LAUNCH_SPEED_PER_KB = fx(0.03);
/** Frames de hitstun par point d'éjection. */
const HITSTUN_PER_KB = fx(0.4);
/** À partir de cette éjection, la victime part en chute désordonnée. */
export const TUMBLE_KNOCKBACK = fx(80);
/** Déviation maximale de la trajectoire par l'influence directionnelle, en degrés. */
export const MAX_DI_DEGREES = 15;
const HITLAG_BASE = 4;
const HITLAG_MAX = 20;
/** Une frame de gel supplémentaire par tranche de 3 % de dégâts. */
const HITLAG_DAMAGE_STEP = 3 * FX_ONE;
/** Part de la vitesse conservée quand un coup plaque au sol une victime déjà debout. */
const GROUND_SPIKE_RESTITUTION = fx(0.8);

const KB_WEIGHT_NUMERATOR = fx(200);
const KB_WEIGHT_OFFSET = fx(100);
const KB_FLOOR = fx(18);

/**
 * Force d'éjection.
 *
 * @param percent dégâts de la victime après le coup
 * @param damage  dégâts du coup
 * @param weight  poids de la victime (fx(100) = moyen)
 * @param base    éjection de base du coup
 * @param growth  croissance du coup (fx(1) = 100 %)
 *
 * L'éjection croît avec les dégâts accumulés et avec la puissance du coup, et décroît avec le
 * poids. À croissance nulle, elle vaut toujours `base` : c'est ce qui permet les coups multiples.
 */
export function knockback(
  percent: number,
  damage: number,
  weight: number,
  base: number,
  growth: number,
): Fx {
  const scaling = ((percent / 10) | 0) + ((fxMul(percent, damage) / 20) | 0);
  const weightFactor = fxDiv(KB_WEIGHT_NUMERATOR, weight + KB_WEIGHT_OFFSET);
  return ((base + fxMul(fxMul(scaling, weightFactor) + KB_FLOOR, growth)) | 0) as Fx;
}

/** Frames de gel pour l'attaquant et la victime : plus le coup est fort, plus il « pèse ». */
export function hitlagFrames(damage: number): number {
  const frames = HITLAG_BASE + ((damage / HITLAG_DAMAGE_STEP) | 0);
  return frames > HITLAG_MAX ? HITLAG_MAX : frames;
}

export function hitstunFrames(kb: number): number {
  const frames = fxMul(kb, HITSTUN_PER_KB) >> FX_SHIFT;
  return frames < 1 ? 1 : frames;
}

/** Enregistre un coup reçu : dégâts immédiats, éjection différée à la fin du hitlag. */
export function applyHit(
  sim: Sim,
  target: number,
  damage: number,
  kb: number,
  angle: number,
  hitlag: number,
): void {
  const s = sim.state;
  s.damage[target] = s.damage[target]! + damage;
  s.launchSpeed[target] = fxMul(kb, LAUNCH_SPEED_PER_KB);
  s.launchAngle[target] = angle;
  s.launchPending[target] = 1;
  s.stun[target] = hitstunFrames(kb);
  s.tumble[target] = kb >= TUMBLE_KNOCKBACK ? 1 : 0;
  s.bounced[target] = 0;
  s.fastFall[target] = 0;
  s.hitlag[target] = hitlag;
  setAction(s, target, A_HITSTUN);
}

/**
 * Fin du hitlag : la victime part. Le stick qu'elle tient à cet instant dévie la trajectoire
 * (influence directionnelle) : seule sa composante perpendiculaire à l'éjection compte.
 */
export function launch(sim: Sim, i: number): void {
  const s = sim.state;
  const input = s.input[i]!;
  const speed = s.launchSpeed[i]!;
  const base = s.launchAngle[i]!;

  // Produit vectoriel direction × stick : positif si le stick est à gauche de la trajectoire.
  const cross = fxCos(base) * inputStickY(input) - fxSin(base) * inputStickX(input);
  const angle = base + (((MAX_DI_DEGREES * cross) / (STICK_MAX * FX_ONE)) | 0);

  const vx = fxMul(speed, fxCos(angle));
  let vy: number = fxMul(speed, fxSin(angle));

  if (s.grounded[i] === 1) {
    // Frappé vers le bas alors qu'il est au sol : il rebondit s'il est éjecté fort, sinon il glisse.
    if (vy < 0) vy = s.tumble[i] === 1 ? fxMul(-vy, GROUND_SPIKE_RESTITUTION) : 0;
    if (vy > 0) {
      s.grounded[i] = 0;
      s.surface[i] = 0;
      s.jumpsLeft[i] = sim.config.fighters[i]!.airJumps;
    }
  }
  s.velX[i] = vx;
  s.velY[i] = vy;
  s.launchPending[i] = 0;
}
