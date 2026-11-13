import { describe, expect, it } from 'vitest';
import { BTN_ATTACK, BTN_JUMP, encodeInput } from '@game/sim-core';
import { DEFAULT_KEYBOARD } from '../src/bindings.ts';
import { KEYBOARD_ID, createInput } from '../src/index.ts';
import { fakeWindow } from './helpers.ts';

function setup(players = 2) {
  const fake = fakeWindow();
  const input = createInput({ target: fake.window, players });
  const out = new Uint32Array(players);
  const sample = (): Uint32Array => {
    input.sample(out);
    return out;
  };
  return { fake, input, sample };
}

describe('createInput', () => {
  it('annonce le clavier comme périphérique', () => {
    const { input } = setup();
    expect(input.devices()).toEqual([
      { id: KEYBOARD_ID, kind: 'keyboard', label: 'Clavier', connected: true, standard: true },
    ]);
    expect(input.bindings(KEYBOARD_ID)).toEqual(DEFAULT_KEYBOARD);
  });

  it('n’attribue aucun périphérique au départ : tous les emplacements lisent 0', () => {
    const { fake, input, sample } = setup();
    fake.keyDown('KeyX');
    expect(Array.from(sample())).toEqual([0, 0]);
    expect(input.assigned(0)).toBeNull();
  });

  it('écrit l’input du clavier dans l’emplacement de son joueur', () => {
    const { fake, input, sample } = setup();
    input.assign(0, KEYBOARD_ID);
    expect(input.assigned(0)?.id).toBe(KEYBOARD_ID);
    fake.keyDown('ArrowRight');
    fake.keyDown('KeyX');
    expect(Array.from(sample())).toEqual([encodeInput(127, 0, BTN_ATTACK), 0]);
    fake.keyUp('ArrowRight');
    fake.keyUp('KeyX');
    expect(Array.from(sample())).toEqual([0, 0]);
  });

  it('remet à 0 les emplacements sans périphérique, même s’ils contenaient autre chose', () => {
    const { input } = setup();
    input.assign(0, KEYBOARD_ID);
    const out = Uint32Array.from([123, 456]);
    input.sample(out);
    expect(Array.from(out)).toEqual([0, 0]);
  });

  it('déplace le clavier d’un joueur à l’autre, sans appui fantôme', () => {
    const { fake, input, sample } = setup();
    input.assign(0, KEYBOARD_ID);
    fake.keyDown('KeyZ');
    input.assign(1, KEYBOARD_ID);
    expect(input.assigned(0)).toBeNull();
    expect(input.assigned(1)?.id).toBe(KEYBOARD_ID);
    // La touche tenue pendant le changement ne compte pas pour le nouveau joueur.
    expect(Array.from(sample())).toEqual([0, 0]);
    fake.keyUp('KeyZ');
    fake.keyDown('KeyZ');
    expect(Array.from(sample())).toEqual([0, encodeInput(0, 0, BTN_JUMP)]);
    input.assign(1, null);
    expect(Array.from(sample())).toEqual([0, 0]);
  });

  it('refuse un emplacement ou un périphérique inconnu', () => {
    const { input } = setup();
    expect(() => input.assign(2, KEYBOARD_ID)).toThrow();
    expect(() => input.assign(0, 'inconnu')).toThrow();
    expect(() => input.bindings('inconnu')).toThrow();
  });

  it('soustrait au navigateur les touches du jeu, et elles seules', () => {
    const { fake, input } = setup();
    input.assign(0, KEYBOARD_ID);
    expect(fake.keyDown('ArrowDown').defaultPrevented).toBe(true);
    expect(fake.keyDown('KeyP').defaultPrevented).toBe(false);
    expect(fake.keyDown('F5').defaultPrevented).toBe(false);
  });

  it('ne prend jamais un raccourci du navigateur pour une commande', () => {
    const { fake, input, sample } = setup();
    input.assign(0, KEYBOARD_ID);
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey'] as const) {
      const event = fake.keyDown('KeyW', { [modifier]: true });
      expect(event.defaultPrevented).toBe(false);
      fake.keyUp('KeyW');
    }
    expect(sample()[0]).toBe(0);
  });

  it('ignore une touche tapée dans un champ de saisie', () => {
    const { fake, input, sample } = setup();
    input.assign(0, KEYBOARD_ID);
    for (const target of [
      { tagName: 'INPUT' },
      { tagName: 'TEXTAREA' },
      { tagName: 'SELECT' },
      { tagName: 'DIV', isContentEditable: true },
    ]) {
      expect(fake.keyDown('KeyX', { target }).defaultPrevented).toBe(false);
      fake.keyUp('KeyX');
    }
    expect(sample()[0]).toBe(0);
    // Un bouton de l'interface qui a gardé le focus ne bloque pas le jeu.
    fake.keyDown('KeyX', { target: { tagName: 'BUTTON' } });
    expect(sample()[0]).toBe(encodeInput(0, 0, BTN_ATTACK));
  });

  it('relâche tout quand la fenêtre perd le focus', () => {
    const { fake, input, sample } = setup();
    input.assign(0, KEYBOARD_ID);
    fake.keyDown('ArrowRight');
    fake.keyDown('KeyV');
    sample();
    fake.blur();
    expect(sample()[0]).toBe(0);
  });

  it('ne garde aucun écouteur après dispose, et ne lit plus rien', () => {
    const { fake, input, sample } = setup();
    input.assign(0, KEYBOARD_ID);
    expect(fake.listeners()).toBeGreaterThan(0);
    input.dispose();
    expect(fake.listeners()).toBe(0);
    fake.keyDown('KeyX');
    expect(sample()[0]).toBe(0);
  });

  it('refuse un nombre de joueurs locaux hors de 1 à 4', () => {
    const fake = fakeWindow();
    expect(() => createInput({ target: fake.window, players: 0 })).toThrow();
    expect(() => createInput({ target: fake.window, players: 5 })).toThrow();
  });
});
