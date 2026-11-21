import { describe, expect, it } from 'vitest';
import { A_DEAD } from '@game/sim-core';
import { RESPAWN_DELAY, RESPAWN_INVINCIBILITY, matchResult } from '../../src/index.ts';
import { config, eliminate, fighter, ko, newMatch, run, teamConfig, view } from '../helpers.ts';

describe('mode Stock', () => {
  it('démarre avec les vies, le chronomètre et la phase de jeu', () => {
    const sim = newMatch(config('stock', 3));
    const v = view(sim);
    expect(v.mode).toBe('stock');
    expect(v.phase).toBe('playing');
    expect(v.players).toBe(3);
    expect(Array.from(v.stocks.subarray(0, 3))).toEqual([3, 3, 3]);
    expect(v.framesLeft).toBe(420 * 60);
    expect(v.timeLeft).toBe(420);
    expect(v.eliminated[0]).toBe(0);
    expect(matchResult(sim)).toBeNull();
  });

  it('retire une vie au KO et fait réapparaître après le délai, invincible', () => {
    const sim = newMatch(config('stock', 2));
    ko(sim, 0);
    expect(view(sim).stocks[0]).toBe(2);
    expect(view(sim).respawnIn[0]).toBe(RESPAWN_DELAY);

    run(sim, RESPAWN_DELAY - 1);
    expect(fighter(sim, 0).action).toBe(A_DEAD);
    run(sim, 1);
    expect(fighter(sim, 0).action).not.toBe(A_DEAD);
    expect(fighter(sim, 0).invincible).toBe(true);
    expect(view(sim).invincible[0]).toBe(1);
    expect(view(sim).respawnIn[0]).toBe(0);

    run(sim, RESPAWN_INVINCIBILITY);
    expect(fighter(sim, 0).invincible).toBe(false);
  });

  it('élimine à la dernière vie : plus de réapparition', () => {
    const sim = newMatch(config('stock', 3, { stocks: 2 }));
    ko(sim, 0);
    run(sim, RESPAWN_DELAY);
    ko(sim, 0);
    expect(view(sim).stocks[0]).toBe(0);
    expect(view(sim).eliminated[0]).toBe(1);
    run(sim, RESPAWN_DELAY * 3);
    expect(fighter(sim, 0).action).toBe(A_DEAD);
    expect(view(sim).phase).toBe('playing');
  });

  it('se termine quand il ne reste qu’un joueur, puis ne bouge plus', () => {
    const sim = newMatch(config('stock', 3, { stocks: 1 }));
    run(sim, 10);
    ko(sim, 2);
    ko(sim, 0);
    const v = view(sim);
    expect(v.phase).toBe('over');
    const result = matchResult(sim)!;
    expect(result.reason).toBe('last-standing');
    expect(result.winners).toEqual([1]);
    expect(result.winningTeam).toBeNull();
    expect(result.endFrame).toBe(12);
    expect(result.players.map((p) => p.placement)).toEqual([2, 1, 3]);
    expect(result.players[1]!.stocksLeft).toBe(1);
    expect(result.players[0]!.eliminatedAt).toBe(12);
    expect(result.players[2]!.eliminatedAt).toBe(11);
    expect(result.players[1]!.eliminatedAt).toBe(-1);

    // Après la fin, le crochet ne modifie plus rien.
    ko(sim, 1);
    run(sim, RESPAWN_DELAY * 2);
    expect(view(sim).stocks[1]).toBe(1);
    expect(matchResult(sim)).toEqual(result);
  });

  it('en équipes, se termine quand il ne reste qu’une équipe', () => {
    const sim = newMatch(teamConfig('stock', [0, 1, 0, 1], { stocks: 1 }));
    ko(sim, 1);
    expect(view(sim).phase).toBe('playing');
    ko(sim, 0);
    expect(view(sim).phase).toBe('playing');
    eliminate(sim, 3);
    const result = matchResult(sim)!;
    expect(result.winningTeam).toBe(0);
    expect(result.winners).toEqual([0, 2]);
    expect(result.players.map((p) => p.placement)).toEqual([1, 2, 1, 2]);
    expect(Array.from(view(sim).team.subarray(0, 4))).toEqual([0, 1, 0, 1]);
  });

  it('sans équipes, la vue n’a pas d’équipe', () => {
    const sim = newMatch(config('stock', 2));
    expect(view(sim).team[0]).toBe(-1);
    expect(view(sim).hp[0]).toBe(-1);
  });
});
