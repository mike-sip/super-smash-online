import { A_AIR, A_IDLE, setAction } from './actions.ts';
import type { FighterDef, StageDef } from './defs.ts';
import { createEventQueue, type EventQueue } from './events.ts';
import { rngSeed } from './rng.ts';
import { G_FRAME, G_PLAYERS, MAX_PLAYERS, createState, type SimState } from './state.ts';
import { checkBlast } from './systems/blast.ts';
import { compileStage, findSurface, integrate, type StageGeo } from './systems/collision.ts';
import { updateMovement } from './systems/movement.ts';

export interface SimConfig {
  readonly stage: StageDef;
  /** Un combattant par joueur, de 2 à 8. */
  readonly fighters: readonly FighterDef[];
  readonly seed: number;
}

export interface Sim {
  readonly config: SimConfig;
  /** Tout ce qui évolue pendant le combat. Seule partie sauvegardée par un snapshot. */
  readonly state: SimState;
  /** Géométrie du stage, figée à la création. */
  readonly geo: StageGeo;
  /** Événements de la dernière frame. Hors snapshot : reconstruits à chaque `step`. */
  readonly events: EventQueue;
}

/** Pose le joueur sur son point d'apparition, immobile, dégâts à zéro. */
function placeAtSpawn(sim: Sim, i: number): void {
  const s = sim.state;
  const spawn = sim.config.stage.spawns[i]!;
  const surface = findSurface(sim.geo, spawn.x, spawn.y);
  s.posX[i] = spawn.x;
  s.posY[i] = spawn.y;
  s.velX[i] = 0;
  s.velY[i] = 0;
  s.facing[i] = spawn.x > 0 ? -1 : 1;
  s.grounded[i] = surface === 0 ? 0 : 1;
  s.surface[i] = surface;
  s.jumpsLeft[i] = sim.config.fighters[i]!.airJumps;
  s.tilt[i] = 0;
  s.fastFall[i] = 0;
  s.damage[i] = 0;
  setAction(s, i, surface === 0 ? A_AIR : A_IDLE);
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
  const sim: Sim = {
    config,
    state: createState(),
    geo: compileStage(config.stage),
    events: createEventQueue(),
  };
  sim.state.g[G_PLAYERS] = players;
  rngSeed(sim.state, config.seed);
  for (let i = 0; i < players; i++) placeAtSpawn(sim, i);
  return sim;
}

/**
 * Fait réapparaître un joueur. À appeler entre deux `step`, par les règles de match, de façon
 * identique chez tous les pairs : c'est une modification de l'état comme une autre.
 */
export function respawn(sim: Sim, player: number): void {
  placeAtSpawn(sim, player);
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
  sim.events.count = 0;

  for (let i = 0; i < players; i++) {
    s.prevInput[i] = s.input[i]!;
    s.input[i] = inputs[i]!;
  }

  for (let i = 0; i < players; i++) updateMovement(sim, i);
  for (let i = 0; i < players; i++) integrate(sim, i);
  for (let i = 0; i < players; i++) checkBlast(sim, i);

  for (let i = 0; i < players; i++) s.actionFrame[i] = s.actionFrame[i]! + 1;
  s.g[G_FRAME] = s.g[G_FRAME]! + 1;
}
