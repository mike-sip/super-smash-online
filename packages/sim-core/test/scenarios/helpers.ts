/** Outils pour écrire des scénarios : le joueur 0 est piloté, les autres restent immobiles. */
import { A_AIR } from '../../src/actions.ts';
import { fx } from '../../src/fixed.ts';
import { createSim, encodeInput, step, type Sim } from '../../src/index.ts';
import { testConfig } from '../../src/testing/fixtures.ts';

export const NEUTRAL = encodeInput(0, 0, 0);
export const stick = (x: number, y = 0, buttons = 0): number => encodeInput(x, y, buttons);
export const press = (buttons: number): number => encodeInput(0, 0, buttons);

export function newSim(players = 2): Sim {
  return createSim(testConfig(players));
}

/** Joue `frames` frames avec le même input pour le joueur 0. */
export function hold(sim: Sim, input: number, frames: number): void {
  const inputs = new Uint32Array(sim.config.fighters.length);
  inputs[0] = input;
  for (let f = 0; f < frames; f++) step(sim, inputs);
}

/** Joue une frame par input de la liste. */
export function play(sim: Sim, inputs0: readonly number[]): void {
  for (const i of inputs0) hold(sim, i, 1);
}

/** Joue jusqu'à ce que `until` soit vrai, et renvoie le nombre de frames jouées. */
export function holdUntil(sim: Sim, input: number, until: () => boolean, max = 600): number {
  for (let f = 1; f <= max; f++) {
    hold(sim, input, 1);
    if (until()) return f;
  }
  throw new Error(`Condition jamais atteinte en ${max} frames.`);
}

/** Place le joueur en l'air à une position donnée, en unités de jeu. */
export function teleportAir(sim: Sim, player: number, x: number, y: number): void {
  const s = sim.state;
  s.posX[player] = fx(x);
  s.posY[player] = fx(y);
  s.velX[player] = 0;
  s.velY[player] = 0;
  s.grounded[player] = 0;
  s.surface[player] = 0;
  s.fastFall[player] = 0;
  s.action[player] = A_AIR;
  s.actionFrame[player] = 0;
  s.jumpsLeft[player] = sim.config.fighters[player]!.airJumps;
}

/** Joue `frames` frames en pilotant les joueurs 0 et 1. */
export function hold2(sim: Sim, input0: number, input1: number, frames: number): void {
  const inputs = new Uint32Array(sim.config.fighters.length);
  inputs[0] = input0;
  inputs[1] = input1;
  for (let f = 0; f < frames; f++) step(sim, inputs);
}

/** Déplace un joueur au sol sur le bloc principal, tourné du côté voulu. */
export function place(sim: Sim, player: number, x: number, facing: 1 | -1): void {
  sim.state.posX[player] = fx(x);
  sim.state.facing[player] = facing;
}

/** Nombre d'événements d'un type donné émis pendant la dernière frame. */
export function countEvents(sim: Sim, type: number): number {
  let n = 0;
  for (let e = 0; e < sim.events.count; e++) if (sim.events.type[e] === type) n++;
  return n;
}

/** Joue `frames` frames avec un input par joueur. */
export function holdAll(sim: Sim, inputs: readonly number[], frames: number): void {
  const buf = new Uint32Array(sim.config.fighters.length);
  buf.set(inputs);
  for (let f = 0; f < frames; f++) step(sim, buf);
}
