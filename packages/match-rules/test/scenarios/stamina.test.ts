import { describe, expect, it } from 'vitest';
import { A_DEAD, encodeInput, fx, setDamage } from '@game/sim-core';
import { RESPAWN_DELAY, matchResult } from '../../src/index.ts';
import { SHOT_DAMAGE, config, fighter, hit, newMatch, run, view } from '../helpers.ts';

describe('mode Endurance', () => {
  it('affiche les points de vie, qui baissent avec les dégâts', () => {
    const sim = newMatch(config('stamina', 2));
    expect(view(sim).hp[0]).toBe(150);
    expect(view(sim).stocks[0]).toBe(1);
    expect(view(sim).framesLeft).toBe(-1);
    expect(view(sim).timeLeft).toBe(-1);
    hit(sim, 1, 0);
    expect(view(sim).hp[0]).toBe(150 - SHOT_DAMAGE);
  });

  it('met KO à zéro point de vie, crédité à l’attaquant', () => {
    const sim = newMatch(config('stamina', 2));
    setDamage(sim, 0, fx(149));
    hit(sim, 1, 0);
    expect(fighter(sim, 0).action).toBe(A_DEAD);
    expect(view(sim).hp[0]).toBe(0);
    const r = matchResult(sim)!;
    expect(r.winners).toEqual([1]);
    expect(r.players[1]!.kos).toBe(1);
  });

  it('une sortie de zone limite est aussi un KO', () => {
    const sim = newMatch(config('stamina', 2));
    // Le joueur 1 marche vers la droite jusqu'à tomber du stage.
    for (let f = 0; f < 600 && view(sim).phase === 'playing'; f++) {
      run(sim, 1, [0, encodeInput(127, 0, 0)]);
    }
    expect(matchResult(sim)!.winners).toEqual([0]);
    expect(matchResult(sim)!.players[1]!.selfDestructs).toBe(1);
  });

  it('avec plusieurs vies, réapparaît avec tous ses points de vie', () => {
    const sim = newMatch(config('stamina', 2, { stocks: 2, stamina: 60 }));
    setDamage(sim, 0, fx(58));
    hit(sim, 1, 0);
    expect(view(sim).stocks[0]).toBe(1);
    run(sim, RESPAWN_DELAY);
    expect(fighter(sim, 0).action).not.toBe(A_DEAD);
    expect(view(sim).hp[0]).toBe(60);
    expect(view(sim).phase).toBe('playing');
  });

  it('avec une limite de temps, le plus de points de vie l’emporte à vies égales', () => {
    const sim = newMatch(config('stamina', 2, { timeLimit: 30 }));
    setDamage(sim, 0, fx(20));
    setDamage(sim, 1, fx(30));
    run(sim, 1800);
    expect(matchResult(sim)!.winners).toEqual([0]);
  });
});
