/**
 * Ce que le rollback doit savoir faire d'un jeu, et l'adaptateur pour une simulation `sim-core`.
 *
 * Le rollback restaure un état passé puis re-simule : tout ce qui influence la frame suivante doit
 * donc passer par `save` et `load`. Une logique appliquée entre deux frames (réapparition, règles
 * de match) ne doit lire et écrire que l'état de la simulation, jamais une variable à côté.
 */
import {
  A_DEAD,
  STATE_BYTES,
  checksum,
  createFighterView,
  loadState,
  readFighter,
  respawn,
  saveState,
  step,
  type Sim,
} from '@game/sim-core';

export interface RollbackGame {
  readonly players: number;
  /** Taille des tampons passés à `save` et `load`. */
  readonly stateBytes: number;
  /** Avance d'une frame. `inputs[i]` est l'input du joueur i. */
  step(inputs: Uint32Array): void;
  save(out: Uint8Array): void;
  load(from: Uint8Array): void;
  /** Empreinte de l'état courant sur 32 bits. */
  checksum(): number;
}

/** Fonction qui fait avancer une simulation d'une frame : `step`, ou `step` plus des règles. */
export type Advance = (sim: Sim, inputs: Uint32Array) => void;

/**
 * Enveloppe une simulation `sim-core`. `advance` remplace `step` quand l'application ajoute une
 * logique entre les frames ; elle ne doit lire et écrire que l'état de `sim`.
 */
export function simGame(sim: Sim, advance: Advance = step): RollbackGame {
  return {
    players: sim.config.fighters.length,
    stateBytes: STATE_BYTES,
    step: (inputs) => advance(sim, inputs),
    save: (out) => saveState(sim, out),
    load: (from) => loadState(sim, from),
    checksum: () => checksum(sim),
  };
}

/** Frames passées KO, après celle de l’éjection, avant la réapparition (démo en ligne, tests). */
export const RESPAWN_FRAMES = 60;

const view = createFighterView();

/**
 * `step`, puis réapparition des joueurs KO depuis `RESPAWN_FRAMES` frames. La durée est lue dans
 * l'état (le compteur de frames de l'action KO, qui vaut 1 à la fin de la frame de l'éjection) :
 * la règle reste juste après un rollback, à la différence d'un compteur tenu à côté de la
 * simulation. En attendant le module `match-rules`.
 */
export function stepWithRespawn(sim: Sim, inputs: Uint32Array): void {
  step(sim, inputs);
  const players = sim.config.fighters.length;
  for (let i = 0; i < players; i++) {
    readFighter(sim, i, view);
    if (view.action === A_DEAD && view.actionFrame > RESPAWN_FRAMES) respawn(sim, i);
  }
}
