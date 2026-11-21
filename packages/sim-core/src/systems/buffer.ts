/**
 * Tampon d'inputs : un appui reste valable quelques frames, pour qu'une action demandée un peu
 * trop tôt parte dès que le combattant redevient libre. Tourne même pendant le hitlag.
 */
import {
  BTN_ATTACK,
  BTN_CSTICK_DOWN,
  BTN_CSTICK_LEFT,
  BTN_CSTICK_RIGHT,
  BTN_CSTICK_UP,
  BTN_GRAB,
  BTN_JUMP,
  BTN_SHIELD,
  BTN_SPECIAL,
} from '../input.ts';
import type { Sim } from '../step.ts';

export const BUFFER_FRAMES = 6;
/** Un appui sur bouclier dans les 20 frames avant un contact vaut rétablissement. */
export const TECH_WINDOW_FRAMES = 20;
/** Après un appui, la fenêtre ne peut pas être rouverte avant ce délai : marteler ne sert à rien. */
export const TECH_LOCKOUT_FRAMES = 40;

export const C_UP = 1;
export const C_DOWN = 2;
export const C_LEFT = 3;
export const C_RIGHT = 4;

export function updateBuffers(sim: Sim, i: number): void {
  const s = sim.state;
  // Boutons qui viennent d'être enfoncés à cette frame.
  const pressed = ((s.input[i]! & ~s.prevInput[i]!) >>> 16) & 0xffff;

  if (s.bufJump[i]! > 0) s.bufJump[i] = s.bufJump[i]! - 1;
  if (s.bufAttack[i]! > 0) s.bufAttack[i] = s.bufAttack[i]! - 1;
  if (s.bufSpecial[i]! > 0) s.bufSpecial[i] = s.bufSpecial[i]! - 1;
  if (s.techWindow[i]! > 0) s.techWindow[i] = s.techWindow[i]! - 1;
  if (s.techLock[i]! > 0) s.techLock[i] = s.techLock[i]! - 1;
  if (s.bufShield[i]! > 0) s.bufShield[i] = s.bufShield[i]! - 1;
  if (s.bufGrab[i]! > 0) s.bufGrab[i] = s.bufGrab[i]! - 1;
  const c = s.bufC[i]!;
  if (c !== 0) s.bufC[i] = (c & 0xff) > 1 ? c - 1 : 0;

  if ((pressed & BTN_JUMP) !== 0) s.bufJump[i] = BUFFER_FRAMES;
  if ((pressed & BTN_ATTACK) !== 0) s.bufAttack[i] = BUFFER_FRAMES;
  if ((pressed & BTN_SPECIAL) !== 0) s.bufSpecial[i] = BUFFER_FRAMES;
  if ((pressed & BTN_GRAB) !== 0) s.bufGrab[i] = BUFFER_FRAMES;
  if ((pressed & BTN_SHIELD) !== 0) {
    s.bufShield[i] = BUFFER_FRAMES;
    if (s.techLock[i] === 0) {
      s.techWindow[i] = TECH_WINDOW_FRAMES;
      s.techLock[i] = TECH_LOCKOUT_FRAMES;
    }
  }

  if ((pressed & BTN_CSTICK_UP) !== 0) s.bufC[i] = BUFFER_FRAMES | (C_UP << 8);
  else if ((pressed & BTN_CSTICK_DOWN) !== 0) s.bufC[i] = BUFFER_FRAMES | (C_DOWN << 8);
  else if ((pressed & BTN_CSTICK_LEFT) !== 0) s.bufC[i] = BUFFER_FRAMES | (C_LEFT << 8);
  else if ((pressed & BTN_CSTICK_RIGHT) !== 0) s.bufC[i] = BUFFER_FRAMES | (C_RIGHT << 8);
}
