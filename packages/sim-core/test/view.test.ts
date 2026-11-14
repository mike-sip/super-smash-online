import { describe, expect, it } from 'vitest';
import {
  A_ATTACK,
  A_IDLE,
  A_SHIELD,
  BTN_ATTACK,
  BTN_SHIELD,
  M_FSMASH,
  MAX_ENTITIES,
  checksum,
  createEntityView,
  createFighterView,
  createSim,
  encodeInput,
  fx,
  readEntity,
  readFighter,
  spawnEntity,
  step,
} from '../src/index.ts';
import { E_BALL, testConfig } from '../src/testing/fixtures.ts';

describe('readFighter', () => {
  it('décrit un combattant au repos', () => {
    const sim = createSim(testConfig(2));
    const v = createFighterView();
    readFighter(sim, 0, v);
    expect(v).toEqual({
      x: -35,
      y: 0,
      velX: 0,
      velY: 0,
      facing: 1,
      grounded: true,
      action: A_IDLE,
      actionFrame: 0,
      move: 0,
      charge: 0,
      damage: 0,
      shield: 1,
      hitlag: 0,
      intangible: false,
      jumpsLeft: 1,
    });
  });

  it('suit une attaque chargée, les dégâts et le bouclier', () => {
    const sim = createSim(testConfig(2));
    const v = createFighterView();
    const inputs = new Uint32Array(2);

    inputs[0] = encodeInput(127, 0, BTN_ATTACK);
    step(sim, inputs);
    inputs[0] = encodeInput(0, 0, BTN_ATTACK);
    for (let f = 0; f < 14; f++) step(sim, inputs);
    readFighter(sim, 0, v);
    expect(v.action).toBe(A_ATTACK);
    expect(v.move).toBe(M_FSMASH);
    expect(v.charge).toBe(11);

    sim.state.damage[1] = fx(42.5);
    inputs[0] = 0;
    inputs[1] = encodeInput(0, 0, BTN_SHIELD);
    for (let f = 0; f < 30; f++) step(sim, inputs);
    readFighter(sim, 1, v);
    expect(v.action).toBe(A_SHIELD);
    expect(v.damage).toBe(42.5);
    expect(v.shield).toBeGreaterThan(0.8);
    expect(v.shield).toBeLessThan(1);
  });

  it('ne modifie pas la simulation', () => {
    const sim = createSim(testConfig(4));
    const before = checksum(sim);
    const v = createFighterView();
    for (let p = 0; p < 4; p++) readFighter(sim, p, v);
    expect(checksum(sim)).toBe(before);
  });
});

describe('readEntity', () => {
  it('renvoie faux pour un emplacement libre, sans toucher à la vue', () => {
    const sim = createSim(testConfig(2));
    const v = createEntityView();
    v.x = 123;
    expect(readEntity(sim, 0, v)).toBe(false);
    expect(readEntity(sim, MAX_ENTITIES, v)).toBe(false);
    expect(v.x).toBe(123);
  });

  it('décrit une entité vivante', () => {
    const sim = createSim(testConfig(2));
    const slot = spawnEntity(sim, E_BALL, 1, fx(4), fx(30), fx(0.5), fx(-0.25));
    const v = createEntityView();
    expect(readEntity(sim, slot, v)).toBe(true);
    expect(v).toEqual({
      kind: E_BALL,
      owner: 1,
      x: 4,
      y: 30,
      velX: 0.5,
      velY: -0.25,
      life: 300,
      mode: 0,
    });
  });

  it('permet de parcourir toute la réserve', () => {
    const sim = createSim(testConfig(2));
    spawnEntity(sim, E_BALL, -1, 0, fx(30), 0, 0);
    spawnEntity(sim, E_BALL, -1, 0, fx(40), 0, 0);
    const v = createEntityView();
    let alive = 0;
    for (let e = 0; e < MAX_ENTITIES; e++) if (readEntity(sim, e, v)) alive++;
    expect(alive).toBe(2);
    expect(v.owner).toBe(-1);
  });
});
