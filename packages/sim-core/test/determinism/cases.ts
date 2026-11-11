/** Séquences rejouées à l'identique dans Node et dans les navigateurs. */
import { TEST_ENTITIES, TEST_FIGHTER, TEST_HEAVY, TEST_STAGE } from '../../src/testing/fixtures.ts';
import type { SimConfig } from '../../src/index.ts';
import { play, type PlayStats } from './harness.ts';

export interface DeterminismCase {
  players: number;
  seed: number;
  inputSeed: number;
  frames: number;
}

/**
 * Séquences de référence : cinq parties de 10 minutes à 8 joueurs (critère de succès n° 1).
 * Leurs checksums attendus sont versionnés dans `golden.json`.
 */
export const REFERENCE_CASES: DeterminismCase[] = [
  { players: 8, seed: 101, inputSeed: 1001, frames: 36_000 },
  { players: 8, seed: 202, inputSeed: 2002, frames: 36_000 },
  { players: 8, seed: 303, inputSeed: 3003, frames: 36_000 },
  { players: 8, seed: 404, inputSeed: 4004, frames: 36_000 },
  { players: 8, seed: 505, inputSeed: 5005, frames: 36_000 },
];

/** Séquences courtes, à 2, 4 et 8 joueurs, pour les vérifications rapides par double exécution. */
export const QUICK_CASES: DeterminismCase[] = [
  { players: 2, seed: 1, inputSeed: 11, frames: 3600 },
  { players: 4, seed: 2, inputSeed: 22, frames: 3600 },
  { players: 8, seed: 3, inputSeed: 33, frames: 3600 },
];

/** Un combattant sur deux est le lourd, pour mêler les deux jeux de données. */
export function caseConfig(c: DeterminismCase): SimConfig {
  return {
    stage: TEST_STAGE,
    fighters: Array.from({ length: c.players }, (_, i) =>
      i % 2 === 1 ? TEST_HEAVY : TEST_FIGHTER,
    ),
    entities: TEST_ENTITIES,
    seed: c.seed,
  };
}

export const runCase = (c: DeterminismCase): PlayStats =>
  play(caseConfig(c), c.inputSeed, c.frames);
