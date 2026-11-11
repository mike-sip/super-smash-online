import type { FighterDef, StageDef } from './defs.ts';
import { rngSeed } from './rng.ts';
import { G_FRAME, G_PLAYERS, MAX_PLAYERS, createState, type SimState } from './state.ts';

export interface SimConfig {
  readonly stage: StageDef;
  /** Un combattant par joueur, de 2 à 8. */
  readonly fighters: readonly FighterDef[];
  readonly seed: number;
}

export interface Sim {
  readonly config: SimConfig;
  readonly state: SimState;
}

export function createSim(config: SimConfig): Sim {
  const players = config.fighters.length;
  if (players < 2 || players > MAX_PLAYERS) {
    throw new Error(`Il faut de 2 à 8 joueurs, reçu ${players}.`);
  }
  if (config.stage.spawns.length < players) {
    throw new Error(
      `Le stage « ${config.stage.name} » n'a que ${config.stage.spawns.length} points d'apparition pour ${players} joueurs.`,
    );
  }
  const s = createState();
  s.g[G_PLAYERS] = players;
  rngSeed(s, config.seed);
  for (let i = 0; i < players; i++) {
    const spawn = config.stage.spawns[i]!;
    s.posX[i] = spawn.x;
    s.posY[i] = spawn.y;
    s.facing[i] = spawn.x > 0 ? -1 : 1;
  }
  return { config, state: s };
}

/**
 * Avance la simulation d'une frame. `inputs[i]` est l'InputFrame du joueur i.
 *
 * Contraintes (SPEC-sim-core.md) : aucune allocation, aucune source de non-déterminisme,
 * joueurs toujours traités par index croissant.
 */
export function step(sim: Sim, inputs: Uint32Array): void {
  const s = sim.state;
  const players = s.g[G_PLAYERS]!;

  for (let i = 0; i < players; i++) {
    s.prevInput[i] = s.input[i]!;
    s.input[i] = inputs[i]!;
  }

  // Les systèmes (déplacement, collisions, coups…) s'insèrent ici, phase par phase.

  s.g[G_FRAME] = s.g[G_FRAME]! + 1;
}
