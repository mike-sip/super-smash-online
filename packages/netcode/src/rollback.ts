/**
 * Moteur de rollback : sauvegardes, restauration, re-simulation, fenêtre de prédiction.
 * Logique pure, sans réseau ni horloge : le client lui donne les inputs locaux et les inputs
 * confirmés, il fait avancer le jeu. Aucune allocation après la création.
 *
 * Invariants :
 * - la frame courante `n` (état `S(n)` en mémoire) ne dépasse jamais `C + P`, où `C` est la
 *   frontière des inputs confirmés et `P` la fenêtre de prédiction ;
 * - les états `S(n-P-1)` à `S(n-1)` sont sauvegardés dans un anneau de `P + 1` tampons : toute
 *   frame à corriger (≥ `C`) y est ;
 * - seules `advance` fait progresser `n` : une re-simulation revient toujours à la même frame.
 *   Chaque appel à `advance` produit donc une frame nouvelle.
 */
import type { RollbackGame } from './game.ts';
import {
  confirmInputs,
  createTimeline,
  fillInputs,
  frontier,
  pushLocal,
  type Timeline,
} from './timeline.ts';

export interface RollbackOptions {
  readonly game: RollbackGame;
  /** Emplacements des joueurs de cette machine, dans l'ordre de leurs indices locaux. */
  readonly localSlots: readonly number[];
  readonly inputDelay: number;
  readonly maxPrediction: number;
  readonly checksumInterval: number;
  /** Empreinte de chaque état confirmé `S(frame)` dont la frame est multiple de l'intervalle. */
  readonly onChecksum?: (frame: number, value: number) => void;
}

export interface RollbackStats {
  /** Rollbacks effectués, frames re-simulées au total, plus grande profondeur. */
  rollbacks: number;
  resimulated: number;
  maxRollback: number;
}

export interface Rollback {
  readonly timeline: Timeline;
  readonly stats: RollbackStats;
  /** Frame courante : l'état en mémoire est `S(frame())`. */
  frame(): number;
  /** Première frame dont un input reste incertain. */
  confirmedFrame(): number;
  /** Vrai si `advance` peut simuler une frame de plus sans sortir de la fenêtre de prédiction. */
  canAdvance(): boolean;
  /**
   * Lit les inputs locaux de la frame courante (`local[i]` pour le joueur local i, appliqué à la
   * frame `n + D`), simule la frame courante et passe à la suivante. Ne fait rien et renvoie
   * faux hors de la fenêtre de prédiction.
   */
  advance(local: Uint32Array): boolean;
  /**
   * Inputs confirmés du joueur `player` : `inputs[offset + k]` pour la frame `start + k`. Une
   * prédiction fausse est notée ; la correction se fait au prochain `reconcile`.
   */
  confirm(player: number, start: number, inputs: Uint32Array, offset: number, count: number): void;
  /** Restaure et re-simule depuis la première frame mal prédite. Renvoie les frames re-simulées. */
  reconcile(): number;
}

export function createRollback(options: RollbackOptions): Rollback {
  const { game, inputDelay, maxPrediction, checksumInterval, onChecksum } = options;
  const players = game.players;
  const timeline = createTimeline(players, options.localSlots, inputDelay);
  const ring = maxPrediction + 1;
  const saves: Uint8Array[] = [];
  for (let i = 0; i < ring; i++) saves.push(new Uint8Array(game.stateBytes));
  const scratch = new Uint8Array(game.stateBytes);
  const inputs = new Uint32Array(players);
  const stats: RollbackStats = { rollbacks: 0, resimulated: 0, maxRollback: 0 };

  let current = 0;
  /** Première frame mal prédite en attente de correction, ou `Infinity`. */
  let pending = Infinity;
  /** Dernière frame dont l'empreinte a été donnée (multiple de l'intervalle). */
  let lastChecksum = 0;

  function simulate(f: number): void {
    fillInputs(timeline, f, inputs);
    game.step(inputs);
  }

  /** Donne les empreintes des états désormais confirmés, dans l'ordre, une seule fois chacune. */
  function reportChecksums(): void {
    if (onChecksum === undefined) return;
    const c = frontier(timeline);
    const upTo = c < current ? c : current;
    let next = lastChecksum + checksumInterval;
    if (next > upTo) return;
    if (pending < Infinity) reconcile();
    while (next <= upTo) {
      let value: number;
      if (next === current) {
        value = game.checksum();
      } else {
        // `next > C - P ≥ current - P` : l'état est dans l'anneau.
        game.save(scratch);
        game.load(saves[next % ring]!);
        value = game.checksum();
        game.load(scratch);
      }
      lastChecksum = next;
      onChecksum(next, value);
      next += checksumInterval;
    }
  }

  function reconcile(): number {
    if (pending >= current) {
      pending = Infinity;
      return 0;
    }
    const from = pending;
    pending = Infinity;
    game.load(saves[from % ring]!);
    for (let f = from; f < current; f++) {
      if (f > from) game.save(saves[f % ring]!);
      simulate(f);
    }
    const depth = current - from;
    stats.rollbacks++;
    stats.resimulated += depth;
    if (depth > stats.maxRollback) stats.maxRollback = depth;
    return depth;
  }

  return {
    timeline,
    stats,
    frame: () => current,
    confirmedFrame: () => frontier(timeline),
    canAdvance: () => current - frontier(timeline) < maxPrediction,

    advance(local) {
      if (current - frontier(timeline) >= maxPrediction) return false;
      if (pending < Infinity) reconcile();
      const f = current;
      if (f + inputDelay >= timeline.localUpTo) pushLocal(timeline, f + inputDelay, local);
      game.save(saves[f % ring]!);
      simulate(f);
      current = f + 1;
      reportChecksums();
      return true;
    },

    confirm(player, start, values, offset, count) {
      // Plus ancienne frame encore utile : une correction en attente peut viser une frame
      // antérieure à la frontière actuelle, qui a avancé depuis ; ses inputs doivent survivre.
      const c = frontier(timeline);
      let oldest = c < current ? c : current;
      if (pending < oldest) oldest = pending;
      const wrong = confirmInputs(timeline, player, start, values, offset, count, current, oldest);
      if (wrong >= 0 && wrong < pending) pending = wrong;
      reportChecksums();
    },

    reconcile,
  };
}
