import { describe, expect, it } from 'vitest';
import {
  BTN_ATTACK,
  BTN_JUMP,
  BTN_SHIELD,
  STATE_BYTES,
  checksum,
  createFighterView,
  createSim,
  encodeInput,
  frame,
  inputButtons,
  inputPressed,
  inputStickX,
  inputStickY,
  loadState,
  readFighter,
  saveState,
  step,
} from '../src/index.ts';
import { fxToFloat } from '../src/fixed.ts';
import { TEST_FIGHTER, TEST_STAGE, testConfig } from '../src/testing/fixtures.ts';

describe('InputFrame', () => {
  it('fait l’aller-retour stick et boutons', () => {
    const i = encodeInput(-127, 64, BTN_ATTACK | BTN_SHIELD);
    expect(inputStickX(i)).toBe(-127);
    expect(inputStickY(i)).toBe(64);
    expect(inputButtons(i)).toBe(BTN_ATTACK | BTN_SHIELD);
  });

  it('est un entier non signé sur 32 bits', () => {
    const i = encodeInput(-1, -1, 0xffff);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(2 ** 32);
    expect(inputButtons(i)).toBe(0xffff);
  });

  it('borne le stick à ±127 et tronque les décimales', () => {
    const i = encodeInput(500, -500, 0);
    expect(inputStickX(i)).toBe(127);
    expect(inputStickY(i)).toBe(-127);
    expect(inputStickX(encodeInput(12.9, 0, 0))).toBe(12);
  });

  it('détecte un bouton qui vient d’être enfoncé', () => {
    const none = encodeInput(0, 0, 0);
    const jump = encodeInput(0, 0, BTN_JUMP);
    expect(inputPressed(jump, none, BTN_JUMP)).toBe(true);
    expect(inputPressed(jump, jump, BTN_JUMP)).toBe(false);
    expect(inputPressed(none, jump, BTN_JUMP)).toBe(false);
  });
});

describe('createSim', () => {
  it('accepte de 2 à 8 joueurs', () => {
    expect(() => createSim(testConfig(2))).not.toThrow();
    expect(() => createSim(testConfig(8))).not.toThrow();
    expect(() => createSim(testConfig(1))).toThrow(/2 à 8/);
    expect(() => createSim(testConfig(9))).toThrow(/2 à 8/);
  });

  it('place chaque joueur sur son point d’apparition, tourné vers le centre', () => {
    const sim = createSim(testConfig(8));
    const v = createFighterView();
    for (let p = 0; p < 8; p++) {
      readFighter(sim, p, v);
      expect(v.x).toBe(fxToFloat(TEST_STAGE.spawns[p]!.x));
      expect(v.y).toBe(fxToFloat(TEST_STAGE.spawns[p]!.y));
      expect(v.facing).toBe(v.x > 0 ? -1 : 1);
      expect(v.damage).toBe(0);
    }
  });

  it('donne deux simulations identiques pour la même configuration', () => {
    expect(checksum(createSim(testConfig(4)))).toBe(checksum(createSim(testConfig(4))));
  });

  it('dépend de la graine', () => {
    const a = createSim({ ...testConfig(2), seed: 1 });
    const b = createSim({ ...testConfig(2), seed: 2 });
    expect(checksum(a)).not.toBe(checksum(b));
  });

  it('refuse un stage sans assez de points d’apparition', () => {
    const stage = { ...TEST_STAGE, spawns: TEST_STAGE.spawns.slice(0, 2) };
    expect(() =>
      createSim({ stage, fighters: [TEST_FIGHTER, TEST_FIGHTER, TEST_FIGHTER], seed: 1 }),
    ).toThrow(/apparition/);
  });
});

describe('step', () => {
  it('avance le compteur de frames', () => {
    for (const players of [2, 8]) {
      const sim = createSim(testConfig(players));
      const inputs = new Uint32Array(players);
      for (let f = 0; f < 100; f++) step(sim, inputs);
      expect(frame(sim)).toBe(100);
    }
  });

  it('mémorise l’input courant et le précédent dans l’état', () => {
    const sim = createSim(testConfig(2));
    const inputs = new Uint32Array(2);
    const a = encodeInput(10, 0, BTN_JUMP);
    const b = encodeInput(-128, 127, 0xffff);
    inputs[1] = a;
    step(sim, inputs);
    inputs[1] = b;
    step(sim, inputs);
    expect(sim.state.prevInput[1]! >>> 0).toBe(a);
    expect(sim.state.input[1]! >>> 0).toBe(b);
    expect(sim.state.input[0]).toBe(0);
  });

  it('change le checksum quand les inputs changent', () => {
    const a = createSim(testConfig(2));
    const b = createSim(testConfig(2));
    step(a, new Uint32Array([0, 0]));
    step(b, new Uint32Array([0, encodeInput(0, 0, BTN_ATTACK)]));
    expect(checksum(a)).not.toBe(checksum(b));
  });
});

describe('saveState / loadState', () => {
  it('revient à la frame sauvegardée', () => {
    const sim = createSim(testConfig(4));
    const inputs = new Uint32Array(4);
    for (let f = 0; f < 10; f++) step(sim, inputs);
    const snap = new Uint8Array(STATE_BYTES);
    saveState(sim, snap);
    const at10 = checksum(sim);
    for (let f = 0; f < 5; f++) step(sim, inputs);
    expect(frame(sim)).toBe(15);
    loadState(sim, snap);
    expect(frame(sim)).toBe(10);
    expect(checksum(sim)).toBe(at10);
  });

  it('refuse un tampon trop petit', () => {
    const sim = createSim(testConfig(2));
    expect(() => saveState(sim, new Uint8Array(4))).toThrow(/STATE_BYTES/);
    expect(() => loadState(sim, new Uint8Array(4))).toThrow(/STATE_BYTES/);
  });
});
