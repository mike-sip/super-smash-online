import { describe, expect, it } from 'vitest';
import { BTN_SPECIAL, M_ULTIMATE, encodeInput, setDamage, type Sim } from '@game/sim-core';
import { RESPAWN_DELAY, matchResult } from '../../src/index.ts';
import {
  SHOT_DAMAGE,
  config,
  eliminate,
  fighter,
  hit,
  ko,
  newMatch,
  run,
  view,
} from '../helpers.ts';

const SPECIAL = encodeInput(0, 0, BTN_SPECIAL);

/** Inflige `n` tirs du joueur 1 au joueur 0, remis à 0 % après chacun pour qu'il reste sur place. */
function shots(sim: Sim, n: number): void {
  for (let k = 0; k < n; k++) {
    hit(sim, 1, 0);
    setDamage(sim, 0, 0);
    run(sim, 1);
  }
}

describe('jauge d’attaque ultime', () => {
  it('se remplit d’un point par % infligé et d’un demi-point par % subi', () => {
    const sim = newMatch(config('stock', 2));
    hit(sim, 1, 0);
    expect(view(sim).meter[1]).toBeCloseTo(SHOT_DAMAGE / 100, 6);
    expect(view(sim).meter[0]).toBeCloseTo(SHOT_DAMAGE / 200, 6);
    expect(view(sim).meterEnabled).toBe(true);
  });

  it('pleine, elle autorise l’ultime ; lancée, elle se vide', () => {
    const sim = newMatch(config('stock', 2));
    shots(sim, 19);
    expect(view(sim).ultimateReady[1]).toBe(0);
    shots(sim, 1);
    expect(view(sim).meter[1]).toBe(1);
    expect(view(sim).ultimateReady[1]).toBe(1);
    expect(fighter(sim, 1).ultimateReady).toBe(true);

    // Les dégâts suivants ne font pas déborder la jauge.
    shots(sim, 2);
    expect(view(sim).meter[1]).toBe(1);

    run(sim, 1, [0, SPECIAL]);
    expect(fighter(sim, 1).move).toBe(M_ULTIMATE);
    expect(view(sim).meter[1]).toBe(0);
    expect(view(sim).ultimateReady[1]).toBe(0);
    run(sim, 80);
    eliminate(sim, 0);
    expect(matchResult(sim)!.players[1]!.ultimatesUsed).toBe(1);
  });

  it('est conservée après une chute', () => {
    const sim = newMatch(config('stock', 2));
    shots(sim, 4);
    const before = view(sim).meter[1]!;
    ko(sim, 1);
    run(sim, RESPAWN_DELAY + 10);
    expect(view(sim).meter[1]).toBe(before);
  });

  it('désactivée : ne se remplit pas et n’autorise rien', () => {
    const sim = newMatch(config('stock', 2, { ultimate: false }));
    shots(sim, 25);
    expect(view(sim).meter[1]).toBe(0);
    expect(view(sim).ultimateReady[1]).toBe(0);
    expect(view(sim).meterEnabled).toBe(false);
    run(sim, 1, [0, SPECIAL]);
    expect(fighter(sim, 1).move).not.toBe(M_ULTIMATE);
  });
});
