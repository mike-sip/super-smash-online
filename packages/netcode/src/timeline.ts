/**
 * Historique des inputs d'une partie, vu d'un client. Logique pure, sans allocation après la
 * création.
 *
 * Par joueur, trois anneaux de `HISTORY_FRAMES` frames, indexés par `frame & masque` :
 * - les inputs **confirmés** par le serveur, pour les frames `< connu[p]` ;
 * - les inputs **utilisés** pour simuler chaque frame (confirmés ou prédits), pour détecter une
 *   prédiction fausse quand la confirmation arrive ;
 * - les inputs **lus localement**, pour les joueurs de cette machine.
 *
 * Numérotation (SPEC-netcode.md) : l'input de la frame `f` fait passer de l'état `S(f)` à
 * `S(f+1)`. Les frames `0` à `D-1` ont des inputs nuls, confirmés d'office.
 */
import { HISTORY_FRAMES } from './constants.ts';

const MASK = HISTORY_FRAMES - 1;

export interface Timeline {
  readonly players: number;
  readonly inputDelay: number;
  /** 1 si le joueur est sur cette machine. */
  readonly isLocal: Uint8Array;
  /** Emplacements des joueurs locaux, dans l'ordre de leurs indices locaux. */
  readonly localSlots: Uint8Array;
  /** Frontière par joueur : les inputs des frames `< known[p]` sont confirmés. */
  readonly known: Int32Array;
  readonly confirmed: Uint32Array;
  readonly used: Uint32Array;
  readonly localInput: Uint32Array;
  /** Les inputs locaux sont connus pour les frames `< localUpTo`. */
  localUpTo: number;
  /** Inputs locaux remplacés par le serveur (arrivés trop tard). */
  lateInputs: number;
}

export function createTimeline(
  players: number,
  localSlots: readonly number[],
  inputDelay: number,
): Timeline {
  const isLocal = new Uint8Array(players);
  for (const slot of localSlots) isLocal[slot] = 1;
  const known = new Int32Array(players);
  known.fill(inputDelay);
  return {
    players,
    inputDelay,
    isLocal,
    localSlots: Uint8Array.from(localSlots),
    known,
    confirmed: new Uint32Array(players * HISTORY_FRAMES),
    used: new Uint32Array(players * HISTORY_FRAMES),
    localInput: new Uint32Array(players * HISTORY_FRAMES),
    localUpTo: inputDelay,
    lateInputs: 0,
  };
}

/** Première frame dont un input reste incertain : `min(connu)`. */
export function frontier(t: Timeline): number {
  let min = t.known[0]!;
  for (let p = 1; p < t.players; p++) if (t.known[p]! < min) min = t.known[p]!;
  return min;
}

/**
 * Enregistre les inputs lus localement pour la frame `frame`, qui doit être `localUpTo` :
 * `values[i]` est l'input du joueur local i.
 */
export function pushLocal(t: Timeline, frame: number, values: Uint32Array): void {
  const at = frame & MASK;
  for (let i = 0; i < t.localSlots.length; i++) {
    t.localInput[t.localSlots[i]! * HISTORY_FRAMES + at] = values[i]!;
  }
  t.localUpTo = frame + 1;
}

/**
 * Input du joueur `p` pour la frame `f` : confirmé s'il l'est, sinon lu localement pour un
 * joueur local, sinon prédit (répétition du dernier input confirmé).
 */
export function inputFor(t: Timeline, p: number, f: number): number {
  const known = t.known[p]!;
  const row = p * HISTORY_FRAMES;
  if (f < known) return t.confirmed[row + (f & MASK)]!;
  if (t.isLocal[p] === 1 && f < t.localUpTo) return t.localInput[row + (f & MASK)]!;
  return known > 0 ? t.confirmed[row + ((known - 1) & MASK)]! : 0;
}

/** Remplit `out` avec les inputs de la frame `f` et les mémorise comme utilisés. */
export function fillInputs(t: Timeline, f: number, out: Uint32Array): void {
  const at = f & MASK;
  for (let p = 0; p < t.players; p++) {
    const v = inputFor(t, p, f);
    out[p] = v;
    t.used[p * HISTORY_FRAMES + at] = v;
  }
}

/**
 * Enregistre des inputs confirmés du joueur `player` : `inputs[offset + k]` est celui de la
 * frame `start + k`. Le déjà connu est ignoré ; un trou (début au-delà de la frontière) fait
 * ignorer tout le bloc, qui sera renvoyé. Rien n'est accepté au-delà de la capacité de l'anneau,
 * comptée depuis `oldest`, la plus ancienne frame encore utile (`min(frontière, frame simulée)`).
 *
 * Renvoie la plus petite frame `< simulated` dont l'input confirmé diffère de l'input utilisé, ou
 * -1 si aucune prédiction n'était fausse.
 */
export function confirmInputs(
  t: Timeline,
  player: number,
  start: number,
  inputs: Uint32Array,
  offset: number,
  count: number,
  simulated: number,
  oldest: number,
): number {
  let known = t.known[player]!;
  if (start > known) return -1;
  // La frame `oldest - 1` reste lue par la prédiction : elle ne doit pas être écrasée.
  const limit = oldest - 1 + HISTORY_FRAMES;
  const row = player * HISTORY_FRAMES;
  const local = t.isLocal[player] === 1;
  let mismatch = -1;
  for (let k = known - start; k < count; k++) {
    const f = start + k;
    if (f >= limit) break;
    const v = inputs[offset + k]!;
    const at = row + (f & MASK);
    t.confirmed[at] = v;
    if (local && f < t.localUpTo && t.localInput[at] !== v) t.lateInputs++;
    if (mismatch < 0 && f < simulated && t.used[at] !== v) mismatch = f;
    known = f + 1;
  }
  t.known[player] = known;
  return mismatch;
}

/** Input lu localement pour le joueur local `p` à la frame `f` (dans les limites de l'anneau). */
export function localInputAt(t: Timeline, p: number, f: number): number {
  return t.localInput[p * HISTORY_FRAMES + (f & MASK)]!;
}
