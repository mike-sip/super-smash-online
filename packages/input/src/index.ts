/** API publique de `input`. Tout ce qui n'est pas exporté ici est un détail interne. */
export { ACTIONS, type Action } from './actions.ts';
export {
  DEFAULT_GAMEPAD,
  DEFAULT_KEYBOARD,
  type BindingError,
  type Bindings,
  type DeviceKind,
  type PhysicalInput,
} from './bindings.ts';
export { DEFAULT_ANALOG, type AnalogSettings } from './gamepad.ts';
export type { StorageLike } from './storage.ts';
export {
  KEYBOARD_ID,
  MAX_LOCAL_PLAYERS,
  createInput,
  gamepadId,
  type Device,
  type Input,
  type InputOptions,
} from './system.ts';
