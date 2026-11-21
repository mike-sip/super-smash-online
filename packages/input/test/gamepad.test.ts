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
  inputButtons,
  inputStickX,
  inputStickY,
} from '@game/sim-core';
import { DEFAULT_GAMEPAD, type Bindings } from '../src/bindings.ts';
import { anyButtonPressed, createGamepadReader, type AnalogSettings } from '../src/gamepad.ts';
import { fakePad } from './helpers.ts';

const SETTINGS: AnalogSettings = { deadzone: 0.15, threshold: 0.5 };

function read(pad: ReturnType<typeof fakePad>, bindings: Bindings = DEFAULT_GAMEPAD) {
  const frame = createGamepadReader(bindings).read(pad, SETTINGS);
  return { x: inputStickX(frame), y: inputStickY(frame), buttons: inputButtons(frame) };
}

describe('lecture d’une manette', () => {
  it('ne produit rien au repos', () => {
    expect(read(fakePad())).toEqual({ x: 0, y: 0, buttons: 0 });
  });

  it('lit le stick gauche, l’axe vertical retourné vers le haut', () => {
    expect(read(fakePad({ axes: [1, 0, 0, 0] }))).toMatchObject({ x: 127, y: 0 });
    expect(read(fakePad({ axes: [-1, 0, 0, 0] }))).toMatchObject({ x: -127, y: 0 });
    // L'API Gamepad compte vers le bas : -1 est le haut.
    expect(read(fakePad({ axes: [0, -1, 0, 0] }))).toMatchObject({ x: 0, y: 127 });
    expect(read(fakePad({ axes: [0, 1, 0, 0] }))).toMatchObject({ x: 0, y: -127 });
  });

  it('applique la zone morte et l’étirement des diagonales', () => {
    expect(read(fakePad({ axes: [0.1, -0.08, 0, 0] }))).toMatchObject({ x: 0, y: 0 });
    const d = Math.SQRT1_2;
    expect(read(fakePad({ axes: [d, -d, 0, 0] }))).toMatchObject({ x: 127, y: 127 });
    const half = read(fakePad({ axes: [0.5, 0, 0, 0] })).x;
    expect(half).toBeGreaterThanOrEqual(40);
    expect(half).toBeLessThan(64);
  });

  it('lit chaque bouton de la disposition standard', () => {
    const cases: [index: number, button: number][] = [
      [0, BTN_ATTACK],
      [1, BTN_SPECIAL],
      [2, BTN_JUMP],
      [3, BTN_JUMP],
      [4, BTN_GRAB],
      [5, BTN_GRAB],
      [6, BTN_SHIELD],
      [7, BTN_SHIELD],
      [12, BTN_TAUNT],
    ];
    for (const [index, button] of cases) {
      expect(read(fakePad({ pressed: [index] })).buttons).toBe(button);
    }
    expect(read(fakePad({ pressed: [0, 2, 6] })).buttons).toBe(BTN_ATTACK | BTN_JUMP | BTN_SHIELD);
  });

  it('ignore les boutons sans action', () => {
    expect(read(fakePad({ pressed: [8, 9, 10, 11, 13, 14, 15, 16] })).buttons).toBe(0);
  });

  it('compte une gâchette analogique comme enfoncée à partir du seuil', () => {
    expect(read(fakePad({ values: { 7: 0.3 } })).buttons).toBe(0);
    expect(read(fakePad({ values: { 7: 0.5 } })).buttons).toBe(BTN_SHIELD);
    expect(read(fakePad({ values: { 6: 1 } })).buttons).toBe(BTN_SHIELD);
  });

  it('ramène le stick droit à une seule direction, la dominante', () => {
    expect(read(fakePad({ axes: [0, 0, 1, 0] })).buttons).toBe(BTN_CSTICK_RIGHT);
    expect(read(fakePad({ axes: [0, 0, -1, 0] })).buttons).toBe(BTN_CSTICK_LEFT);
    expect(read(fakePad({ axes: [0, 0, 0, -1] })).buttons).toBe(BTN_CSTICK_UP);
    expect(read(fakePad({ axes: [0, 0, 0, 1] })).buttons).toBe(BTN_CSTICK_DOWN);
    expect(read(fakePad({ axes: [0, 0, 0.9, -0.6] })).buttons).toBe(BTN_CSTICK_RIGHT);
    expect(read(fakePad({ axes: [0, 0, 0.6, -0.9] })).buttons).toBe(BTN_CSTICK_UP);
    expect(read(fakePad({ axes: [0, 0, 0.4, 0.3] })).buttons).toBe(0);
  });

  it('supporte une manette avec moins d’axes ou de boutons que prévu', () => {
    expect(read(fakePad({ axes: [1], buttonCount: 2, pressed: [1] }))).toEqual({
      x: 127,
      y: 0,
      buttons: BTN_SPECIAL,
    });
    expect(read(fakePad({ axes: [], buttonCount: 0 }))).toEqual({ x: 0, y: 0, buttons: 0 });
  });

  it('suit une disposition réassignée : stick sur la croix, saut sur un demi-axe', () => {
    const bindings: Bindings = {
      ...DEFAULT_GAMEPAD,
      left: [{ type: 'button', index: 14 }],
      right: [{ type: 'button', index: 15 }],
      up: [{ type: 'button', index: 12 }],
      down: [{ type: 'button', index: 13 }],
      taunt: [],
      jump: [{ type: 'axis', index: 1, direction: -1 }],
    };
    expect(read(fakePad({ pressed: [15, 12] }), bindings)).toMatchObject({ x: 127, y: 127 });
    expect(read(fakePad({ pressed: [14] }), bindings)).toMatchObject({ x: -127, y: 0 });
    expect(read(fakePad({ axes: [0, -0.8, 0, 0] }), bindings).buttons).toBe(BTN_JUMP);
    expect(read(fakePad({ axes: [0, -0.3, 0, 0] }), bindings).buttons).toBe(0);
  });

  it('prend la plus forte de deux commandes d’une même direction', () => {
    const bindings: Bindings = {
      ...DEFAULT_GAMEPAD,
      right: [
        { type: 'axis', index: 0, direction: 1 },
        { type: 'button', index: 15 },
      ],
    };
    expect(read(fakePad({ axes: [0.3, 0, 0, 0], pressed: [15] }), bindings).x).toBe(127);
  });

  it('ignore les commandes qui ne sont pas celles d’une manette', () => {
    const bindings: Bindings = { ...DEFAULT_GAMEPAD, taunt: [{ type: 'key', code: 'KeyT' }] };
    expect(read(fakePad({ pressed: [12] }), bindings).buttons).toBe(0);
  });
});

describe('anyButtonPressed', () => {
  it('repère un bouton enfoncé, quel qu’il soit', () => {
    expect(anyButtonPressed(fakePad(), 0.5)).toBe(false);
    expect(anyButtonPressed(fakePad({ pressed: [9] }), 0.5)).toBe(true);
    expect(anyButtonPressed(fakePad({ values: { 7: 0.8 } }), 0.5)).toBe(true);
    expect(anyButtonPressed(fakePad({ values: { 7: 0.2 } }), 0.5)).toBe(false);
  });

  it('ne prend pas un stick incliné pour une demande', () => {
    expect(anyButtonPressed(fakePad({ axes: [1, 1, 1, 1] }), 0.5)).toBe(false);
  });
});
