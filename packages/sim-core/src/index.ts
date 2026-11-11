/** API publique de `sim-core`. Tout ce qui n'est pas exporté ici est un détail interne. */
import { G_FRAME, STATE_BYTES, checksumState, loadInto, saveFrom } from './state.ts';
import type { EventQueue } from './events.ts';
import type { Sim } from './step.ts';

export { fx, fxToFloat, FX_ONE, type Fx } from './fixed.ts';
export type { FighterDef, PlatformDef, SolidDef, StageDef, Vec2 } from './defs.ts';
export {
  A_IDLE,
  A_WALK,
  A_DASH,
  A_RUN,
  A_BRAKE,
  A_TURN,
  A_CROUCH,
  A_JUMPSQUAT,
  A_AIR,
  A_LAND,
  A_DEAD,
} from './actions.ts';
export { EV_KO, MAX_EVENTS, type EventQueue } from './events.ts';
export {
  BTN_ATTACK,
  BTN_SPECIAL,
  BTN_JUMP,
  BTN_SHIELD,
  BTN_GRAB,
  BTN_CSTICK_UP,
  BTN_CSTICK_DOWN,
  BTN_CSTICK_LEFT,
  BTN_CSTICK_RIGHT,
  BTN_TAUNT,
  STICK_MAX,
  encodeInput,
  inputStickX,
  inputStickY,
  inputButtons,
  inputPressed,
  type InputFrame,
} from './input.ts';
export { MAX_PLAYERS, MAX_ENTITIES, STATE_BYTES } from './state.ts';
export { createSim, respawn, step, type Sim, type SimConfig } from './step.ts';
export { readFighter, type FighterView } from './view.ts';

function checkSize(buf: Uint8Array): void {
  if (buf.length < STATE_BYTES) {
    throw new Error(`Le tampon doit faire au moins STATE_BYTES (${STATE_BYTES}) octets.`);
  }
}

/** Copie l'état complet dans `out` (au moins `STATE_BYTES` octets). */
export function saveState(sim: Sim, out: Uint8Array): void {
  checkSize(out);
  saveFrom(sim.state, out);
}

/** Remplace l'état complet par celui de `from`, produit par `saveState`. */
export function loadState(sim: Sim, from: Uint8Array): void {
  checkSize(from);
  loadInto(sim.state, from);
}

/** Empreinte de l'état sur 32 bits, pour détecter les désynchronisations. */
export function checksum(sim: Sim): number {
  return checksumState(sim.state);
}

/** Événements émis pendant la dernière frame. La file est réutilisée : la lire avant le `step` suivant. */
export function events(sim: Sim): EventQueue {
  return sim.events;
}

/** Nombre de frames simulées depuis la création. */
export function frame(sim: Sim): number {
  return sim.state.g[G_FRAME]!;
}
