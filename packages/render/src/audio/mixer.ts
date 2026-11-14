/**
 * Mélangeur : courbe de volume, panoramique, niveau et priorité de chaque son, réserve de voix,
 * plafond par frame. Logique pure sur des tableaux de taille fixe : rien n'est alloué par son.
 */
import {
  SND_DOUBLE_JUMP,
  SND_ENTITY_BREAK,
  SND_ENTITY_SPAWN,
  SND_GRAB,
  SND_HIT_MEDIUM,
  SND_HIT_STRONG,
  SND_HIT_WEAK,
  SND_JUMP,
  SND_KO,
  SND_LAND,
  SND_LEDGE,
  SND_PARRY,
  SND_SHIELD,
  SND_SHIELD_BREAK,
  SOUND_COUNT,
} from './cues.ts';

/**
 * Gain d'un curseur de volume (de 0 à 1). Courbe quadratique : à mi-course, le son est perçu
 * environ deux fois moins fort, au lieu d'à peine moins fort avec une courbe linéaire.
 */
export function volumeGain(level: number): number {
  if (!(level > 0)) return 0;
  if (level >= 1) return 1;
  return level * level;
}

/** Écart stéréo maximal : un son au bord du stage reste audible des deux côtés. */
export const PAN_WIDTH = 0.7;

/** Position stéréo d'un son émis en `x`, pour un stage large de `halfWidth` de part et d'autre. */
export function panFor(x: number, halfWidth: number): number {
  const p = halfWidth > 0 ? x / halfWidth : 0;
  return (p < -1 ? -1 : p > 1 ? 1 : p) * PAN_WIDTH;
}

function table(entries: readonly [id: number, value: number][]): readonly number[] {
  const values = new Array<number>(SOUND_COUNT).fill(0);
  for (const [id, value] of entries) values[id] = value;
  return values;
}

/** Niveau de chaque son dans le mélange (les échantillons sont tous normalisés à la même crête). */
export const SOUND_LEVELS: readonly number[] = table([
  [SND_HIT_WEAK, 0.55],
  [SND_HIT_MEDIUM, 0.7],
  [SND_HIT_STRONG, 0.9],
  [SND_SHIELD, 0.5],
  [SND_PARRY, 0.6],
  [SND_SHIELD_BREAK, 0.8],
  [SND_KO, 1],
  [SND_GRAB, 0.5],
  [SND_LEDGE, 0.4],
  [SND_JUMP, 0.3],
  [SND_DOUBLE_JUMP, 0.3],
  [SND_LAND, 0.3],
  [SND_ENTITY_SPAWN, 0.25],
  [SND_ENTITY_BREAK, 0.35],
]);

/** Priorité de chaque son quand toutes les voix sont prises : le plus grand l'emporte. */
export const SOUND_PRIORITIES: readonly number[] = table([
  [SND_KO, 5],
  [SND_SHIELD_BREAK, 4],
  [SND_PARRY, 4],
  [SND_HIT_STRONG, 3],
  [SND_HIT_MEDIUM, 3],
  [SND_HIT_WEAK, 2],
  [SND_SHIELD, 2],
  [SND_GRAB, 2],
  [SND_LEDGE, 1],
  [SND_ENTITY_BREAK, 1],
  [SND_JUMP, 0],
  [SND_DOUBLE_JUMP, 0],
  [SND_LAND, 0],
  [SND_ENTITY_SPAWN, 0],
]);

/** Voix d'effets : ce qui joue sur chacune, et jusqu'à quand (en secondes du contexte audio). */
export interface VoicePool {
  readonly count: number;
  readonly priority: Int32Array;
  readonly startedAt: Float64Array;
  readonly endsAt: Float64Array;
}

export function createVoicePool(count: number): VoicePool {
  return {
    count,
    priority: new Int32Array(count),
    startedAt: new Float64Array(count),
    endsAt: new Float64Array(count),
  };
}

/**
 * Voix pour un son de priorité `priority` à l'instant `now` : une voix libre, sinon la plus
 * ancienne parmi celles de plus faible priorité, si elle ne dépasse pas `priority` ; -1 sinon.
 */
export function pickVoice(pool: VoicePool, priority: number, now: number): number {
  let best = -1;
  for (let v = 0; v < pool.count; v++) {
    if (pool.endsAt[v]! <= now) return v;
    const p = pool.priority[v]!;
    if (p > priority) continue;
    if (
      best < 0 ||
      p < pool.priority[best]! ||
      (p === pool.priority[best]! && pool.startedAt[v]! < pool.startedAt[best]!)
    ) {
      best = v;
    }
  }
  return best;
}

/** Note que la voix `v` joue un son de priorité `priority` de `now` à `now + duration`. */
export function takeVoice(
  pool: VoicePool,
  v: number,
  priority: number,
  now: number,
  duration: number,
): void {
  pool.priority[v] = priority;
  pool.startedAt[v] = now;
  pool.endsAt[v] = now + duration;
}

/** Départs de chaque son pendant la frame en cours. */
export const MAX_SAME_SOUND_PER_FRAME = 2;

export type Throttle = Int32Array;

export function createThrottle(): Throttle {
  return new Int32Array(SOUND_COUNT);
}

export function resetThrottle(throttle: Throttle): void {
  throttle.fill(0);
}

/** Vrai si le son `id` peut encore partir pendant cette frame ; le départ est alors compté. */
export function allowSound(throttle: Throttle, id: number): boolean {
  if (throttle[id]! >= MAX_SAME_SOUND_PER_FRAME) return false;
  throttle[id] = throttle[id]! + 1;
  return true;
}

/** Variation de hauteur d'un son à l'autre, contre l'effet mitraillette. */
const JITTER = 0.04;

export interface Jitter {
  state: number;
}

export function createJitter(seed: number): Jitter {
  return { state: seed >>> 0 || 1 };
}

/** Vitesse de lecture suivante, entre 1 - 4 % et 1 + 4 %. */
export function nextJitter(jitter: Jitter): number {
  jitter.state = (Math.imul(jitter.state, 1664525) + 1013904223) >>> 0;
  return 1 + JITTER * (jitter.state / 2147483648 - 1);
}
