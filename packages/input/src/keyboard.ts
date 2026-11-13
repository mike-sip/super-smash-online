/**
 * État du clavier : des appuis et des relâchements en entrée, un `InputFrame` par lecture.
 *
 * Aucune dépendance au DOM : `system.ts` lui transmet les événements, les tests les simulent.
 * Les événements arrivent à tout moment ; la lecture se fait une fois par frame simulée.
 */
import { STICK_MAX, encodeInput, type InputFrame } from '@game/sim-core';
import { ACTIONS, ACTION_BUTTON, A_DOWN, A_LEFT, A_RIGHT, A_UP, A_WALK } from './actions.ts';
import type { Bindings } from './bindings.ts';

/**
 * Inclinaison du stick avec la touche de marche : au-dessus du seuil des attaques dirigées de
 * `sim-core` (40), en dessous de celui de la course (64).
 */
export const HALF_STICK = 56;

export interface KeyboardState {
  /** Enregistre l'appui d'une touche. Renvoie vrai si elle commande une action. */
  press(code: string): boolean;
  release(code: string): void;
  /** Relâche tout, par exemple à la perte du focus. */
  releaseAll(): void;
  /** Vrai si la touche commande une action dans la disposition en cours. */
  handles(code: string): boolean;
  /** Remplace la disposition ; tout est relâché. */
  setBindings(bindings: Bindings): void;
  /** Input du clavier pour cette frame. À appeler une fois par frame simulée. N'alloue rien. */
  sample(): InputFrame;
}

export function createKeyboardState(initial: Bindings): KeyboardState {
  const count = ACTIONS.length;
  /** Action commandée par chaque touche. */
  const actionOf = new Map<string, number>();
  /** Touches actuellement enfoncées. */
  const down = new Set<string>();
  /** Nombre de touches enfoncées par action : plusieurs touches peuvent commander la même. */
  const held = new Uint8Array(count);
  /**
   * 1 si l'action a été enfoncée depuis la dernière lecture. Un appui relâché avant la lecture
   * suivante reste ainsi visible une frame, et une seule.
   */
  const tapped = new Uint8Array(count);
  /** Rang du dernier appui de chaque action, pour départager deux directions opposées. */
  const order = new Uint32Array(count);
  let presses = 0;

  function clear(): void {
    down.clear();
    held.fill(0);
    tapped.fill(0);
    order.fill(0);
  }

  function setBindings(bindings: Bindings): void {
    actionOf.clear();
    clear();
    for (let a = 0; a < count; a++) {
      for (const input of bindings[ACTIONS[a]!]) {
        if (input.type === 'key') actionOf.set(input.code, a);
      }
    }
  }
  setBindings(initial);

  const active = (action: number): boolean => held[action]! > 0 || tapped[action] === 1;

  /** -1, 0 ou 1 : laquelle de deux directions opposées l'emporte. La dernière enfoncée gagne. */
  function axis(negative: number, positive: number): number {
    const neg = active(negative);
    const pos = active(positive);
    if (neg && pos) return order[positive]! > order[negative]! ? 1 : -1;
    return pos ? 1 : neg ? -1 : 0;
  }

  return {
    press(code) {
      const action = actionOf.get(code);
      if (action === undefined) return false;
      // Une touche déjà enfoncée : répétition automatique du clavier.
      if (down.has(code)) return true;
      down.add(code);
      held[action] = held[action]! + 1;
      tapped[action] = 1;
      order[action] = ++presses;
      return true;
    },

    release(code) {
      if (!down.delete(code)) return;
      const action = actionOf.get(code)!;
      held[action] = held[action]! - 1;
    },

    releaseAll: clear,

    handles: (code) => actionOf.has(code),

    setBindings,

    sample() {
      const reach = active(A_WALK) ? HALF_STICK : STICK_MAX;
      const x = axis(A_LEFT, A_RIGHT) * reach;
      const y = axis(A_DOWN, A_UP) * reach;
      let buttons = 0;
      for (let a = 0; a < count; a++) {
        if (active(a)) buttons |= ACTION_BUTTON[ACTIONS[a]!];
      }
      tapped.fill(0);
      return encodeInput(x, y, buttons);
    },
  };
}
