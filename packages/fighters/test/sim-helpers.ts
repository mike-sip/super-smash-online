/**
 * Parties automatiques à plusieurs joueurs, pour le déterminisme, le rollback et le benchmark :
 * inputs pseudo-aléatoires reproductibles, réapparition après un KO, ultime levée de temps en temps.
 */
import {
  A_DEAD,
  BTN_ATTACK,
  BTN_GRAB,
  BTN_JUMP,
  BTN_SHIELD,
  BTN_SPECIAL,
  createSim,
  encodeInput,
  respawn,
  setUltimateReady,
  step,
  type Sim,
  type SimConfig,
} from '@game/sim-core';
import { TEST_ENTITIES, TEST_STAGE } from '@game/sim-core/testing';
import { buildMatchConfig } from '../src/match.ts';
import { ROSTER } from '../src/roster.ts';

/** Générateur xorshift32 : même graine, même suite, sur tous les moteurs. */
export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed | 0 || 1;
  }
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x;
    return x >>> 0;
  }
  /** Entier de 0 à n - 1. */
  range(n: number): number {
    return this.next() % n;
  }
}

const STICK = [-127, -70, 0, 0, 70, 127];
const BUTTONS = [0, 0, 0, 0, BTN_ATTACK, BTN_SPECIAL, BTN_JUMP, BTN_SHIELD, BTN_GRAB];

/** Les quatre personnages répartis sur `players` joueurs, entités de test en tête. */
export function mixedConfig(players: number, seed: number): SimConfig {
  return buildMatchConfig({
    stage: TEST_STAGE,
    players: Array.from({ length: players }, (_, i) => ROSTER[i % ROSTER.length]!),
    entities: TEST_ENTITIES,
    seed,
  });
}

/** Une partie : un joueur change d'input une frame sur quatre en moyenne. */
export class AutoMatch {
  readonly sim: Sim;
  readonly inputs: Uint32Array;
  private readonly rng: Rng;
  private readonly dead: Int32Array;

  constructor(config: SimConfig, inputSeed: number) {
    this.sim = createSim(config);
    this.inputs = new Uint32Array(config.fighters.length);
    this.rng = new Rng(inputSeed);
    this.dead = new Int32Array(config.fighters.length);
  }

  /**
   * Tire les inputs de la frame suivante ; lève parfois le drapeau d'ultime d'un joueur. Ce drapeau
   * est posé hors de `step` : une portion rejouée après un rollback doit s'en passer.
   */
  draw(ultimates = true): void {
    const rng = this.rng;
    for (let p = 0; p < this.inputs.length; p++) {
      if (rng.range(4) !== 0) continue;
      this.inputs[p] = encodeInput(
        STICK[rng.range(6)]!,
        STICK[rng.range(6)]!,
        BUTTONS[rng.range(9)]!,
      );
    }
    if (ultimates && rng.range(600) === 0)
      setUltimateReady(this.sim, rng.range(this.inputs.length), true);
  }

  /**
   * Joue une frame avec les inputs courants, puis fait réapparaître les KO après 60 frames. Le
   * compteur de réapparition vit hors de l'état : une portion rejouée doit s'en passer aussi.
   */
  play(inputs: Uint32Array = this.inputs, respawns = true): void {
    step(this.sim, inputs);
    if (!respawns) return;
    const s = this.sim.state;
    for (let p = 0; p < this.inputs.length; p++) {
      if (s.action[p] !== A_DEAD) {
        this.dead[p] = 0;
      } else if (++this.dead[p]! >= 60) {
        this.dead[p] = 0;
        respawn(this.sim, p);
      }
    }
  }
}
