import { describe, expect, it } from 'vitest';
import { A_AIR } from '../../src/actions.ts';
import type { StageDef } from '../../src/defs.ts';
import { fx } from '../../src/fixed.ts';
import {
  STATE_BYTES,
  checksum,
  createFighterView,
  createSim,
  frame,
  loadState,
  readFighter,
  readPlatform,
  saveState,
  type Sim,
} from '../../src/index.ts';
import { TEST_STAGE, testConfig } from '../../src/testing/fixtures.ts';
import { NEUTRAL, hold, holdUntil, stick, teleportAir } from './helpers.ts';

/** Stage de test, plus une barge horizontale (plateforme 3) et une nacelle verticale (4). */
const MOVING_STAGE: StageDef = {
  ...TEST_STAGE,
  name: 'moving',
  platforms: [
    ...TEST_STAGE.platforms,
    {
      x1: fx(-15),
      x2: fx(15),
      y: fx(60),
      motion: { dx: fx(40), dy: fx(0), period: 240, phase: 0 },
    },
    { x1: fx(45), x2: fx(58), y: fx(15), motion: { dx: fx(0), dy: fx(30), period: 200, phase: 0 } },
  ],
};
const BARGE = 3;
const LIFT = 4;

function movingSim(): Sim {
  return createSim({ ...testConfig(2), stage: MOVING_STAGE });
}

const plat = { x1: 0, x2: 0, y: 0 };
function platform(sim: Sim, k: number): typeof plat {
  readPlatform(sim, k, plat);
  return { ...plat };
}

/** Lâche le joueur 0 au-dessus de la plateforme `k` et attend qu'il s'y pose. */
function landOn(sim: Sim, k: number, offsetX = 0): void {
  const p = platform(sim, k);
  teleportAir(sim, 0, (p.x1 + p.x2) / 2 + offsetX, p.y + 3);
  holdUntil(sim, NEUTRAL, () => sim.state.grounded[0] === 1, 60);
}

describe('plateformes mobiles', () => {
  it('readPlatform donne la position de la frame courante', () => {
    const sim = movingSim();
    expect(platform(sim, BARGE)).toEqual({ x1: -15, x2: 15, y: 60 });
    hold(sim, NEUTRAL, 120);
    expect(frame(sim)).toBe(120);
    expect(platform(sim, BARGE)).toEqual({ x1: 25, x2: 55, y: 60 });
    // Une plateforme fixe ne bouge pas.
    expect(platform(sim, 0)).toEqual({ x1: -40, x2: -15, y: 20 });
  });

  it('portent un combattant à l’horizontale, sans qu’il glisse', () => {
    const sim = movingSim();
    landOn(sim, BARGE);
    expect(sim.state.surface[0]).toBe(TEST_STAGE.solids.length + BARGE + 1);
    const view = createFighterView();
    readFighter(sim, 0, view);
    const rel = view.x - platform(sim, BARGE).x1;
    for (let f = 0; f < 100; f++) {
      hold(sim, NEUTRAL, 1);
      readFighter(sim, 0, view);
      expect(view.grounded).toBe(true);
      expect(view.x - platform(sim, BARGE).x1).toBeCloseTo(rel, 3);
      expect(view.y).toBe(60);
    }
  });

  it('portent un combattant à la verticale, dans les deux sens', () => {
    const sim = movingSim();
    landOn(sim, LIFT);
    const view = createFighterView();
    let minY = Infinity;
    let maxY = -Infinity;
    for (let f = 0; f < 200; f++) {
      hold(sim, NEUTRAL, 1);
      readFighter(sim, 0, view);
      expect(view.grounded).toBe(true);
      expect(view.y).toBe(platform(sim, LIFT).y);
      minY = Math.min(minY, view.y);
      maxY = Math.max(maxY, view.y);
    }
    expect(maxY - minY).toBeGreaterThan(29);
  });

  it('rattrapent un combattant qui tombe sur une plateforme qui monte', () => {
    const sim = movingSim();
    // Nacelle en pleine montée (vitesse maximale à un quart de période).
    hold(sim, NEUTRAL, 45);
    const p = platform(sim, LIFT);
    teleportAir(sim, 0, (p.x1 + p.x2) / 2, p.y + 1);
    sim.state.velY[0] = fx(-1.5);
    hold(sim, NEUTRAL, 3);
    expect(sim.state.grounded[0]).toBe(1);
    expect(sim.state.posY[0]).toBe(fx(platform(sim, LIFT).y));
  });

  it('se traversent stick vers le bas, et se quittent par le bord', () => {
    const sim = movingSim();
    landOn(sim, BARGE);
    // Coup de stick vers le bas : il passe à travers.
    hold(sim, NEUTRAL, 1);
    hold(sim, stick(0, -127), 1);
    expect(sim.state.grounded[0]).toBe(0);
    expect(sim.state.action[0]).toBe(A_AIR);

    // Marcher jusqu'au bord pendant que la barge recule : il tombe.
    const other = movingSim();
    landOn(other, BARGE, 13);
    holdUntil(other, stick(127), () => other.state.grounded[0] === 0, 120);
  });

  it('reprennent leur position exacte après une restauration d’état', () => {
    const sim = movingSim();
    landOn(sim, BARGE);
    const snap = new Uint8Array(STATE_BYTES);
    saveState(sim, snap);
    const at = frame(sim);
    hold(sim, NEUTRAL, 50);
    const expected = checksum(sim);
    const expectedPlat = platform(sim, BARGE);
    hold(sim, stick(127), 30);
    loadState(sim, snap);
    expect(frame(sim)).toBe(at);
    hold(sim, NEUTRAL, 50);
    expect(checksum(sim)).toBe(expected);
    expect(platform(sim, BARGE)).toEqual(expectedPlat);
  });
});
