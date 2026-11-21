import { describe, expect, it } from 'vitest';
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
  BTN_TAUNT,
} from '@game/sim-core';
import { ACTIONS, ACTION_BUTTON, REQUIRED_ACTIONS, type Action } from '../src/actions.ts';
import {
  DEFAULT_GAMEPAD,
  DEFAULT_KEYBOARD,
  sameInput,
  validateBindings,
  type Bindings,
  type PhysicalInput,
} from '../src/bindings.ts';

const key = (code: string): PhysicalInput => ({ type: 'key', code });
const withAction = (base: Bindings, action: Action, inputs: PhysicalInput[]): Bindings => ({
  ...base,
  [action]: inputs,
});

describe('actions', () => {
  it('associe chaque action de bouton à son bit dans InputFrame', () => {
    expect(ACTION_BUTTON.attack).toBe(BTN_ATTACK);
    expect(ACTION_BUTTON.special).toBe(BTN_SPECIAL);
    expect(ACTION_BUTTON.jump).toBe(BTN_JUMP);
    expect(ACTION_BUTTON.shield).toBe(BTN_SHIELD);
    expect(ACTION_BUTTON.grab).toBe(BTN_GRAB);
    expect(ACTION_BUTTON.taunt).toBe(BTN_TAUNT);
    expect(ACTION_BUTTON.cLeft).toBe(BTN_CSTICK_LEFT);
    expect(ACTION_BUTTON.cRight).toBe(BTN_CSTICK_RIGHT);
    expect(ACTION_BUTTON.cUp).toBe(BTN_CSTICK_UP);
    expect(ACTION_BUTTON.cDown).toBe(BTN_CSTICK_DOWN);
  });

  it('ne donne aucun bouton aux directions du stick ni à la touche de marche', () => {
    for (const action of ['left', 'right', 'up', 'down', 'walk'] as const) {
      expect(ACTION_BUTTON[action]).toBe(0);
    }
  });

  it('donne un bit distinct à chaque action de bouton', () => {
    const bits = ACTIONS.map((a) => ACTION_BUTTON[a]).filter((b) => b !== 0);
    expect(new Set(bits).size).toBe(bits.length);
  });
});

describe('dispositions par défaut', () => {
  it('reprend au clavier la disposition validée', () => {
    expect(DEFAULT_KEYBOARD.left).toEqual([key('ArrowLeft')]);
    expect(DEFAULT_KEYBOARD.right).toEqual([key('ArrowRight')]);
    expect(DEFAULT_KEYBOARD.up).toEqual([key('ArrowUp')]);
    expect(DEFAULT_KEYBOARD.down).toEqual([key('ArrowDown')]);
    // KeyW est la touche marquée Z sur un clavier AZERTY : le saut répond aux deux.
    expect(DEFAULT_KEYBOARD.jump).toEqual([key('KeyZ'), key('KeyW')]);
    expect(DEFAULT_KEYBOARD.attack).toEqual([key('KeyX')]);
    expect(DEFAULT_KEYBOARD.special).toEqual([key('KeyC')]);
    expect(DEFAULT_KEYBOARD.shield).toEqual([key('KeyV')]);
    expect(DEFAULT_KEYBOARD.grab).toEqual([key('KeyB')]);
    expect(DEFAULT_KEYBOARD.cUp).toEqual([key('KeyI')]);
    expect(DEFAULT_KEYBOARD.cLeft).toEqual([key('KeyJ')]);
    expect(DEFAULT_KEYBOARD.cDown).toEqual([key('KeyK')]);
    expect(DEFAULT_KEYBOARD.cRight).toEqual([key('KeyL')]);
    expect(DEFAULT_KEYBOARD.walk).toEqual([key('ShiftLeft'), key('ShiftRight')]);
  });

  it('place à la manette le stick gauche, les boutons et le stick droit', () => {
    expect(DEFAULT_GAMEPAD.left).toEqual([{ type: 'axis', index: 0, direction: -1 }]);
    expect(DEFAULT_GAMEPAD.right).toEqual([{ type: 'axis', index: 0, direction: 1 }]);
    // L'axe vertical de l'API Gamepad pointe vers le bas.
    expect(DEFAULT_GAMEPAD.up).toEqual([{ type: 'axis', index: 1, direction: -1 }]);
    expect(DEFAULT_GAMEPAD.down).toEqual([{ type: 'axis', index: 1, direction: 1 }]);
    expect(DEFAULT_GAMEPAD.attack).toEqual([{ type: 'button', index: 0 }]);
    expect(DEFAULT_GAMEPAD.special).toEqual([{ type: 'button', index: 1 }]);
    expect(DEFAULT_GAMEPAD.jump.length).toBe(2);
    expect(DEFAULT_GAMEPAD.shield.length).toBe(2);
    expect(DEFAULT_GAMEPAD.grab.length).toBe(2);
    expect(DEFAULT_GAMEPAD.cRight).toEqual([{ type: 'axis', index: 2, direction: 1 }]);
    expect(DEFAULT_GAMEPAD.cUp).toEqual([{ type: 'axis', index: 3, direction: -1 }]);
  });

  it('sont complètes, sans conflit et valides pour leur périphérique', () => {
    expect(validateBindings('keyboard', DEFAULT_KEYBOARD)).toBeNull();
    expect(validateBindings('gamepad', DEFAULT_GAMEPAD)).toBeNull();
    for (const bindings of [DEFAULT_KEYBOARD, DEFAULT_GAMEPAD]) {
      for (const action of ACTIONS) expect(Array.isArray(bindings[action])).toBe(true);
      for (const action of REQUIRED_ACTIONS) expect(bindings[action].length).toBeGreaterThan(0);
    }
  });
});

describe('validateBindings', () => {
  it('refuse une action indispensable sans commande', () => {
    expect(validateBindings('keyboard', withAction(DEFAULT_KEYBOARD, 'jump', []))).toEqual({
      reason: 'missing',
      action: 'jump',
    });
  });

  it('accepte une action facultative sans commande', () => {
    expect(validateBindings('keyboard', withAction(DEFAULT_KEYBOARD, 'taunt', []))).toBeNull();
    expect(validateBindings('keyboard', withAction(DEFAULT_KEYBOARD, 'walk', []))).toBeNull();
    expect(validateBindings('keyboard', withAction(DEFAULT_KEYBOARD, 'cUp', []))).toBeNull();
  });

  it('refuse une même commande pour deux actions', () => {
    const bindings = withAction(DEFAULT_KEYBOARD, 'grab', [key('KeyX')]);
    expect(validateBindings('keyboard', bindings)).toEqual({
      reason: 'conflict',
      action: 'attack',
      other: 'grab',
      input: key('KeyX'),
    });
  });

  it('refuse la même commande citée deux fois pour une action', () => {
    const bindings = withAction(DEFAULT_KEYBOARD, 'grab', [key('KeyB'), key('KeyB')]);
    expect(validateBindings('keyboard', bindings)?.reason).toBe('conflict');
  });

  it('refuse une commande qui n’appartient pas au périphérique', () => {
    const button: PhysicalInput = { type: 'button', index: 0 };
    expect(validateBindings('keyboard', withAction(DEFAULT_KEYBOARD, 'grab', [button]))).toEqual({
      reason: 'wrong-device',
      action: 'grab',
      input: button,
    });
    expect(
      validateBindings('gamepad', withAction(DEFAULT_GAMEPAD, 'grab', [key('KeyB')]))?.reason,
    ).toBe('wrong-device');
  });

  it('refuse une commande mal formée', () => {
    const cases: PhysicalInput[] = [
      key(''),
      { type: 'button', index: -1 },
      { type: 'button', index: 1.5 },
      { type: 'axis', index: 0, direction: 0 as 1 },
    ];
    for (const input of cases) {
      const kind = input.type === 'key' ? 'keyboard' : 'gamepad';
      const base = kind === 'keyboard' ? DEFAULT_KEYBOARD : DEFAULT_GAMEPAD;
      expect(validateBindings(kind, withAction(base, 'taunt', [input]))?.reason).toBe('invalid');
    }
  });

  it('refuse une disposition à laquelle il manque une action', () => {
    const partial = { ...DEFAULT_KEYBOARD } as Record<string, unknown>;
    delete partial.shield;
    expect(validateBindings('keyboard', partial as Bindings)).toEqual({
      reason: 'missing',
      action: 'shield',
    });
  });
});

describe('sameInput', () => {
  it('compare deux commandes par leur contenu', () => {
    expect(sameInput(key('KeyX'), key('KeyX'))).toBe(true);
    expect(sameInput(key('KeyX'), key('KeyC'))).toBe(false);
    expect(sameInput({ type: 'button', index: 2 }, { type: 'button', index: 2 })).toBe(true);
    expect(sameInput({ type: 'button', index: 2 }, { type: 'axis', index: 2, direction: 1 })).toBe(
      false,
    );
    expect(
      sameInput(
        { type: 'axis', index: 0, direction: 1 },
        { type: 'axis', index: 0, direction: -1 },
      ),
    ).toBe(false);
  });
});
