/** Outils communs aux tests du netcode. */
import { createSim, type Sim } from '@game/sim-core';
import { testConfig } from '@game/sim-core/testing';
import { simGame, stepWithRespawn, type RollbackGame } from '../src/game.ts';

/** Générateur xorshift32 propre aux tests, distinct de celui de la simulation. */
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

  /** Nombre dans [0, 1). */
  float(): number {
    return this.next() / 0x1_0000_0000;
  }
}

/**
 * Inputs d'un joueur humain simulé : il garde son input précédent 3 fois sur 4, comme quelqu'un
 * qui maintient une direction (des inputs entièrement aléatoires n'exercent presque rien).
 */
export class HumanInputs {
  private readonly rng: Rng;
  private current = 0;

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  next(): number {
    if (this.rng.range(4) === 0) this.current = this.rng.next();
    return this.current;
  }
}

export interface TestGame {
  readonly sim: Sim;
  readonly game: RollbackGame;
}

/** Une simulation du combattant de test, enveloppée pour le rollback, réapparition comprise. */
export function testGame(players: number, seed = 1): TestGame {
  const sim = createSim(testConfig(players, seed));
  return { sim, game: simGame(sim, stepWithRespawn) };
}

/** Simulation directe, sans rollback : empreinte après chaque frame de `inputs[f][p]`. */
export function directChecksums(
  players: number,
  seed: number,
  inputs: readonly Uint32Array[],
): number[] {
  const { game } = testGame(players, seed);
  const out: number[] = [game.checksum()];
  for (const frame of inputs) {
    game.step(frame);
    out.push(game.checksum());
  }
  return out;
}
