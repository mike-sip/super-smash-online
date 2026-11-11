/** Séquences rejouées à l'identique dans Node et dans les navigateurs. */
import { TEST_FIGHTER, TEST_HEAVY, TEST_STAGE } from '../../src/testing/fixtures.ts';
import type { SimConfig } from '../../src/index.ts';
import { play, type PlayStats } from './harness.ts';

export interface DeterminismCase {
  players: number;
  seed: number;
  inputSeed: number;
  frames: number;
}

export const CASES: DeterminismCase[] = [
  { players: 2, seed: 1, inputSeed: 11, frames: 3600 },
  { players: 4, seed: 2, inputSeed: 22, frames: 3600 },
  { players: 8, seed: 3, inputSeed: 33, frames: 3600 },
  { players: 8, seed: 4, inputSeed: 44, frames: 7200 },
];

/** Un combattant sur deux est le lourd, pour mêler les deux jeux de données. */
export function caseConfig(c: DeterminismCase): SimConfig {
  return {
    stage: TEST_STAGE,
    fighters: Array.from({ length: c.players }, (_, i) =>
      i % 2 === 1 ? TEST_HEAVY : TEST_FIGHTER,
    ),
    seed: c.seed,
  };
}

export const runCase = (c: DeterminismCase): PlayStats =>
  play(caseConfig(c), c.inputSeed, c.frames);
