import { describe, expect, it } from 'vitest';
import {
  A_AIR,
  A_GRAB,
  A_LEDGE,
  BTN_ATTACK,
  BTN_GRAB,
  EV_GRAB,
  EV_HIT,
  EV_LEDGE,
  createFighterView,
  createSim,
  encodeInput,
  events,
  fx,
  readFighter,
  step,
  type Sim,
} from '@game/sim-core';
import { TEST_ENTITIES, TEST_FIGHTER, TEST_STAGE, testConfig } from '@game/sim-core/testing';
import {
  SHAPE_ENTITY,
  SHAPE_GRAB,
  SHAPE_HIT,
  SHAPE_HURT,
  createShapes,
  describeFighter,
  entityShape,
  fighterShapes,
  isCharging,
  stageLedges,
  type Shapes,
} from '../src/debug.ts';

function hasEvent(sim: Sim, type: number): boolean {
  const queue = events(sim);
  for (let e = 0; e < queue.count; e++) if (queue.type[e] === type) return true;
  return false;
}

/** Formes du joueur `player` après le dernier `step`, comme le renderer les calcule. */
function shapesOf(sim: Sim, player: number, prevCharge = 0): Shapes {
  const view = createFighterView();
  readFighter(sim, player, view);
  const out = createShapes(16);
  fighterShapes(TEST_FIGHTER, view, view.x, view.y, isCharging(view, prevCharge), out);
  return out;
}

const kinds = (shapes: Shapes): number[] => Array.from(shapes.kind.subarray(0, shapes.count));

describe('formes de la vue technique', () => {
  it('place la hurtbox d’un combattant au repos', () => {
    const sim = createSim(testConfig(2));
    const s = shapesOf(sim, 0);
    expect(kinds(s)).toEqual([SHAPE_HURT]);
    expect([s.x1[0], s.y1[0], s.x2[0], s.y2[0], s.radius[0]]).toEqual([-35, 3, -35, 9, 3]);
  });

  it('montre la hitbox du jab aux frames 3 et 4, et à elles seules', () => {
    const sim = createSim(testConfig(2));
    const inputs = new Uint32Array(2);
    inputs[0] = encodeInput(0, 0, BTN_ATTACK);
    const active: number[] = [];
    for (let f = 1; f <= 8; f++) {
      step(sim, inputs);
      inputs[0] = 0;
      const s = shapesOf(sim, 0);
      if (kinds(s).includes(SHAPE_HIT)) {
        active.push(f);
        const h = kinds(s).indexOf(SHAPE_HIT);
        // Jab : cercle de rayon 2,5 à (6, 7) devant un combattant en x = -35 tourné vers la droite.
        expect([s.x1[h], s.y1[h], s.x2[h], s.y2[h], s.radius[h]]).toEqual([-29, 7, -29, 7, 2.5]);
      }
    }
    expect(active).toEqual([3, 4]);
  });

  it('montre la hitbox à la frame exacte où la simulation fait porter le coup', () => {
    const sim = createSim(testConfig(2));
    sim.state.posX[1] = fx(-27);
    const inputs = new Uint32Array(2);
    inputs[0] = encodeInput(0, 0, BTN_ATTACK);
    let hitFrame = 0;
    let shownFrame = 0;
    for (let f = 1; f <= 8 && hitFrame === 0; f++) {
      step(sim, inputs);
      inputs[0] = 0;
      if (shownFrame === 0 && kinds(shapesOf(sim, 0)).includes(SHAPE_HIT)) shownFrame = f;
      if (hasEvent(sim, EV_HIT)) hitFrame = f;
    }
    expect(hitFrame).toBe(3);
    expect(shownFrame).toBe(hitFrame);
  });

  it('garde la hitbox affichée pendant le gel du coup', () => {
    const sim = createSim(testConfig(2));
    sim.state.posX[1] = fx(-27);
    const inputs = new Uint32Array(2);
    inputs[0] = encodeInput(0, 0, BTN_ATTACK);
    for (let f = 1; f <= 3; f++) {
      step(sim, inputs);
      inputs[0] = 0;
    }
    expect(sim.state.hitlag[0]).toBeGreaterThan(0);
    step(sim, inputs);
    expect(kinds(shapesOf(sim, 0))).toContain(SHAPE_HIT);
  });

  it('retourne les hitbox d’un combattant tourné vers la gauche', () => {
    const sim = createSim(testConfig(2));
    const inputs = new Uint32Array(2);
    inputs[1] = encodeInput(0, 0, BTN_ATTACK);
    for (let f = 1; f <= 3; f++) {
      step(sim, inputs);
      inputs[1] = 0;
    }
    const s = shapesOf(sim, 1);
    const h = kinds(s).indexOf(SHAPE_HIT);
    expect(s.x1[h]).toBe(35 - 6);
  });

  it('montre la boîte de saisie pendant ses frames actives, celles où la simulation saisit', () => {
    // Dans le vide : la boîte est visible pendant toute sa fenêtre.
    const alone = createSim(testConfig(2));
    const inputs = new Uint32Array(2);
    inputs[0] = encodeInput(0, 0, BTN_GRAB);
    const active: number[] = [];
    for (let f = 1; f <= 12; f++) {
      step(alone, inputs);
      inputs[0] = 0;
      expect(alone.state.action[0]).toBe(A_GRAB);
      const s = shapesOf(alone, 0);
      if (!kinds(s).includes(SHAPE_GRAB)) continue;
      active.push(f);
      const g = kinds(s).indexOf(SHAPE_GRAB);
      expect([s.x1[g], s.y1[g], s.x2[g], s.y2[g], s.radius[g]]).toEqual([-32, 7, -26, 7, 2.5]);
    }
    expect(active).toEqual([6, 7, 8]);

    // Avec un adversaire à portée : la simulation saisit à la première de ces frames.
    const sim = createSim(testConfig(2));
    sim.state.posX[1] = fx(-28);
    inputs[0] = encodeInput(0, 0, BTN_GRAB);
    let grabFrame = 0;
    for (let f = 1; f <= 12 && grabFrame === 0; f++) {
      step(sim, inputs);
      inputs[0] = 0;
      if (hasEvent(sim, EV_GRAB)) grabFrame = f;
    }
    expect(grabFrame).toBe(active[0]);
  });

  it('décale d’une frame une attaque tenue en charge', () => {
    const view = createFighterView();
    view.charge = 3;
    expect(isCharging(view, 2)).toBe(true);
    expect(isCharging(view, 3)).toBe(false);
    view.charge = 0;
    expect(isCharging(view, 0)).toBe(false);
  });

  it('donne à une entité un cercle de son rayon', () => {
    const out = createShapes(4);
    entityShape(TEST_ENTITIES[1]!, 4, 30, out);
    expect(kinds(out)).toEqual([SHAPE_ENTITY]);
    expect([out.x1[0], out.y1[0], out.x2[0], out.y2[0], out.radius[0]]).toEqual([4, 30, 4, 30, 2]);
  });

  it('ignore ce qui dépasse la capacité prévue', () => {
    const out = createShapes(1);
    entityShape(TEST_ENTITIES[0]!, 0, 0, out);
    entityShape(TEST_ENTITIES[0]!, 1, 1, out);
    expect(out.count).toBe(1);
  });
});

describe('rebords', () => {
  it('place deux rebords par bloc plein, aux coins supérieurs', () => {
    const ledges = stageLedges(TEST_STAGE);
    expect(ledges.count).toBe(2);
    expect([ledges.x[0], ledges.y[0], ledges.side[0]]).toEqual([-60, 0, -1]);
    expect([ledges.x[1], ledges.y[1], ledges.side[1]]).toEqual([60, 0, 1]);
  });

  it('numérote les rebords comme la simulation : l’index de EV_LEDGE désigne le bon', () => {
    const ledges = stageLedges(TEST_STAGE);
    for (const [startX, expected] of [
      [-66, 0],
      [66, 1],
    ] as const) {
      const sim = createSim(testConfig(2));
      sim.state.posX[0] = fx(startX);
      sim.state.posY[0] = fx(-5);
      sim.state.grounded[0] = 0;
      sim.state.surface[0] = 0;
      sim.state.action[0] = A_AIR;
      const inputs = new Uint32Array(2);
      let index = -1;
      for (let f = 0; f < 60 && index < 0; f++) {
        step(sim, inputs);
        const queue = events(sim);
        for (let e = 0; e < queue.count; e++) {
          if (queue.type[e] === EV_LEDGE) index = queue.b[e]!;
        }
      }
      expect(index).toBe(expected);
      expect(sim.state.action[0]).toBe(A_LEDGE);
      // Le combattant est suspendu contre ce rebord, à l'extérieur, la tête à sa hauteur.
      const view = createFighterView();
      readFighter(sim, 0, view);
      expect(view.x).toBe(ledges.x[index]! + ledges.side[index]! * 3);
      expect(view.y).toBe(ledges.y[index]! - 12);
    }
  });
});

describe('état affiché', () => {
  it('décrit l’action, la frame, la vitesse et les dégâts', () => {
    const sim = createSim(testConfig(2));
    const inputs = new Uint32Array(2);
    inputs[0] = encodeInput(0, 0, BTN_ATTACK);
    step(sim, inputs);
    sim.state.damage[0] = fx(12.5);
    const view = createFighterView();
    readFighter(sim, 0, view);
    const text = describeFighter(TEST_FIGHTER, 0, view);
    expect(text).toContain('J1');
    expect(text).toContain('ATTACK');
    expect(text).toContain('jab');
    expect(text).toContain('f1');
    expect(text).toContain('12.5%');
  });
});
