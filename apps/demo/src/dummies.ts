/** Adversaires de la démo : immobiles, ou pilotés par des inputs aléatoires reproductibles. */
import {
  BTN_ATTACK,
  BTN_GRAB,
  BTN_JUMP,
  BTN_SHIELD,
  BTN_SPECIAL,
  encodeInput,
  type InputFrame,
} from '@game/sim-core';

export type DummyMode = 'idle' | 'random';

export interface Dummies {
  /** Écrit l'input de chaque mannequin dans `inputs`, à partir de l'index 1. */
  fill(inputs: Uint32Array): void;
}

const STICK_X = [-127, -127, -56, 0, 0, 56, 127, 127];
const STICK_Y = [-127, 0, 0, 0, 0, 127];
const BUTTONS = [BTN_ATTACK, BTN_ATTACK, BTN_SPECIAL, BTN_JUMP, BTN_JUMP, BTN_SHIELD, BTN_GRAB];
const MIN_HOLD = 4;
const MAX_HOLD = 30;

/**
 * Générateur propre à la démo (mulberry32), distinct de celui de la simulation : la même graine
 * redonne les mêmes adversaires, ce dont la mesure de performance a besoin.
 */
function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createDummies(mode: DummyMode, count: number, seed: number): Dummies {
  const random = createRandom(seed);
  const pick = (values: readonly number[]): number => values[Math.floor(random() * values.length)]!;
  const current = new Uint32Array(count);
  const hold = new Int32Array(count);

  const next = (): InputFrame =>
    encodeInput(pick(STICK_X), pick(STICK_Y), random() < 0.5 ? pick(BUTTONS) : 0);

  return {
    fill(inputs) {
      for (let d = 0; d < count; d++) {
        if (mode === 'random') {
          if (hold[d]! <= 0) {
            current[d] = next();
            hold[d] = MIN_HOLD + Math.floor(random() * (MAX_HOLD - MIN_HOLD + 1));
          }
          hold[d] = hold[d]! - 1;
        }
        inputs[d + 1] = current[d]!;
      }
    },
  };
}
