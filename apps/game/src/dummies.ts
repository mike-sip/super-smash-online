/**
 * Mannequins de l'entraînement : ils ne décident rien (pas d'IA, hors v1). Immobiles, ils sautent
 * en rythme, ou tiennent leur bouclier ; « aléatoire » ne sert qu'à la mesure de performance.
 */
import {
  BTN_ATTACK,
  BTN_GRAB,
  BTN_JUMP,
  BTN_SHIELD,
  BTN_SPECIAL,
  encodeInput,
  type InputFrame,
} from '@game/sim-core';

export type DummyMode = 'idle' | 'jump' | 'shield' | 'random';

export const DUMMY_MODES: readonly { value: DummyMode; label: string }[] = [
  { value: 'idle', label: 'Immobiles' },
  { value: 'jump', label: 'Sauteurs' },
  { value: 'shield', label: 'Bouclier' },
];

const STICK_X = [-127, -127, -56, 0, 0, 56, 127, 127];
const STICK_Y = [-127, 0, 0, 0, 0, 127];
const BUTTONS = [BTN_ATTACK, BTN_ATTACK, BTN_SPECIAL, BTN_JUMP, BTN_JUMP, BTN_SHIELD, BTN_GRAB];

/** Générateur reproductible (mulberry32), distinct de celui de la simulation. */
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

/** Input d'un mannequin à la frame `frame` ; `random` doit rester le même générateur. */
export function createDummyInputs(
  mode: DummyMode,
  seed = 1,
): (frame: number, d: number) => InputFrame {
  const random = createRandom(seed);
  const held: InputFrame[] = [];
  const hold: number[] = [];
  return (frame, d) => {
    switch (mode) {
      case 'idle':
        return 0;
      case 'jump':
        // Un saut toutes les 90 frames, décalé d'un mannequin à l'autre.
        return (frame + d * 23) % 90 < 4 ? encodeInput(0, 0, BTN_JUMP) : 0;
      case 'shield':
        return encodeInput(0, 0, BTN_SHIELD);
      case 'random': {
        if ((hold[d] ?? 0) <= 0) {
          const pick = (v: readonly number[]): number => v[Math.floor(random() * v.length)]!;
          held[d] = encodeInput(pick(STICK_X), pick(STICK_Y), random() < 0.5 ? pick(BUTTONS) : 0);
          hold[d] = 4 + Math.floor(random() * 27);
        }
        hold[d] = hold[d]! - 1;
        return held[d]!;
      }
    }
  };
}
