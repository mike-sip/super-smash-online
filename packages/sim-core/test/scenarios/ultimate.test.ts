/** Attaque ultime : autorisation, déclenchement, événement (ajouts demandés par `match-rules`). */
import { describe, expect, it } from 'vitest';
import { A_AIR, A_ATTACK } from '../../src/actions.ts';
import {
  BTN_SPECIAL,
  EV_ULTIMATE,
  M_NSPECIAL,
  M_SSPECIAL,
  M_ULTIMATE,
  MOVE_SLOTS,
  createFighterView,
  createSim,
  readFighter,
  respawn,
  setUltimateReady,
  type FighterDef,
} from '../../src/index.ts';
import { TEST_FIGHTER, testConfig } from '../../src/testing/fixtures.ts';
import { countEvents, hold, newSim, press, stick, teleportAir } from './helpers.ts';

const B = press(BTN_SPECIAL);

describe('attaque ultime', () => {
  it('occupe le dernier emplacement d’attaque', () => {
    expect(M_ULTIMATE).toBe(20);
    expect(MOVE_SLOTS).toBe(21);
    expect(TEST_FIGHTER.moves[M_ULTIMATE]).toBeDefined();
  });

  it('sans autorisation, le spécial neutre reste le spécial neutre', () => {
    const sim = newSim();
    hold(sim, B, 1);
    expect(sim.state.action[0]).toBe(A_ATTACK);
    expect(sim.state.move[0]).toBe(M_NSPECIAL);
    expect(countEvents(sim, EV_ULTIMATE)).toBe(0);
  });

  it('autorisée, un spécial neutre au sol la lance, retire l’autorisation et émet EV_ULTIMATE', () => {
    const sim = newSim();
    setUltimateReady(sim, 0, true);
    const view = createFighterView();
    readFighter(sim, 0, view);
    expect(view.ultimateReady).toBe(true);

    hold(sim, B, 1);
    expect(sim.state.action[0]).toBe(A_ATTACK);
    expect(sim.state.move[0]).toBe(M_ULTIMATE);
    expect(countEvents(sim, EV_ULTIMATE)).toBe(1);
    expect(sim.events.a[0]).toBe(0);
    readFighter(sim, 0, view);
    expect(view.ultimateReady).toBe(false);
  });

  it('se lance aussi en l’air', () => {
    const sim = newSim();
    teleportAir(sim, 0, 0, 40);
    expect(sim.state.action[0]).toBe(A_AIR);
    setUltimateReady(sim, 0, true);
    hold(sim, B, 1);
    expect(sim.state.move[0]).toBe(M_ULTIMATE);
  });

  it('un spécial latéral reste un spécial latéral, et l’autorisation est conservée', () => {
    const base = TEST_FIGHTER.moves;
    const moves = base.slice();
    moves[M_SSPECIAL] = base[M_NSPECIAL];
    const fighter: FighterDef = { ...TEST_FIGHTER, moves };
    const sim = createSim({ ...testConfig(2), fighters: [fighter, fighter] });
    setUltimateReady(sim, 0, true);
    hold(sim, stick(127, 0, BTN_SPECIAL), 1);
    expect(sim.state.move[0]).toBe(M_SSPECIAL);
    expect(sim.state.ultimateReady[0]).toBe(1);
  });

  it('un combattant sans ultime garde son spécial neutre et son autorisation', () => {
    const moves = TEST_FIGHTER.moves.slice();
    moves[M_ULTIMATE] = undefined;
    const fighter: FighterDef = { ...TEST_FIGHTER, moves };
    const sim = createSim({ ...testConfig(2), fighters: [fighter, fighter] });
    setUltimateReady(sim, 0, true);
    hold(sim, B, 1);
    expect(sim.state.move[0]).toBe(M_NSPECIAL);
    expect(sim.state.ultimateReady[0]).toBe(1);
    expect(countEvents(sim, EV_ULTIMATE)).toBe(0);
  });

  it('respawn remet l’autorisation à 0, comme l’extension E6 de fighters', () => {
    const sim = newSim();
    setUltimateReady(sim, 0, true);
    respawn(sim, 0);
    expect(sim.state.ultimateReady[0]).toBe(0);
  });

  it('setUltimateReady(false) retire l’autorisation', () => {
    const sim = newSim();
    setUltimateReady(sim, 0, true);
    setUltimateReady(sim, 0, false);
    hold(sim, B, 1);
    expect(sim.state.move[0]).toBe(M_NSPECIAL);
  });
});
