import { describe, expect, it } from 'vitest';
import { BTN_ATTACK, encodeInput } from '@game/sim-core';
import { createPadBaseline, detectPadInput } from '../src/capture.ts';
import { KEYBOARD_ID, createInput, gamepadId } from '../src/index.ts';
import { describeInput } from '../src/labels.ts';
import { fakePad, fakeWindow } from './helpers.ts';

function setup() {
  const fake = fakeWindow();
  const input = createInput({ target: fake.window, players: 2 });
  const out = new Uint32Array(2);
  const sample = (): number[] => {
    input.sample(out);
    return Array.from(out);
  };
  return { fake, input, sample };
}

/** Résultat d'une promesse sans l'attendre plus d'un tour : « en attente » si elle n'a pas abouti. */
async function settled<T>(promise: Promise<T>): Promise<T | 'en attente' | Error> {
  const pending = Symbol('pending');
  const result = await Promise.race([
    promise.then(
      (value) => value,
      (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    ),
    Promise.resolve().then(() => pending),
  ]);
  return result === pending ? 'en attente' : (result as T | Error);
}

describe('capture au clavier', () => {
  it('donne la prochaine touche, sans qu’elle joue', async () => {
    const t = setup();
    t.input.assign(0, KEYBOARD_ID);
    const next = t.input.captureNext(KEYBOARD_ID);
    expect(await settled(next)).toBe('en attente');
    const event = t.fake.keyDown('KeyX');
    expect(await next).toEqual({ type: 'key', code: 'KeyX' });
    expect(event.defaultPrevented).toBe(true);
    expect(t.sample()[0]).toBe(0);
    // La capture terminée, la touche rejoue normalement.
    t.fake.keyUp('KeyX');
    t.fake.keyDown('KeyX');
    expect(t.sample()[0]).toBe(encodeInput(0, 0, BTN_ATTACK));
  });

  it('prend une touche qui ne commandait rien', async () => {
    const t = setup();
    const next = t.input.captureNext(KEYBOARD_ID);
    t.fake.keyDown('KeyQ');
    expect(await next).toEqual({ type: 'key', code: 'KeyQ' });
  });

  it('ignore la répétition d’une touche restée enfoncée', async () => {
    const t = setup();
    const next = t.input.captureNext(KEYBOARD_ID);
    t.fake.keyDown('KeyZ', { repeat: true });
    expect(await settled(next)).toBe('en attente');
    t.fake.keyDown('KeyB');
    expect(await next).toEqual({ type: 'key', code: 'KeyB' });
  });

  it('cache la touche capturée aux autres écouteurs de la fenêtre', async () => {
    const t = setup();
    let seen = 0;
    t.fake.window.addEventListener('keydown', () => seen++);
    const next = t.input.captureNext(KEYBOARD_ID);
    t.fake.keyDown('KeyP');
    await next;
    expect(seen).toBe(0);
    t.fake.keyDown('KeyP');
    expect(seen).toBe(1);
  });

  it('s’annule proprement', async () => {
    const t = setup();
    t.input.assign(0, KEYBOARD_ID);
    const controller = new AbortController();
    const next = t.input.captureNext(KEYBOARD_ID, controller.signal);
    controller.abort();
    expect(await settled(next)).toBeInstanceOf(Error);
    // Plus rien n'est intercepté.
    t.fake.keyDown('KeyX');
    expect(t.sample()[0]).toBe(encodeInput(0, 0, BTN_ATTACK));

    const already = new AbortController();
    already.abort();
    expect(await settled(t.input.captureNext(KEYBOARD_ID, already.signal))).toBeInstanceOf(Error);
  });

  it('remplace une capture en cours par la nouvelle', async () => {
    const t = setup();
    const first = t.input.captureNext(KEYBOARD_ID);
    const second = t.input.captureNext(KEYBOARD_ID);
    expect(await settled(first)).toBeInstanceOf(Error);
    t.fake.keyDown('KeyC');
    expect(await second).toEqual({ type: 'key', code: 'KeyC' });
  });

  it('refuse un périphérique inconnu', async () => {
    const t = setup();
    expect(await settled(t.input.captureNext('inconnu'))).toBeInstanceOf(Error);
  });
});

describe('capture à la manette', () => {
  it('donne le prochain bouton enfoncé, sans qu’il joue', async () => {
    const t = setup();
    t.fake.pads[0] = fakePad();
    t.sample();
    t.input.assign(1, gamepadId(0));
    const next = t.input.captureNext(gamepadId(0));
    t.sample();
    expect(await settled(next)).toBe('en attente');
    t.fake.pads[0] = fakePad({ pressed: [0] });
    expect(t.sample()[1]).toBe(0);
    expect(await next).toEqual({ type: 'button', index: 0 });
    // Tant que le bouton n'est pas relâché, il ne joue pas.
    expect(t.sample()[1]).toBe(0);
    t.fake.pads[0] = fakePad();
    t.sample();
    t.fake.pads[0] = fakePad({ pressed: [0] });
    expect(t.sample()[1]).toBe(encodeInput(0, 0, BTN_ATTACK));
  });

  it('donne un demi-axe quand un stick est poussé', async () => {
    const t = setup();
    t.fake.pads[0] = fakePad();
    t.sample();
    const next = t.input.captureNext(gamepadId(0));
    t.sample();
    t.fake.pads[0] = fakePad({ axes: [0, 0, 0, -0.9] });
    t.sample();
    expect(await next).toEqual({ type: 'axis', index: 3, direction: -1 });
  });

  it('ne tient pas compte de ce qui était déjà enfoncé ou incliné au départ', async () => {
    const t = setup();
    t.fake.pads[0] = fakePad({ pressed: [6], axes: [0.8, 0, 0, 0] });
    t.sample();
    const next = t.input.captureNext(gamepadId(0));
    t.sample();
    t.sample();
    expect(await settled(next)).toBe('en attente');
    t.fake.pads[0] = fakePad({ pressed: [6, 3], axes: [0.8, 0, 0, 0] });
    t.sample();
    expect(await next).toEqual({ type: 'button', index: 3 });
  });

  it('s’annule si la manette est débranchée', async () => {
    const t = setup();
    t.fake.pads[0] = fakePad();
    t.sample();
    const next = t.input.captureNext(gamepadId(0));
    t.fake.pads[0] = null;
    t.sample();
    expect(await settled(next)).toBeInstanceOf(Error);
  });
});

describe('detectPadInput', () => {
  it('repère un bouton nouvellement enfoncé, y compris une gâchette analogique', () => {
    const baseline = createPadBaseline(fakePad());
    expect(detectPadInput(baseline, fakePad(), 0.5)).toBeNull();
    expect(detectPadInput(baseline, fakePad({ pressed: [5] }), 0.5)).toEqual({
      type: 'button',
      index: 5,
    });
    expect(detectPadInput(baseline, fakePad({ values: { 7: 0.7 } }), 0.5)).toEqual({
      type: 'button',
      index: 7,
    });
    expect(detectPadInput(baseline, fakePad({ values: { 7: 0.3 } }), 0.5)).toBeNull();
  });

  it('repère un axe franchement déplacé depuis sa position de départ, et son sens', () => {
    const baseline = createPadBaseline(fakePad({ axes: [0.1, 0, 0, 0] }));
    expect(detectPadInput(baseline, fakePad({ axes: [0.4, 0, 0, 0] }), 0.5)).toBeNull();
    expect(detectPadInput(baseline, fakePad({ axes: [0.1, 0.9, 0, 0] }), 0.5)).toEqual({
      type: 'axis',
      index: 1,
      direction: 1,
    });
    expect(detectPadInput(baseline, fakePad({ axes: [-0.8, 0, 0, 0] }), 0.5)).toEqual({
      type: 'axis',
      index: 0,
      direction: -1,
    });
  });

  it('préfère le bouton quand un bouton et un axe bougent ensemble', () => {
    const baseline = createPadBaseline(fakePad());
    expect(detectPadInput(baseline, fakePad({ pressed: [1], axes: [1, 0, 0, 0] }), 0.5)).toEqual({
      type: 'button',
      index: 1,
    });
  });
});

describe('describeInput', () => {
  it('nomme une touche d’après le clavier du joueur quand il est connu', () => {
    const azerty = new Map([
      ['KeyW', 'z'],
      ['KeyQ', 'a'],
    ]);
    expect(describeInput({ type: 'key', code: 'KeyW' }, azerty)).toBe('Z');
    expect(describeInput({ type: 'key', code: 'KeyQ' }, azerty)).toBe('A');
  });

  it('nomme sinon la touche d’après sa position', () => {
    expect(describeInput({ type: 'key', code: 'KeyW' })).toBe('W');
    expect(describeInput({ type: 'key', code: 'Digit3' })).toBe('3');
    expect(describeInput({ type: 'key', code: 'ArrowLeft' })).toBe('←');
    expect(describeInput({ type: 'key', code: 'ShiftLeft' })).toBe('Maj gauche');
    expect(describeInput({ type: 'key', code: 'Space' })).toBe('Espace');
    expect(describeInput({ type: 'key', code: 'F13' })).toBe('F13');
  });

  it('garde le nom de position pour les touches sans caractère, même clavier connu', () => {
    const layout = new Map([['KeyW', 'z']]);
    expect(describeInput({ type: 'key', code: 'ArrowUp' }, layout)).toBe('↑');
  });

  it('nomme les boutons et les sticks d’une manette', () => {
    expect(describeInput({ type: 'button', index: 0 })).toBe('Bouton bas');
    expect(describeInput({ type: 'button', index: 7 })).toBe('Gâchette droite');
    expect(describeInput({ type: 'button', index: 12 })).toBe('Croix haut');
    expect(describeInput({ type: 'button', index: 23 })).toBe('Bouton 23');
    expect(describeInput({ type: 'axis', index: 0, direction: -1 })).toBe('Stick gauche ←');
    expect(describeInput({ type: 'axis', index: 1, direction: -1 })).toBe('Stick gauche ↑');
    expect(describeInput({ type: 'axis', index: 3, direction: 1 })).toBe('Stick droit ↓');
    expect(describeInput({ type: 'axis', index: 5, direction: 1 })).toBe('Axe 5 +');
  });
});
