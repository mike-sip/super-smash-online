import { describe, expect, it } from 'vitest';
import {
  BTN_ATTACK,
  BTN_GRAB,
  BTN_JUMP,
  encodeInput,
  inputButtons,
  inputStickX,
  inputStickY,
} from '@game/sim-core';
import { withTapJump } from '../src/analog.ts';
import {
  DEFAULT_ANALOG,
  DEFAULT_GAMEPAD,
  DEFAULT_KEYBOARD,
  KEYBOARD_ID,
  createInput,
  gamepadId,
  type Bindings,
} from '../src/index.ts';
import { STORAGE_KEY } from '../src/storage.ts';
import { fakePad, fakeWindow, memoryStorage } from './helpers.ts';

function setup(storage = memoryStorage(), players = 2) {
  const fake = fakeWindow();
  const input = createInput({ target: fake.window, players, storage });
  const out = new Uint32Array(players);
  const sample = (): number[] => {
    input.sample(out);
    return Array.from(out);
  };
  return { fake, input, sample, storage };
}

const spaceJump: Bindings = { ...DEFAULT_KEYBOARD, jump: [{ type: 'key', code: 'Space' }] };

describe('dispositions du clavier', () => {
  it('applique et enregistre une disposition valide', () => {
    const t = setup();
    t.input.assign(0, KEYBOARD_ID);
    expect(t.input.setBindings(KEYBOARD_ID, spaceJump)).toBeNull();
    expect(t.input.bindings(KEYBOARD_ID)).toEqual(spaceJump);
    t.fake.keyDown('KeyZ');
    expect(t.sample()[0]).toBe(0);
    t.fake.keyDown('Space');
    expect(t.sample()[0]).toBe(encodeInput(0, 0, BTN_JUMP));
    expect(t.storage.getItem(STORAGE_KEY)).toContain('Space');
  });

  it('refuse une disposition invalide en donnant la raison, sans rien changer', () => {
    const t = setup();
    const conflict: Bindings = { ...DEFAULT_KEYBOARD, grab: [{ type: 'key', code: 'KeyX' }] };
    expect(t.input.setBindings(KEYBOARD_ID, conflict)).toMatchObject({
      reason: 'conflict',
      action: 'attack',
      other: 'grab',
    });
    expect(t.input.setBindings(KEYBOARD_ID, DEFAULT_GAMEPAD)?.reason).toBe('wrong-device');
    expect(t.input.bindings(KEYBOARD_ID)).toEqual(DEFAULT_KEYBOARD);
    expect(t.storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('revient à la disposition par défaut', () => {
    const t = setup();
    t.input.setBindings(KEYBOARD_ID, spaceJump);
    t.input.resetBindings(KEYBOARD_ID);
    expect(t.input.bindings(KEYBOARD_ID)).toEqual(DEFAULT_KEYBOARD);
    expect(t.storage.getItem(STORAGE_KEY)).not.toContain('Space');
  });

  it('retrouve la disposition enregistrée à la création suivante', () => {
    const first = setup();
    first.input.setBindings(KEYBOARD_ID, spaceJump);
    const second = setup(first.storage);
    expect(second.input.bindings(KEYBOARD_ID)).toEqual(spaceJump);
    second.input.assign(0, KEYBOARD_ID);
    second.fake.keyDown('Space');
    expect(second.sample()[0]).toBe(encodeInput(0, 0, BTN_JUMP));
  });

  it('repart des dispositions par défaut si l’enregistrement est abîmé', () => {
    const t = setup(memoryStorage({ [STORAGE_KEY]: '{"version":1,"keyboard":{"jump":[]}}' }));
    expect(t.input.bindings(KEYBOARD_ID)).toEqual(DEFAULT_KEYBOARD);
  });

  it('fonctionne sans stockage', () => {
    const fake = fakeWindow();
    const input = createInput({ target: fake.window, players: 1 });
    expect(input.setBindings(KEYBOARD_ID, spaceJump)).toBeNull();
    expect(input.bindings(KEYBOARD_ID)).toEqual(spaceJump);
  });
});

describe('dispositions des manettes', () => {
  const swapped: Bindings = {
    ...DEFAULT_GAMEPAD,
    attack: [{ type: 'button', index: 4 }],
    grab: [
      { type: 'button', index: 0 },
      { type: 'button', index: 5 },
    ],
  };

  it('applique une disposition à la manette, et la refuse si elle est invalide', () => {
    const t = setup();
    t.fake.pads[0] = fakePad({ id: 'Manette A' });
    t.sample();
    t.input.assign(0, gamepadId(0));
    expect(t.input.setBindings(gamepadId(0), DEFAULT_KEYBOARD)?.reason).toBe('wrong-device');
    expect(t.input.setBindings(gamepadId(0), swapped)).toBeNull();
    expect(t.input.bindings(gamepadId(0))).toEqual(swapped);
    t.fake.pads[0] = fakePad({ id: 'Manette A', pressed: [0] });
    expect(t.sample()[0]).toBe(encodeInput(0, 0, BTN_GRAB));
  });

  it('la partage entre manettes du même modèle, pas avec les autres', () => {
    const t = setup(undefined, 3);
    t.fake.pads[0] = fakePad({ id: 'Manette A' });
    t.fake.pads[1] = fakePad({ index: 1, id: 'Manette A' });
    t.fake.pads[2] = fakePad({ index: 2, id: 'Manette B' });
    t.sample();
    t.input.setBindings(gamepadId(0), swapped);
    expect(t.input.bindings(gamepadId(1))).toEqual(swapped);
    expect(t.input.bindings(gamepadId(2))).toEqual(DEFAULT_GAMEPAD);
  });

  it('la retrouve quand le même modèle est rebranché plus tard', () => {
    const first = setup();
    first.fake.pads[0] = fakePad({ id: 'Manette A' });
    first.sample();
    first.input.setBindings(gamepadId(0), swapped);

    const second = setup(first.storage);
    second.fake.pads[2] = fakePad({ index: 2, id: 'Manette A' });
    second.sample();
    second.input.assign(0, gamepadId(2));
    expect(second.input.bindings(gamepadId(2))).toEqual(swapped);
    second.fake.pads[2] = fakePad({ index: 2, id: 'Manette A', pressed: [4] });
    expect(second.sample()[0]).toBe(encodeInput(0, 0, BTN_ATTACK));

    second.input.resetBindings(gamepadId(2));
    expect(second.input.bindings(gamepadId(2))).toEqual(DEFAULT_GAMEPAD);
  });
});

describe('réglages analogiques', () => {
  it('sont ceux par défaut au départ', () => {
    expect(setup().input.analog()).toEqual(DEFAULT_ANALOG);
  });

  it('s’appliquent à la lecture, s’enregistrent et restent dans leurs bornes', () => {
    const t = setup();
    t.fake.pads[0] = fakePad();
    t.sample();
    t.input.assign(0, gamepadId(0));
    t.fake.pads[0] = fakePad({ axes: [0.3, 0, 0, 0] });
    expect(inputStickX(t.sample()[0]!)).toBeGreaterThan(0);

    t.input.setAnalog({ deadzone: 0.4, threshold: 0.5 });
    expect(t.input.analog()).toEqual({ deadzone: 0.4, threshold: 0.5 });
    expect(inputStickX(t.sample()[0]!)).toBe(0);
    expect(setup(t.storage).input.analog()).toEqual({ deadzone: 0.4, threshold: 0.5 });

    t.input.setAnalog({ deadzone: 5, threshold: -1 });
    expect(t.input.analog()).toEqual({ deadzone: 0.6, threshold: 0.1 });
  });
});

describe('saut au stick', () => {
  it('ajoute le saut quand le stick est poussé franchement vers le haut', () => {
    const jumped = withTapJump(encodeInput(0, 127, BTN_ATTACK));
    expect(inputButtons(jumped)).toBe(BTN_ATTACK | BTN_JUMP);
    expect(inputStickY(jumped)).toBe(127);
    expect(inputButtons(withTapJump(encodeInput(127, 90, 0)))).toBe(BTN_JUMP);
  });

  it('ne saute pas pour un stick à mi-course, de côté ou vers le bas', () => {
    for (const frame of [
      encodeInput(0, 56, 0),
      encodeInput(127, 0, 0),
      encodeInput(0, -127, 0),
      encodeInput(0, 0, BTN_ATTACK),
    ]) {
      expect(withTapJump(frame)).toBe(frame);
    }
  });

  it('est désactivé par défaut et se règle par joueur', () => {
    const t = setup();
    t.input.assign(0, KEYBOARD_ID);
    expect(t.input.tapJump(0)).toBe(false);
    t.fake.keyDown('ArrowUp');
    expect(t.sample()[0]).toBe(encodeInput(0, 127, 0));

    t.input.setTapJump(0, true);
    expect(t.input.tapJump(0)).toBe(true);
    expect(t.input.tapJump(1)).toBe(false);
    expect(t.sample()[0]).toBe(encodeInput(0, 127, BTN_JUMP));
    expect(setup(t.storage).input.tapJump(0)).toBe(true);
    expect(() => t.input.setTapJump(2, true)).toThrow();
  });

  it('vaut aussi pour une manette', () => {
    const t = setup();
    t.fake.pads[0] = fakePad();
    t.sample();
    t.input.assign(1, gamepadId(0));
    t.input.setTapJump(1, true);
    t.fake.pads[0] = fakePad({ axes: [0, -1, 0, 0] });
    expect(inputButtons(t.sample()[1]!)).toBe(BTN_JUMP);
    t.fake.pads[0] = fakePad({ axes: [0, -0.5, 0, 0] });
    expect(inputButtons(t.sample()[1]!)).toBe(0);
  });
});
