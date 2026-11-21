/**
 * Remappage : reconnaître la prochaine commande actionnée sur une manette. Logique pure.
 *
 * Une manette n'émet pas d'événement : on compare son état à celui qu'elle avait quand la capture
 * a commencé. Ce qui était déjà enfoncé ou incliné à ce moment-là ne compte pas.
 */
import type { PhysicalInput } from './bindings.ts';
import type { PadState } from './gamepad.ts';

/** État d'une manette au début d'une capture. */
export interface PadBaseline {
  readonly axes: readonly number[];
  readonly pressed: readonly boolean[];
}

/** Déplacement d'un axe, depuis sa position de départ, à partir duquel il est retenu. */
const AXIS_TRAVEL = 0.6;

const isDown = (button: PadState['buttons'][number], threshold: number): boolean =>
  button.pressed || button.value >= threshold;

export function createPadBaseline(pad: PadState, threshold = 0.5): PadBaseline {
  return {
    axes: Array.from(pad.axes),
    pressed: pad.buttons.map((button) => isDown(button, threshold)),
  };
}

/**
 * Première commande actionnée depuis `baseline`, ou `null`. Un bouton nouvellement enfoncé
 * l'emporte sur un axe : appuyer sur un bouton fait souvent bouger un stick au passage.
 */
export function detectPadInput(
  baseline: PadBaseline,
  pad: PadState,
  threshold: number,
): PhysicalInput | null {
  for (let b = 0; b < pad.buttons.length; b++) {
    if (isDown(pad.buttons[b]!, threshold) && baseline.pressed[b] !== true) {
      return { type: 'button', index: b };
    }
  }
  for (let a = 0; a < pad.axes.length; a++) {
    const value = pad.axes[a]!;
    const travel = value - (baseline.axes[a] ?? 0);
    if (Math.abs(travel) >= AXIS_TRAVEL && Math.abs(value) >= threshold) {
      return { type: 'axis', index: a, direction: value > 0 ? 1 : -1 };
    }
  }
  return null;
}
