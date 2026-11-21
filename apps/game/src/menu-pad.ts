/**
 * Manette dans les menus. Lit l'état des manettes à chaque image (hors combat) et en tire des
 * actions de menu, sans toucher aux dispositions de jeu d'`input` :
 *
 * - disposition standard : croix (12 à 15) et stick gauche déplacent, A (0) valide, B (1)
 *   revient, Start (9) ouvre ou ferme la pause ;
 * - autre disposition : stick (axes 0 et 1), premier bouton valide, deuxième revient.
 *
 * Les directions se répètent si on les tient (400 ms, puis toutes les 120 ms). Ce qui est
 * enfoncé quand une manette apparaît, ou après `suspend()`, ne compte qu'après relâchement.
 */
import type { Direction } from './nav.ts';

export interface PadSnapshot {
  readonly index: number;
  readonly standard: boolean;
  readonly buttons: readonly boolean[];
  readonly axes: readonly number[];
}

export type MenuAction =
  | { readonly type: 'move'; readonly dir: Direction; readonly pad: number }
  | { readonly type: 'confirm' | 'back' | 'start'; readonly pad: number };

export const REPEAT_DELAY_MS = 400;
export const REPEAT_EVERY_MS = 120;
export const STICK_DEADZONE = 0.5;

const DPAD: readonly (readonly [number, Direction])[] = [
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
];

interface PadState {
  /** Boutons et direction tenus, à relâcher avant d'agir. */
  held: Set<string>;
  dir: Direction | null;
  nextRepeat: number;
}

function stickDirection(axes: readonly number[]): Direction | null {
  const x = axes[0] ?? 0;
  const y = axes[1] ?? 0;
  if (Math.max(Math.abs(x), Math.abs(y)) < STICK_DEADZONE) return null;
  if (Math.abs(x) >= Math.abs(y)) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'down' : 'up';
}

function direction(p: PadSnapshot): Direction | null {
  if (p.standard) {
    for (const [button, dir] of DPAD) if (p.buttons[button] === true) return dir;
  }
  return stickDirection(p.axes);
}

function pressedKeys(p: PadSnapshot): Map<string, MenuAction['type']> {
  const keys = new Map<string, MenuAction['type']>();
  if (p.buttons[0] === true) keys.set('b0', 'confirm');
  if (p.buttons[1] === true) keys.set('b1', 'back');
  if (p.buttons[9] === true) keys.set('b9', 'start');
  return keys;
}

export interface MenuPad {
  update(pads: readonly PadSnapshot[], now: number): MenuAction[];
  /** Tout ce qui est tenu en ce moment devra être relâché avant de compter. */
  suspend(): void;
}

export function createMenuPad(): MenuPad {
  let states = new Map<number, PadState>();
  let suspended = false;

  return {
    update(pads, now) {
      const actions: MenuAction[] = [];
      const next = new Map<number, PadState>();
      for (const p of pads) {
        const keys = pressedKeys(p);
        const dir = direction(p);
        let state = states.get(p.index);
        if (state === undefined || suspended) {
          // Nouvelle manette, ou retour de combat : ce qui est tenu ne compte pas.
          state = {
            held: new Set([...keys.keys(), ...(dir === null ? [] : ['dir'])]),
            dir,
            nextRepeat: Infinity,
          };
          next.set(p.index, state);
          continue;
        }
        for (const key of [...state.held]) {
          if (key === 'dir' ? dir === null : !keys.has(key)) state.held.delete(key);
        }
        for (const [key, type] of keys) {
          if (state.held.has(key)) continue;
          state.held.add(key);
          actions.push({ type, pad: p.index } as MenuAction);
        }
        if (dir === null) {
          state.dir = null;
        } else if (!state.held.has('dir')) {
          if (dir !== state.dir) {
            state.dir = dir;
            state.nextRepeat = now + REPEAT_DELAY_MS;
            actions.push({ type: 'move', dir, pad: p.index });
          } else if (now >= state.nextRepeat) {
            state.nextRepeat = now + REPEAT_EVERY_MS;
            actions.push({ type: 'move', dir, pad: p.index });
          }
        }
        next.set(p.index, state);
      }
      states = next;
      suspended = false;
      return actions;
    },
    suspend() {
      suspended = true;
    },
  };
}

/** Instantanés des manettes branchées, depuis l'API Gamepad du navigateur. */
export function readGamepads(source: () => readonly (Gamepad | null)[]): PadSnapshot[] {
  const out: PadSnapshot[] = [];
  let pads: readonly (Gamepad | null)[];
  try {
    pads = source();
  } catch {
    return out;
  }
  for (const pad of pads) {
    if (pad === null || !pad.connected) continue;
    out.push({
      index: pad.index,
      standard: pad.mapping === 'standard',
      buttons: pad.buttons.map((b) => b.pressed),
      axes: pad.axes,
    });
  }
  return out;
}
