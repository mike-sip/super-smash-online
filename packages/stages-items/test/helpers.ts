/** Outils communs aux tests du module. */
import {
  BTN_ATTACK,
  BTN_GRAB,
  BTN_JUMP,
  BTN_SHIELD,
  BTN_SPECIAL,
  createSim,
  encodeInput,
  step,
  type Sim,
  type SimConfig,
} from '@game/sim-core';
import { testConfig } from '@game/sim-core/testing';

export const NEUTRAL = encodeInput(0, 0, 0);

/** Générateur congruentiel à graine, pour des inputs aléatoires reproductibles. */
export function lcg(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

const BUTTONS = [0, 0, 0, BTN_ATTACK, BTN_SPECIAL, BTN_JUMP, BTN_SHIELD, BTN_GRAB];

/** Remplit `out` d'inputs aléatoires ; chaque joueur garde son input quelques frames. */
export function randomInputs(next: () => number, out: Uint32Array): void {
  for (let p = 0; p < out.length; p++) {
    if (next() % 6 !== 0) continue;
    const x = (next() % 255) - 127;
    const y = (next() % 255) - 127;
    out[p] = encodeInput(x, y, BUTTONS[next() % BUTTONS.length]!);
  }
}

/** Configuration de test (combattants de `sim-core`) pour `players` joueurs. */
export function baseConfig(players: number, seed = 1): SimConfig {
  return testConfig(players, seed);
}

/** Joue `frames` frames d'inputs aléatoires, avec réapparition immédiate des KO. */
export function playRandom(sim: Sim, inputSeed: number, frames: number): void {
  const next = lcg(inputSeed);
  const inputs = new Uint32Array(sim.config.fighters.length);
  for (let f = 0; f < frames; f++) {
    randomInputs(next, inputs);
    step(sim, inputs);
  }
}

export { createSim };
