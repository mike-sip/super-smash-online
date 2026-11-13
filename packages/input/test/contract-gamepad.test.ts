/**
 * Test de contrat, partie manette : les `InputFrame` produits par le module à partir d'une
 * manette, joués dans la vraie simulation, déclenchent chaque action de `sim-core`.
 *
 * La manette est simulée : ce test prouve notre lecture, pas le matériel.
 */
import { describe, expect, it } from 'vitest';
import {
  A_AIR,
  A_AIRDODGE,
  A_ATTACK,
  A_DASH,
  A_GRAB,
  A_IDLE,
  A_LEDGE,
  A_LEDGE_GETUP,
  A_LEDGE_ROLL,
  A_ROLL,
  A_RUN,
  A_SHIELD,
  A_SPOTDODGE,
  A_WALK,
  M_DSMASH,
  M_FSMASH,
  M_FTILT,
  M_JAB,
  M_NAIR,
  M_NSPECIAL,
  M_USMASH,
  createFighterView,
  createSim,
  fx,
  readFighter,
  step,
} from '@game/sim-core';
import { testConfig } from '@game/sim-core/testing';
import { createInput, gamepadId } from '../src/index.ts';
import { fakePad, fakeWindow, type FakePadOptions } from './helpers.ts';

/** Une simulation à deux joueurs, le joueur 0 piloté par une manette simulée. */
function rig() {
  const sim = createSim(testConfig(2));
  const fake = fakeWindow();
  const input = createInput({ target: fake.window, players: 1 });
  const inputs = new Uint32Array(2);
  const view = createFighterView();
  fake.pads[0] = fakePad();
  input.sample(inputs);
  input.assign(0, gamepadId(0));

  /** Met la manette dans l'état donné ; sans argument, tout est relâché. */
  const pad = (state: FakePadOptions = {}): void => {
    fake.pads[0] = fakePad(state);
  };
  const frame = (count = 1) => {
    for (let f = 0; f < count; f++) {
      input.sample(inputs);
      step(sim, inputs);
    }
    readFighter(sim, 0, view);
    return view;
  };
  const until = (what: string, done: () => boolean, limit = 90): number => {
    for (let f = 1; f <= limit; f++) {
      frame();
      if (done()) return f;
    }
    throw new Error(`Jamais atteint en ${limit} frames : ${what}.`);
  };
  const action = (): number => sim.state.action[0]!;
  const move = (): number => sim.state.move[0]!;
  const hang = (): void => {
    sim.state.posX[0] = fx(-66);
    sim.state.posY[0] = fx(-5);
    sim.state.grounded[0] = 0;
    sim.state.surface[0] = 0;
    sim.state.action[0] = A_AIR;
    until('accroche au rebord', () => action() === A_LEDGE);
    frame(10);
  };
  const peak = (): number => {
    let best = 0;
    until('décollage', () => !view.grounded, 20);
    until(
      'atterrissage',
      () => {
        best = Math.max(best, view.y);
        return view.grounded;
      },
      200,
    );
    return best;
  };
  return { sim, pad, frame, until, action, move, hang, peak, view };
}

const stick = (x: number, y = 0): number[] => [x, y, 0, 0];
const cStick = (x: number, y: number): number[] => [0, 0, x, y];

describe('contrat manette : déplacements', () => {
  it('marche stick à mi-course, sans jamais courir', () => {
    const t = rig();
    t.pad({ axes: stick(0.5) });
    for (let f = 0; f < 40; f++) {
      t.frame();
      expect([A_IDLE, A_WALK]).toContain(t.action());
    }
    expect(t.action()).toBe(A_WALK);
  });

  it('marche plus vite quand le stick est plus incliné', () => {
    const slow = rig();
    slow.pad({ axes: stick(0.4) });
    slow.frame(40);
    const fast = rig();
    fast.pad({ axes: stick(0.6) });
    fast.frame(40);
    expect(slow.view.velX).toBeGreaterThan(0);
    expect(fast.view.velX).toBeGreaterThan(slow.view.velX);
  });

  it('part en dash sur un coup de stick, puis court', () => {
    const t = rig();
    t.pad({ axes: stick(1) });
    t.until('dash', () => t.action() === A_DASH, 3);
    t.until('course', () => t.action() === A_RUN, 30);
  });

  it('part en dash sur un coup de stick en diagonale', () => {
    // Stick rond poussé à fond vers le bas et la droite : 0,707 sur chaque axe, soit 90 sur 127
    // sans étirement, sous le seuil de 96 qu'exige un dash.
    const d = Math.SQRT1_2;
    const t = rig();
    t.pad({ axes: stick(-d, -d) });
    t.until('dash en diagonale', () => t.action() === A_DASH, 3);
    expect(t.view.facing).toBe(-1);
  });

  it('fait un grand saut bouton tenu, un petit saut bouton relâché aussitôt', () => {
    const tall = rig();
    tall.pad({ pressed: [2] });
    const high = tall.peak();

    const short = rig();
    short.pad({ pressed: [3] });
    short.frame();
    short.pad();
    const low = short.peak();

    expect(low).toBeGreaterThan(5);
    expect(high).toBeGreaterThan(low * 1.5);
  });
});

describe('contrat manette : attaques', () => {
  it('lance le jab, le spécial et la saisie', () => {
    for (const [button, expected] of [
      [0, [A_ATTACK, M_JAB]],
      [1, [A_ATTACK, M_NSPECIAL]],
    ] as const) {
      const t = rig();
      t.pad({ pressed: [button] });
      t.frame();
      expect([t.action(), t.move()]).toEqual(expected);
    }
    const grab = rig();
    grab.pad({ pressed: [4] });
    grab.frame();
    expect(grab.action()).toBe(A_GRAB);
  });

  it('lance une attaque dirigée stick à mi-course', () => {
    const t = rig();
    t.pad({ axes: stick(0.5) });
    t.frame(6);
    t.pad({ axes: stick(0.5), pressed: [0] });
    t.frame();
    expect([t.action(), t.move()]).toEqual([A_ATTACK, M_FTILT]);
  });

  it('lance un smash sur un coup de stick avec l’attaque', () => {
    const t = rig();
    t.pad({ axes: stick(1), pressed: [0] });
    t.frame();
    expect([t.action(), t.move()]).toEqual([A_ATTACK, M_FSMASH]);
  });

  it('lance les smash au stick droit', () => {
    for (const [x, y, slot, facing] of [
      [1, 0, M_FSMASH, 1],
      [-1, 0, M_FSMASH, -1],
      [0, -1, M_USMASH, 1],
      [0, 1, M_DSMASH, 1],
    ] as const) {
      const t = rig();
      t.pad({ axes: cStick(x, y) });
      t.frame();
      expect([t.action(), t.move(), t.view.facing]).toEqual([A_ATTACK, slot, facing]);
    }
  });

  it('lance une attaque aérienne', () => {
    const t = rig();
    t.pad({ pressed: [2] });
    t.until('décollage', () => !t.view.grounded, 20);
    t.pad({ pressed: [2, 0] });
    t.frame();
    expect([t.action(), t.move()]).toEqual([A_ATTACK, M_NAIR]);
  });
});

describe('contrat manette : défense et rebord', () => {
  it('lève le bouclier avec une gâchette enfoncée à moitié', () => {
    const t = rig();
    t.pad({ values: { 7: 0.6 } });
    t.frame(2);
    expect(t.action()).toBe(A_SHIELD);
  });

  it('roule, esquive sur place et esquive en l’air', () => {
    const roll = rig();
    roll.pad({ pressed: [6] });
    roll.frame(6);
    roll.pad({ pressed: [6], axes: stick(1) });
    roll.until('roulade', () => roll.action() === A_ROLL, 4);

    const spot = rig();
    spot.pad({ pressed: [6] });
    spot.frame(6);
    spot.pad({ pressed: [6], axes: stick(0, 1) });
    spot.until('esquive sur place', () => spot.action() === A_SPOTDODGE, 4);

    const air = rig();
    air.pad({ pressed: [2] });
    air.until('décollage', () => !air.view.grounded, 20);
    air.pad();
    air.frame(5);
    air.pad({ pressed: [7] });
    air.until('esquive aérienne', () => air.action() === A_AIRDODGE, 3);
  });

  it('choisit chaque option de rebord', () => {
    const up = rig();
    up.hang();
    up.pad({ axes: stick(0, -1) });
    up.until('remontée', () => up.action() === A_LEDGE_GETUP, 3);

    const roll = rig();
    roll.hang();
    roll.pad({ pressed: [6] });
    roll.until('remontée en roulade', () => roll.action() === A_LEDGE_ROLL, 3);

    const jump = rig();
    jump.hang();
    jump.pad({ pressed: [2] });
    jump.until('saut', () => jump.action() === A_AIR && jump.view.velY > 0, 3);

    const drop = rig();
    drop.hang();
    drop.pad({ axes: stick(0, 1) });
    drop.until('lâcher', () => drop.action() === A_AIR, 3);
  });
});
