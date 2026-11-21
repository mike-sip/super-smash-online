import { describe, expect, it } from 'vitest';
import { BTN_ATTACK, BTN_JUMP, BTN_SPECIAL, encodeInput } from '@game/sim-core';
import { DEFAULT_GAMEPAD } from '../src/bindings.ts';
import { KEYBOARD_ID, createInput, gamepadId, type Device } from '../src/index.ts';
import { fakePad, fakeWindow } from './helpers.ts';

function setup(players = 4) {
  const fake = fakeWindow();
  const input = createInput({ target: fake.window, players });
  const out = new Uint32Array(players);
  const sample = (): number[] => {
    input.sample(out);
    return Array.from(out);
  };
  const changes: Device[] = [];
  const joins: Device[] = [];
  input.onDeviceChange((device) => changes.push(device));
  input.onJoinRequest((device) => joins.push(device));
  return { fake, input, sample, changes, joins };
}

describe('manettes : branchement', () => {
  it('découvre une manette branchée et le signale une fois', () => {
    const t = setup();
    t.fake.pads[0] = fakePad({ id: 'Manette A' });
    t.sample();
    t.sample();
    expect(t.changes).toEqual([
      { id: gamepadId(0), kind: 'gamepad', label: 'Manette A', connected: true, standard: true },
    ]);
    expect(t.input.devices().map((d) => d.id)).toEqual([KEYBOARD_ID, gamepadId(0)]);
    expect(t.input.bindings(gamepadId(0))).toEqual(DEFAULT_GAMEPAD);
  });

  it('signale une manette que le navigateur ne reconnaît pas comme standard', () => {
    const t = setup();
    t.fake.pads[1] = fakePad({ index: 1, mapping: '' });
    t.sample();
    expect(t.changes[0]).toMatchObject({ id: gamepadId(1), standard: false });
  });

  it('signale le débranchement et garde la manette dans la liste', () => {
    const t = setup();
    t.fake.pads[0] = fakePad();
    t.sample();
    t.fake.pads[0] = null;
    t.sample();
    t.sample();
    expect(t.changes.map((d) => d.connected)).toEqual([true, false]);
    expect(t.input.devices().find((d) => d.id === gamepadId(0))?.connected).toBe(false);
  });

  it('traite une manette marquée déconnectée comme absente', () => {
    const t = setup();
    t.fake.pads[0] = fakePad({ connected: false });
    t.sample();
    expect(t.changes).toEqual([]);
  });

  it('fonctionne sans API Gamepad', () => {
    const fake = fakeWindow();
    Object.assign(fake.window, { navigator: {} });
    const input = createInput({ target: fake.window, players: 1 });
    input.assign(0, KEYBOARD_ID);
    fake.keyDown('KeyX');
    const out = new Uint32Array(1);
    input.sample(out);
    expect(out[0]).toBe(encodeInput(0, 0, BTN_ATTACK));
  });

  it('ignore les manettes au-delà de la quatrième', () => {
    const t = setup();
    t.fake.pads[4] = fakePad({ index: 4 });
    t.sample();
    expect(t.changes).toEqual([]);
  });
});

describe('manettes : attribution aux joueurs', () => {
  it('écrit l’input de chaque périphérique dans l’emplacement de son joueur', () => {
    const t = setup();
    t.fake.pads[0] = fakePad();
    t.fake.pads[1] = fakePad({ index: 1 });
    t.sample();
    t.input.assign(0, KEYBOARD_ID);
    t.input.assign(1, gamepadId(0));
    t.input.assign(3, gamepadId(1));
    t.fake.keyDown('KeyZ');
    t.fake.pads[0] = fakePad({ pressed: [0] });
    t.fake.pads[1] = fakePad({ index: 1, axes: [-1, 0, 0, 0] });
    expect(t.sample()).toEqual([
      encodeInput(0, 0, BTN_JUMP),
      encodeInput(0, 0, BTN_ATTACK),
      0,
      encodeInput(-127, 0, 0),
    ]);
  });

  it('fait jouer quatre manettes ensemble', () => {
    const t = setup();
    for (let i = 0; i < 4; i++) t.fake.pads[i] = fakePad({ index: i });
    t.sample();
    for (let i = 0; i < 4; i++) t.input.assign(i, gamepadId(i));
    for (let i = 0; i < 4; i++) t.fake.pads[i] = fakePad({ index: i, pressed: [i === 0 ? 0 : 1] });
    expect(t.sample()).toEqual([
      encodeInput(0, 0, BTN_ATTACK),
      encodeInput(0, 0, BTN_SPECIAL),
      encodeInput(0, 0, BTN_SPECIAL),
      encodeInput(0, 0, BTN_SPECIAL),
    ]);
  });

  it('ne donne un périphérique qu’à un joueur, et un joueur qu’à un périphérique', () => {
    const t = setup();
    t.fake.pads[0] = fakePad();
    t.fake.pads[1] = fakePad({ index: 1 });
    t.sample();
    t.input.assign(0, gamepadId(0));
    // La même manette donnée à un autre joueur quitte le premier.
    t.input.assign(2, gamepadId(0));
    expect(t.input.assigned(0)).toBeNull();
    expect(t.input.assigned(2)?.id).toBe(gamepadId(0));
    // Un autre périphérique donné au même joueur remplace le précédent.
    t.input.assign(2, gamepadId(1));
    expect(t.input.assigned(2)?.id).toBe(gamepadId(1));
    t.fake.pads[0] = fakePad({ pressed: [0] });
    expect(t.sample()).toEqual([0, 0, 0, 0]);
    t.input.assign(2, null);
    expect(t.input.assigned(2)).toBeNull();
  });

  it('refuse une manette jamais vue', () => {
    const t = setup();
    expect(() => t.input.assign(0, gamepadId(2))).toThrow();
  });

  it('garde l’emplacement d’une manette débranchée et le lui rend au rebranchement', () => {
    const t = setup();
    t.fake.pads[0] = fakePad();
    t.sample();
    t.input.assign(1, gamepadId(0));
    t.fake.pads[0] = fakePad({ pressed: [0] });
    expect(t.sample()[1]).toBe(encodeInput(0, 0, BTN_ATTACK));

    // Débranchée bouton enfoncé : le bouton est libéré, l'emplacement reste le sien.
    t.fake.pads[0] = null;
    expect(t.sample()).toEqual([0, 0, 0, 0]);
    expect(t.input.assigned(1)).toMatchObject({ id: gamepadId(0), connected: false });

    t.fake.pads[0] = fakePad({ pressed: [1] });
    expect(t.sample()[1]).toBe(encodeInput(0, 0, BTN_SPECIAL));
    expect(t.input.assigned(1)?.connected).toBe(true);
  });
});

describe('arrivée d’un joueur', () => {
  it('signale une manette non attribuée dont un bouton est enfoncé, une fois par appui', () => {
    const t = setup();
    t.fake.pads[0] = fakePad();
    t.sample();
    expect(t.joins).toEqual([]);
    t.fake.pads[0] = fakePad({ pressed: [9] });
    t.sample();
    t.sample();
    t.sample();
    expect(t.joins.map((d) => d.id)).toEqual([gamepadId(0)]);
    t.fake.pads[0] = fakePad();
    t.sample();
    t.fake.pads[0] = fakePad({ pressed: [0] });
    t.sample();
    expect(t.joins.length).toBe(2);
  });

  it('ne prend pas un stick qui dérive pour une demande', () => {
    const t = setup();
    t.fake.pads[0] = fakePad({ axes: [1, 1, 0.4, 0] });
    t.sample();
    t.sample();
    expect(t.joins).toEqual([]);
  });

  it('ne signale pas un périphérique déjà attribué', () => {
    const t = setup();
    t.fake.pads[0] = fakePad();
    t.sample();
    t.input.assign(0, gamepadId(0));
    t.fake.pads[0] = fakePad({ pressed: [0] });
    t.sample();
    expect(t.joins).toEqual([]);
  });

  it('signale le clavier non attribué à la première touche du jeu', () => {
    const t = setup();
    t.fake.keyDown('KeyP');
    t.sample();
    expect(t.joins).toEqual([]);
    t.fake.keyDown('KeyX');
    t.sample();
    t.sample();
    expect(t.joins.map((d) => d.id)).toEqual([KEYBOARD_ID]);
    t.fake.keyUp('KeyX');
    t.sample();
    t.fake.keyDown('KeyX');
    t.sample();
    expect(t.joins.length).toBe(2);
  });

  it('laisse l’application attribuer le périphérique en réponse', () => {
    const t = setup();
    t.input.onJoinRequest((device) => t.input.assign(2, device.id));
    t.fake.pads[0] = fakePad({ pressed: [0] });
    t.sample();
    expect(t.input.assigned(2)?.id).toBe(gamepadId(0));
    // Le bouton qui a servi à rejoindre ne déclenche pas d'action : il faut le relâcher d'abord.
    expect(t.sample()).toEqual([0, 0, 0, 0]);
    t.fake.pads[0] = fakePad();
    t.sample();
    t.fake.pads[0] = fakePad({ pressed: [0] });
    expect(t.sample()[2]).toBe(encodeInput(0, 0, BTN_ATTACK));
  });

  it('cesse de prévenir un écouteur retiré, et tout le monde après dispose', () => {
    const fake = fakeWindow();
    const input = createInput({ target: fake.window, players: 2 });
    const out = new Uint32Array(2);
    let joins = 0;
    let changes = 0;
    const stopJoin = input.onJoinRequest(() => joins++);
    input.onDeviceChange(() => changes++);
    fake.pads[0] = fakePad({ pressed: [0] });
    input.sample(out);
    expect([joins, changes]).toEqual([1, 1]);

    stopJoin();
    fake.pads[0] = fakePad();
    input.sample(out);
    fake.pads[0] = fakePad({ pressed: [0] });
    input.sample(out);
    expect(joins).toBe(1);

    input.dispose();
    fake.pads[0] = null;
    input.sample(out);
    expect(changes).toBe(1);
  });
});
