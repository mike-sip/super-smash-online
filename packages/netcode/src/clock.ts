/**
 * Estimation de l'horloge du serveur et horloge de jeu du client. Logique pure : toutes les
 * heures sont passées en argument (millisecondes).
 *
 * Chaque échange ping/pong donne un aller-retour et un écart estimé entre l'horloge du serveur
 * et l'horloge locale, en supposant l'aller et le retour de même durée. La gigue ne fait
 * qu'allonger un aller-retour : l'échange le plus court est donc le moins faussé. On retient
 * celui-là parmi les 16 derniers, en pénalisant un peu les plus anciens, car les horloges
 * dérivent (jusqu'à 0,1 %, soit 1 ms par seconde).
 *
 * L'horloge de jeu ne saute pas à chaque nouvelle estimation : elle la rejoint d'au plus 6 % du
 * temps écoulé (1 ms par frame de 16,7 ms), sauf écart de plus de 250 ms, corrigé d'un coup.
 */
import { FRAME_MS } from './constants.ts';

export const CLOCK_SAMPLES = 16;
/** Pénalité d'ancienneté d'un échange : 2 ms d'aller-retour par seconde d'âge. */
const AGE_PENALTY = 0.002;
/** Part du temps écoulé que l'horloge de jeu peut corriger. */
export const MAX_SLEW = 0.06;
/** Au-delà de cet écart, l'horloge de jeu est recalée d'un coup. */
export const SNAP_MS = 250;

export interface ClockEstimator {
  readonly offsets: Float64Array;
  readonly rtts: Float64Array;
  readonly times: Float64Array;
  count: number;
  next: number;
}

export function createClockEstimator(): ClockEstimator {
  return {
    offsets: new Float64Array(CLOCK_SAMPLES),
    rtts: new Float64Array(CLOCK_SAMPLES),
    times: new Float64Array(CLOCK_SAMPLES),
    count: 0,
    next: 0,
  };
}

/** Enregistre un échange : ping envoyé à `sentAt`, pong reçu à `receivedAt` (heures locales). */
export function addClockSample(
  c: ClockEstimator,
  sentAt: number,
  serverTime: number,
  receivedAt: number,
): void {
  const rtt = receivedAt - sentAt;
  if (!(rtt >= 0)) return;
  c.offsets[c.next] = serverTime - (sentAt + receivedAt) / 2;
  c.rtts[c.next] = rtt;
  c.times[c.next] = receivedAt;
  c.next = (c.next + 1) % CLOCK_SAMPLES;
  if (c.count < CLOCK_SAMPLES) c.count++;
}

/** Index de l'échange retenu à l'heure locale `now`, ou -1 sans échange. */
function best(c: ClockEstimator, now: number): number {
  let index = -1;
  let score = Infinity;
  for (let i = 0; i < c.count; i++) {
    const s = c.rtts[i]! + (now - c.times[i]!) * AGE_PENALTY;
    if (s < score) {
      score = s;
      index = i;
    }
  }
  return index;
}

/** Écart estimé : heure du serveur = heure locale + écart. `NaN` sans échange. */
export function clockOffset(c: ClockEstimator, now: number): number {
  const i = best(c, now);
  return i < 0 ? Number.NaN : c.offsets[i]!;
}

/** Aller-retour de l'échange retenu, ou `NaN` sans échange. */
export function clockRtt(c: ClockEstimator, now: number): number {
  const i = best(c, now);
  return i < 0 ? Number.NaN : c.rtts[i]!;
}

/** Horloge de jeu : rejoint progressivement l'estimation de l'écart. */
export interface GameClock {
  offset: number;
  last: number;
  started: boolean;
}

export function createGameClock(): GameClock {
  return { offset: 0, last: 0, started: false };
}

/**
 * Fait tendre l'écart appliqué vers `target` et renvoie l'heure du serveur vue par le jeu à
 * l'heure locale `now`.
 */
export function gameTime(g: GameClock, target: number, now: number): number {
  if (!g.started) {
    g.offset = target;
    g.started = true;
  } else {
    const error = target - g.offset;
    const room = Math.max(0, now - g.last) * MAX_SLEW;
    if (error > SNAP_MS || error < -SNAP_MS) g.offset = target;
    else if (error > room) g.offset += room;
    else if (error < -room) g.offset -= room;
    else g.offset = target;
  }
  g.last = now;
  return now + g.offset;
}

/** Frame que le jeu doit avoir atteinte à l'heure serveur `serverNow` (négative avant le départ). */
export function frameAt(serverNow: number, startAt: number): number {
  return Math.floor((serverNow - startAt) / FRAME_MS);
}

/** Fraction de frame écoulée à `serverNow`, de 0 à 1. */
export function frameFraction(serverNow: number, startAt: number): number {
  const t = (serverNow - startAt) / FRAME_MS;
  return t - Math.floor(t);
}
