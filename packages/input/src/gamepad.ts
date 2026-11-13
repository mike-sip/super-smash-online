/**
 * Lecture d'une manette : son état brut en entrée, un `InputFrame` en sortie.
 *
 * Une manette ne se lit que par interrogation, une fois par frame simulée. Un appui commencé et
 * terminé entre deux lectures est donc invisible, et rien ne permet de le rattraper : c'est une
 * limite de l'API Gamepad, documentée dans SPEC-input.md.
 */
import {
  BTN_CSTICK_DOWN,
  BTN_CSTICK_LEFT,
  BTN_CSTICK_RIGHT,
  BTN_CSTICK_UP,
  encodeInput,
  type InputFrame,
} from '@game/sim-core';
import { ACTIONS, ACTION_BUTTON, A_DOWN, A_LEFT, A_RIGHT, A_UP } from './actions.ts';
import { dominant, isPressed, shapeStick, type StickValue } from './analog.ts';
import type { Bindings } from './bindings.ts';

export interface AnalogSettings {
  /** Part de la course du stick ignorée autour du centre, de 0 à 1. */
  readonly deadzone: number;
  /** Inclinaison à partir de laquelle le stick droit ou une gâchette compte comme enfoncé. */
  readonly threshold: number;
}

export const DEFAULT_ANALOG: AnalogSettings = { deadzone: 0.15, threshold: 0.5 };

/** Ce que le module lit d'une manette : un sous-ensemble de l'objet `Gamepad` du navigateur. */
export interface PadState {
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
}

export interface GamepadReader {
  setBindings(bindings: Bindings): void;
  /** Input de la manette à cet instant. N'alloue rien. */
  read(pad: PadState, settings: AnalogSettings): InputFrame;
}

// Index des actions du stick droit dans `ACTIONS`, et bouton de chacune.
const C_ACTIONS = [
  ACTIONS.indexOf('cLeft'),
  ACTIONS.indexOf('cRight'),
  ACTIONS.indexOf('cUp'),
  ACTIONS.indexOf('cDown'),
];
const C_BUTTONS = [BTN_CSTICK_LEFT, BTN_CSTICK_RIGHT, BTN_CSTICK_UP, BTN_CSTICK_DOWN];
const C_MASK = BTN_CSTICK_LEFT | BTN_CSTICK_RIGHT | BTN_CSTICK_UP | BTN_CSTICK_DOWN;
/** Bouton de chaque action, par index ; 0 pour les directions et le stick droit, traités à part. */
const BUTTONS = Uint16Array.from(ACTIONS, (action) => {
  const button = ACTION_BUTTON[action];
  return (button & C_MASK) !== 0 ? 0 : button;
});

export function createGamepadReader(initial: Bindings): GamepadReader {
  const count = ACTIONS.length;
  // Disposition aplatie, pour la lire sans rien allouer : les commandes de l'action `a` occupent
  // les cases `first[a]` à `first[a + 1] - 1`. Une direction nulle désigne un bouton.
  let first = new Uint16Array(count + 1);
  let index = new Uint8Array(0);
  let direction = new Int8Array(0);
  const stick: StickValue = { x: 0, y: 0 };
  const levels = new Float64Array(count);

  function setBindings(bindings: Bindings): void {
    let total = 0;
    for (const action of ACTIONS) {
      for (const input of bindings[action]) if (input.type !== 'key') total++;
    }
    first = new Uint16Array(count + 1);
    index = new Uint8Array(total);
    direction = new Int8Array(total);
    let n = 0;
    for (let a = 0; a < count; a++) {
      first[a] = n;
      for (const input of bindings[ACTIONS[a]!]) {
        if (input.type === 'key') continue;
        index[n] = input.index;
        direction[n] = input.type === 'axis' ? input.direction : 0;
        n++;
      }
    }
    first[count] = n;
  }
  setBindings(initial);

  return {
    setBindings,

    read(pad, settings) {
      // Intensité de chaque action, de 0 à 1 : la plus forte de ses commandes. Un seul parcours,
      // sans fonction auxiliaire qui renverrait un nombre décimal : V8 alloue un tel nombre sur le
      // tas à chaque retour d'une fonction qu'il n'a pas insérée dans l'appelant.
      for (let a = 0; a < count; a++) {
        let best = 0;
        for (let n = first[a]!; n < first[a + 1]!; n++) {
          const dir = direction[n]!;
          let v: number;
          if (dir === 0) {
            const button = pad.buttons[index[n]!];
            v = button === undefined ? 0 : button.pressed ? 1 : button.value;
          } else {
            v = (pad.axes[index[n]!] ?? 0) * dir;
          }
          if (v > best) best = v;
        }
        levels[a] = best;
      }

      shapeStick(
        levels[A_RIGHT]! - levels[A_LEFT]!,
        levels[A_UP]! - levels[A_DOWN]!,
        settings.deadzone,
        stick,
      );

      let buttons = 0;
      for (let a = 0; a < count; a++) {
        const button = BUTTONS[a]!;
        if (button !== 0 && isPressed(levels[a]!, settings.threshold)) buttons |= button;
      }
      // Stick droit : `sim-core` le lit comme quatre boutons, un seul à la fois.
      const c = dominant(
        levels[C_ACTIONS[0]!]!,
        levels[C_ACTIONS[1]!]!,
        levels[C_ACTIONS[2]!]!,
        levels[C_ACTIONS[3]!]!,
        settings.threshold,
      );
      if (c >= 0) buttons |= C_BUTTONS[c]!;

      return encodeInput(stick.x, stick.y, buttons);
    },
  };
}

/**
 * Vrai si un bouton de la manette est enfoncé, quel qu'il soit. Sert à repérer un joueur qui veut
 * rejoindre ; un stick incliné ne compte pas, il peut simplement dériver.
 */
export function anyButtonPressed(pad: PadState, threshold: number): boolean {
  for (let b = 0; b < pad.buttons.length; b++) {
    const button = pad.buttons[b]!;
    if (button.pressed || button.value >= threshold) return true;
  }
  return false;
}
