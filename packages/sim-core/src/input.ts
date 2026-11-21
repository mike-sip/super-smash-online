/**
 * Input d'un joueur pour une frame, sur un uint32 :
 *   bits 0-7   stick X, entier signé de -127 (gauche) à 127 (droite)
 *   bits 8-15  stick Y, entier signé de -127 (bas) à 127 (haut)
 *   bits 16-31 boutons
 *
 * Ce format est le contrat entre `input` (qui le produit), `netcode` (qui le transporte)
 * et la simulation. Le changer casse les replays et la compatibilité réseau.
 */
export type InputFrame = number;

export const BTN_ATTACK = 1 << 0;
export const BTN_SPECIAL = 1 << 1;
export const BTN_JUMP = 1 << 2;
export const BTN_SHIELD = 1 << 3;
export const BTN_GRAB = 1 << 4;
/** Stick droit, réduit à quatre directions : déclenche smash et aériennes directionnelles. */
export const BTN_CSTICK_UP = 1 << 5;
export const BTN_CSTICK_DOWN = 1 << 6;
export const BTN_CSTICK_LEFT = 1 << 7;
export const BTN_CSTICK_RIGHT = 1 << 8;
export const BTN_TAUNT = 1 << 9;

export const STICK_MAX = 127;

const clampStick = (v: number): number => Math.max(-STICK_MAX, Math.min(STICK_MAX, Math.trunc(v)));

export function encodeInput(stickX: number, stickY: number, buttons: number): InputFrame {
  return (
    ((clampStick(stickX) & 0xff) |
      ((clampStick(stickY) & 0xff) << 8) |
      ((buttons & 0xffff) << 16)) >>>
    0
  );
}

export const inputStickX = (i: InputFrame): number => (i << 24) >> 24;
export const inputStickY = (i: InputFrame): number => (i << 16) >> 24;
export const inputButtons = (i: InputFrame): number => i >>> 16;

/** Vrai si `button` est enfoncé à cette frame et ne l'était pas à la précédente. */
export const inputPressed = (now: InputFrame, prev: InputFrame, button: number): boolean =>
  (((now & ~prev) >>> 16) & button) !== 0;
