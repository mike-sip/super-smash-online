/** Équipes et tir allié (ajouts demandés par `match-rules`). */
import { describe, expect, it } from 'vitest';
import { A_GRAB, A_GRABBING } from '../../src/actions.ts';
import { fx } from '../../src/fixed.ts';
import {
  BTN_ATTACK,
  BTN_GRAB,
  EV_GRAB,
  EV_HIT,
  createSim,
  spawnEntity,
  type Sim,
} from '../../src/index.ts';
import { E_SHOT, TEST_FIGHTER as F, testConfig } from '../../src/testing/fixtures.ts';
import { NEUTRAL, countEvents, hold2, place, press } from './helpers.ts';

const A = press(BTN_ATTACK);
const G = press(BTN_GRAB);

/** Joueurs 0 et 1 face à face à 7 unités ; équipes et tir allié au choix. */
function duel(teams: readonly number[] | undefined, teamAttack?: boolean, players = 2): Sim {
  const sim = createSim({ ...testConfig(players), teams, teamAttack });
  place(sim, 0, 0, 1);
  place(sim, 1, 7, -1);
  for (let p = 2; p < players; p++) place(sim, p, -60 + p * 4, 1);
  return sim;
}

function jab(sim: Sim): number {
  let hits = 0;
  hold2(sim, A, NEUTRAL, 1);
  for (let f = 0; f < 15; f++) {
    hold2(sim, NEUTRAL, NEUTRAL, 1);
    hits += countEvents(sim, EV_HIT);
  }
  return hits;
}

describe('équipes et tir allié', () => {
  it('sans équipes, tout le monde se touche comme avant', () => {
    const sim = duel(undefined);
    expect(jab(sim)).toBe(1);
    expect(sim.state.damage[1]).toBeGreaterThan(0);
  });

  it('tir allié actif par défaut : un coéquipier est touché', () => {
    const sim = duel([0, 0]);
    expect(jab(sim)).toBe(1);
  });

  it('sans tir allié, une attaque traverse le coéquipier', () => {
    const sim = duel([1, 1], false);
    expect(jab(sim)).toBe(0);
    expect(sim.state.damage[1]).toBe(0);
  });

  it('sans tir allié, un adversaire d’une autre équipe est toujours touché', () => {
    const sim = duel([0, 1, 0], false, 3);
    expect(jab(sim)).toBe(1);
  });

  it('sans tir allié, le projectile d’un coéquipier passe, celui d’un adversaire touche', () => {
    const ally = duel([0, 0, 1], false, 3);
    place(ally, 0, -40, 1);
    place(ally, 1, 0, -1);
    spawnEntity(ally, E_SHOT, 0, fx(-10), fx(6), fx(2), 0);
    hold2(ally, NEUTRAL, NEUTRAL, 15);
    expect(ally.state.damage[1]).toBe(0);

    const foe = duel([0, 0, 1], false, 3);
    place(foe, 0, -40, 1);
    place(foe, 1, 0, -1);
    spawnEntity(foe, E_SHOT, 2, fx(-10), fx(6), fx(2), 0);
    hold2(foe, NEUTRAL, NEUTRAL, 15);
    expect(foe.state.damage[1]).toBeGreaterThan(0);
  });

  it('sans tir allié, un projectile sans propriétaire touche tout le monde', () => {
    const sim = duel([0, 0], false);
    place(sim, 0, -40, 1);
    place(sim, 1, 0, -1);
    spawnEntity(sim, E_SHOT, -1, fx(-10), fx(6), fx(2), 0);
    hold2(sim, NEUTRAL, NEUTRAL, 15);
    expect(sim.state.damage[1]).toBeGreaterThan(0);
  });

  it('sans tir allié, on ne saisit pas un coéquipier', () => {
    const sim = duel([2, 2], false);
    hold2(sim, G, NEUTRAL, 1);
    let grabs = 0;
    for (let f = 0; f < F.grab.totalFrames; f++) {
      hold2(sim, NEUTRAL, NEUTRAL, 1);
      grabs += countEvents(sim, EV_GRAB);
    }
    expect(grabs).toBe(0);
    expect(sim.state.action[0]).not.toBe(A_GRABBING);

    const foe = duel([2, 3], false);
    hold2(foe, G, NEUTRAL, 1);
    expect(foe.state.action[0]).toBe(A_GRAB);
    hold2(foe, NEUTRAL, NEUTRAL, F.grab.start - 1);
    expect(foe.state.action[0]).toBe(A_GRABBING);
  });

  it('refuse une liste d’équipes de mauvaise longueur ou une équipe invalide', () => {
    expect(() => createSim({ ...testConfig(3), teams: [0, 1] })).toThrow(/équipe/);
    expect(() => createSim({ ...testConfig(2), teams: [0, -1] })).toThrow(/équipe/);
    expect(() => createSim({ ...testConfig(2), teams: [0, 1.5] })).toThrow(/équipe/);
  });
});
