import { describe, expect, it } from 'vitest';
import { A_DEAD, frame, fx, setDamage } from '@game/sim-core';
import { RESPAWN_DELAY, matchResult } from '../../src/index.ts';
import { config, fighter, hit, ko, newMatch, run, teamConfig, view } from '../helpers.ts';

describe('mode Temps', () => {
  it('décompte le temps et affiche les secondes restantes arrondies au-dessus', () => {
    const sim = newMatch(config('time', 2));
    run(sim, 1);
    expect(view(sim).framesLeft).toBe(180 * 60 - 1);
    expect(view(sim).timeLeft).toBe(180);
    run(sim, 59);
    expect(view(sim).timeLeft).toBe(179);
    expect(view(sim).showScore).toBe(true);
  });

  it('fait réapparaître sans limite de vies', () => {
    const sim = newMatch(config('time', 2));
    for (let k = 0; k < 5; k++) {
      ko(sim, 0);
      run(sim, RESPAWN_DELAY);
    }
    expect(fighter(sim, 0).action).not.toBe(A_DEAD);
    expect(view(sim).stocks[0]).toBe(-1);
    expect(view(sim).eliminated[0]).toBe(0);
    expect(view(sim).score[0]).toBe(-5);
  });

  it('se termine à la frame exacte de la fin du temps, au meilleur score', () => {
    const sim = newMatch(config('time', 3, { timeLimit: 30 }));
    hit(sim, 1, 0);
    ko(sim, 0);
    run(sim, 30 * 60 - frame(sim) - 1);
    expect(view(sim).phase).toBe('playing');
    run(sim, 1);
    expect(view(sim).phase).toBe('over');
    expect(view(sim).timeLeft).toBe(0);
    const r = matchResult(sim)!;
    expect(r.reason).toBe('time');
    expect(r.endFrame).toBe(1800);
    expect(r.winners).toEqual([1]);
    expect(r.players.map((p) => p.placement)).toEqual([3, 1, 2]);
    expect(r.players.map((p) => p.score)).toEqual([-1, 1, 0]);
  });

  it('en équipes, additionne les scores de l’équipe', () => {
    const sim = newMatch(teamConfig('time', [0, 1, 1], { timeLimit: 30 }));
    // Équipe 0 : +2 (joueur 0 marque deux fois). Équipe 1 : −2 + 0.
    hit(sim, 0, 1);
    ko(sim, 1);
    run(sim, RESPAWN_DELAY);
    hit(sim, 0, 2);
    ko(sim, 2);
    run(sim, 1800);
    const r = matchResult(sim)!;
    expect(r.winningTeam).toBe(0);
    expect(r.winners).toEqual([0]);
    expect(r.players.map((p) => p.placement)).toEqual([1, 2, 2]);
  });
});

describe('limite de temps en Stock', () => {
  it('à la fin du temps, le plus de vies l’emporte', () => {
    const sim = newMatch(config('stock', 2, { timeLimit: 30 }));
    ko(sim, 0);
    run(sim, 1800);
    const r = matchResult(sim)!;
    expect(r.reason).toBe('time');
    expect(r.winners).toEqual([1]);
  });

  it('à vies égales, le moins de dégâts l’emporte', () => {
    const sim = newMatch(config('stock', 3, { timeLimit: 30 }));
    setDamage(sim, 0, fx(40));
    setDamage(sim, 1, fx(10));
    setDamage(sim, 2, fx(25));
    run(sim, 1800);
    const r = matchResult(sim)!;
    expect(r.winners).toEqual([1]);
    expect(r.players.map((p) => p.placement)).toEqual([3, 1, 2]);
  });

  it('un joueur en attente de réapparition compte pour 0 % de dégâts', () => {
    const sim = newMatch(config('stock', 2, { stocks: 3, timeLimit: 30 }));
    ko(sim, 0);
    run(sim, RESPAWN_DELAY);
    setDamage(sim, 0, fx(10));
    setDamage(sim, 1, fx(50));
    run(sim, 1800 - frame(sim) - 5);
    ko(sim, 1); // 2 vies chacun ; le joueur 1 attend sa réapparition, encore à 50 % dans sim-core
    run(sim, 4);
    const r = matchResult(sim)!;
    expect(r.reason).toBe('time');
    expect(r.winners).toEqual([1]);
  });
});
