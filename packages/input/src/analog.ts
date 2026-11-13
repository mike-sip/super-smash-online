/** Mise en forme des valeurs analogiques d'une manette. Logique pure. */
import { BTN_JUMP, STICK_MAX, inputStickY, type InputFrame } from '@game/sim-core';

export interface StickValue {
  x: number;
  y: number;
}

/**
 * Inclinaison à partir de laquelle le stick est considéré à fond. Beaucoup de sticks s'arrêtent
 * un peu avant leur butée théorique : sans cette marge, ils n'atteindraient jamais 127.
 */
const FULL_REACH = 0.95;

/**
 * Ramène un stick brut (x et y de -1 à 1) sur ±127, zone morte retirée et diagonales étirées
 * pour qu'un stick poussé à fond dans un coin donne 127 sur les deux axes. N'alloue rien.
 *
 * `sim-core` exige 96 sur un axe pour un dash ou un smash, or un stick rond poussé en diagonale
 * ne donne qu'environ 90 sur chacun. La course ronde est donc étirée vers un carré : la direction
 * du geste est conservée, seule son amplitude change, et un geste proche d'un axe n'est
 * pratiquement pas modifié.
 */
export function shapeStick(x: number, y: number, deadzone: number, out: StickValue): void {
  // Pas `Math.hypot` : V8 lui alloue un tableau d'arguments à chaque appel (environ 48 octets),
  // et sa protection contre le débordement est inutile pour des valeurs de -1 à 1.
  const size = Math.sqrt(x * x + y * y);
  // Repos, dérive du stick, ou valeur aberrante (NaN) : le stick est au neutre.
  if (!(size > deadzone) || !(size > 0)) {
    out.x = 0;
    out.y = 0;
    return;
  }
  // Zone morte radiale : la course utile repart de zéro à sa sortie, sans à-coup.
  const span = FULL_REACH - deadzone;
  const reach = span > 0 ? Math.min(1, (size - deadzone) / span) : 1;
  // Du cercle au carré : on divise par la plus grande composante de la direction.
  const stretch = reach / Math.max(Math.abs(x), Math.abs(y));
  out.x = toStick(x * stretch);
  out.y = toStick(y * stretch);
}

/** Entier de -127 à 127, arrondi de la même façon des deux côtés de zéro. */
function toStick(value: number): number {
  const scaled = Math.min(STICK_MAX, Math.round(Math.abs(value) * STICK_MAX));
  if (scaled === 0) return 0;
  return value < 0 ? -scaled : scaled;
}

/**
 * Index de la plus forte de quatre valeurs si elle atteint `threshold`, sinon -1. Sert au stick
 * droit, que `sim-core` lit comme quatre boutons : une seule direction à la fois. À égalité, la
 * première l'emporte.
 */
export function dominant(a: number, b: number, c: number, d: number, threshold: number): number {
  let best = 0;
  let value = a;
  if (b > value) {
    best = 1;
    value = b;
  }
  if (c > value) {
    best = 2;
    value = c;
  }
  if (d > value) {
    best = 3;
    value = d;
  }
  return value >= threshold ? best : -1;
}

/** Vrai si une valeur analogique (gâchette, demi-axe) compte comme un bouton enfoncé. */
export const isPressed = (value: number, threshold: number): boolean => value >= threshold;

/**
 * Inclinaison du stick vers le haut à partir de laquelle l'option « saut au stick » fait sauter :
 * au-dessus de la demi-inclinaison, pour qu'une attaque dirigée vers le haut reste possible.
 */
export const TAP_JUMP_STICK = 80;

/** Ajoute le bouton de saut à un input dont le stick est poussé franchement vers le haut. */
export function withTapJump(frame: InputFrame): InputFrame {
  return inputStickY(frame) >= TAP_JUMP_STICK ? (frame | (BTN_JUMP << 16)) >>> 0 : frame;
}
