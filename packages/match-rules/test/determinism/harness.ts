/**
 * Matchs joués au hasard, pour les tests de rollback et de déterminisme et pour le benchmark.
 * Le générateur est propre au harnais, distinct de celui de la simulation.
 */
import { checksum, createSim, knockOut, step, type Sim } from '@game/sim-core';
import { testConfig } from '@game/sim-core/testing';
import {
  createMatchSimConfig,
  createMatchView,
  defaultMatchConfig,
  matchResult,
  readMatch,
  type MatchConfig,
  type MatchMode,
} from '../../src/index.ts';

export class Rng {
  private x: number;

  constructor(seed: number) {
    this.x = seed | 0 || 1;
  }

  next(): number {
    let x = this.x;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.x = x;
    return x >>> 0;
  }

  /** Entier dans [0, n). */
  range(n: number): number {
    return this.next() % n;
  }
}

/**
 * Un pas de jeu au hasard : chaque joueur garde son input 3 fois sur 4 ; avec la probabilité
 * 1/`koEvery`, un joueur est mis KO avant le pas (comme une règle extérieure le ferait), pour
 * atteindre réapparitions, éliminations, mort subite et fin de match en peu de frames.
 * Renvoie le joueur mis KO, ou -1. Le tirage ne dépend que du générateur : rejouable.
 */
export function randomStep(sim: Sim, rng: Rng, inputs: Uint32Array, koEvery: number): number {
  for (let i = 0; i < inputs.length; i++) if (rng.range(4) === 0) inputs[i] = rng.next();
  let ko = -1;
  if (koEvery > 0 && rng.range(koEvery) === 0) {
    ko = rng.range(inputs.length);
    knockOut(sim, ko);
  }
  step(sim, inputs);
  return ko;
}

/** Configuration de match tirée au hasard (mode, joueurs, équipes, vies, temps). */
export function randomMatch(rng: Rng): MatchConfig {
  const modes: MatchMode[] = ['stock', 'time', 'stamina'];
  const mode = modes[rng.range(3)]!;
  const players = 2 + rng.range(7);
  const base = defaultMatchConfig(mode, players);
  const teams = rng.range(2) === 0;
  return {
    ...base,
    stocks: 1 + rng.range(3),
    stamina: 20 + rng.range(60),
    timeLimit: mode === 'time' || rng.range(2) === 0 ? 30 : 0,
    teams,
    teamAttack: rng.range(2) === 0,
    ultimate: rng.range(4) !== 0,
    players: Array.from({ length: players }, (_, i) => ({
      team: teams ? (i === 0 ? 0 : i === 1 ? 1 : rng.range(4)) : 0,
    })),
  };
}

export function createMatch(match: MatchConfig, seed: number): Sim {
  const { stage, fighters, entities } = testConfig(match.players.length);
  return createSim(createMatchSimConfig(match, { stage, fighters, entities, seed }));
}

export interface ReferenceCase {
  readonly name: string;
  readonly match: MatchConfig;
  readonly seed: number;
  readonly inputSeed: number;
  readonly frames: number;
}

const team8 = (teams: number[]) => teams.map((team) => ({ team }));

/** Les trois matchs de référence : 8 joueurs, un par mode, dont un en équipes. */
export const REFERENCE_CASES: readonly ReferenceCase[] = [
  {
    name: 'stock-ffa',
    match: defaultMatchConfig('stock', 8),
    seed: 11,
    inputSeed: 1101,
    frames: 36000,
  },
  {
    name: 'time-teams',
    match: {
      ...defaultMatchConfig('time', 8),
      teams: true,
      teamAttack: true,
      players: team8([0, 1, 2, 3, 0, 1, 2, 3]),
    },
    seed: 22,
    inputSeed: 2202,
    frames: 36000,
  },
  {
    name: 'stamina-ffa',
    match: { ...defaultMatchConfig('stamina', 8), stocks: 2, stamina: 80 },
    seed: 33,
    inputSeed: 3303,
    frames: 36000,
  },
];

export interface ReferenceOutcome {
  checksum: number;
  phase: string;
  reason: string | null;
  endFrame: number;
  winners: number[];
  placements: number[];
  kos: number[];
}

/** Joue un match de référence avec des inputs aléatoires (sans KO imposés). */
export function runReference(c: ReferenceCase): ReferenceOutcome {
  const sim = createMatch(c.match, c.seed);
  const rng = new Rng(c.inputSeed);
  const inputs = new Uint32Array(c.match.players.length);
  for (let f = 0; f < c.frames; f++) randomStep(sim, rng, inputs, 0);
  const view = createMatchView();
  readMatch(sim, view);
  const result = matchResult(sim);
  return {
    checksum: checksum(sim),
    phase: view.phase,
    reason: result?.reason ?? null,
    endFrame: result?.endFrame ?? -1,
    winners: result ? [...result.winners] : [],
    placements: result ? result.players.map((p) => p.placement) : [],
    kos: result ? result.players.map((p) => p.kos) : [],
  };
}
