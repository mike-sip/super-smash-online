import { describe, expect, it } from 'vitest';
import { A_DEAD, fx, setDamage } from '@game/sim-core';
import {
  RESPAWN_DELAY,
  RESPAWN_INVINCIBILITY,
  SUDDEN_DEATH_DAMAGE,
  matchResult,
} from '../../src/index.ts';
import { config, fighter, hit, ko, newMatch, run, teamConfig, view } from '../helpers.ts';

describe('mort subite', () => {
  it('élimination simultanée des deux derniers : mort subite entre eux, à 300 %', () => {
    const sim = newMatch(config('stock', 3, { stocks: 1 }));
    ko(sim, 2);
    ko(sim, 0, 1);
    const v = view(sim);
    expect(v.phase).toBe('sudden-death');
    expect(v.framesLeft).toBe(-1);
    expect(matchResult(sim)).toBeNull();
    expect(Array.from(v.stocks.subarray(0, 3))).toEqual([1, 1, 0]);
    expect(Array.from(v.eliminated.subarray(0, 3))).toEqual([0, 0, 1]);
    for (const p of [0, 1]) {
      expect(fighter(sim, p).action).not.toBe(A_DEAD);
      expect(fighter(sim, p).damage).toBe(SUDDEN_DEATH_DAMAGE);
    }
    expect(fighter(sim, 2).action).toBe(A_DEAD);

    ko(sim, 1);
    const r = matchResult(sim)!;
    expect(r.reason).toBe('sudden-death');
    expect(r.winners).toEqual([0]);
    expect(r.players.map((p) => p.placement)).toEqual([1, 2, 3]);
  });

  it('égalité au temps : mort subite entre les ex æquo seulement', () => {
    const clear = newMatch(config('time', 3, { timeLimit: 30 }));
    hit(clear, 0, 2);
    ko(clear, 2);
    run(clear, 1800);
    expect(matchResult(clear)!.winners).toEqual([0]);

    const tie = newMatch(config('time', 3, { timeLimit: 30 }));
    hit(tie, 0, 2);
    ko(tie, 2);
    run(tie, RESPAWN_DELAY + RESPAWN_INVINCIBILITY);
    hit(tie, 1, 2);
    ko(tie, 2);
    run(tie, 1800);
    const v = view(tie);
    expect(v.phase).toBe('sudden-death');
    expect(fighter(tie, 2).action).toBe(A_DEAD);
    expect(v.eliminated[2]).toBe(1);
    ko(tie, 0);
    const r = matchResult(tie)!;
    expect(r.winners).toEqual([1]);
    expect(r.players.map((p) => p.placement)).toEqual([2, 1, 3]);
  });

  it('en Endurance, la mort subite se joue à 1 point de vie', () => {
    const sim = newMatch(config('stamina', 2));
    ko(sim, 0, 1);
    expect(view(sim).phase).toBe('sudden-death');
    expect(view(sim).hp[0]).toBe(1);
    hit(sim, 0, 1);
    expect(matchResult(sim)!.winners).toEqual([0]);
  });

  it('nouvelle élimination simultanée : nouvelle mort subite', () => {
    const sim = newMatch(config('stock', 2, { stocks: 1 }));
    ko(sim, 0, 1);
    ko(sim, 0, 1);
    expect(view(sim).phase).toBe('sudden-death');
    ko(sim, 0);
    expect(matchResult(sim)!.winners).toEqual([1]);
  });

  it('en équipes, mort subite entre les équipes à égalité', () => {
    const sim = newMatch(teamConfig('stock', [0, 1, 0, 1], { stocks: 1, timeLimit: 30 }));
    setDamage(sim, 0, fx(10));
    setDamage(sim, 1, fx(10));
    run(sim, 1800);
    expect(view(sim).phase).toBe('sudden-death');
    ko(sim, 1, 3);
    const r = matchResult(sim)!;
    expect(r.winningTeam).toBe(0);
    expect(r.players.map((p) => p.placement)).toEqual([1, 2, 1, 2]);
  });
});
