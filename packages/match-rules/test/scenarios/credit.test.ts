import { describe, expect, it } from 'vitest';
import { setDamage } from '@game/sim-core';
import { KO_CREDIT_WINDOW, RESPAWN_DELAY, matchResult } from '../../src/index.ts';
import { SHOT_DAMAGE, config, hit, ko, newMatch, run, teamConfig, view } from '../helpers.ts';

/** Statistiques courantes, lues en fin de match ou par la vue du score. */
function stats(sim: ReturnType<typeof newMatch>) {
  // Fin forcée : on lit les statistiques dans les résultats d'un match à 1 vie.
  return matchResult(sim)!.players;
}

describe('attribution des KO', () => {
  it('crédite le dernier attaquant dans la fenêtre', () => {
    const sim = newMatch(config('stock', 3, { stocks: 1 }));
    hit(sim, 1, 0);
    hit(sim, 2, 0);
    ko(sim, 0);
    ko(sim, 1);
    const p = stats(sim);
    expect(p[2]!.kos).toBe(1);
    expect(p[1]!.kos).toBe(0);
    expect(p[0]!.falls).toBe(1);
    expect(p[0]!.selfDestructs).toBe(0);
    expect(p[1]!.selfDestructs).toBe(1);
  });

  it('au-delà de la fenêtre, c’est une autodestruction', () => {
    const sim = newMatch(config('stock', 2, { stocks: 1 }));
    hit(sim, 1, 0);
    run(sim, KO_CREDIT_WINDOW);
    ko(sim, 0);
    const p = stats(sim);
    expect(p[1]!.kos).toBe(0);
    expect(p[0]!.selfDestructs).toBe(1);
  });

  it('à la limite de la fenêtre, le KO est encore crédité', () => {
    const sim = newMatch(config('stock', 2, { stocks: 1 }));
    hit(sim, 1, 0);
    run(sim, KO_CREDIT_WINDOW - 1);
    ko(sim, 0); // KO constaté KO_CREDIT_WINDOW frames après le coup
    expect(stats(sim)[1]!.kos).toBe(1);
  });

  it('la réapparition efface le dernier attaquant', () => {
    const sim = newMatch(config('stock', 2, { stocks: 2 }));
    hit(sim, 1, 0);
    ko(sim, 0);
    run(sim, RESPAWN_DELAY);
    ko(sim, 0);
    const p = stats(sim);
    expect(p[1]!.kos).toBe(1);
    expect(p[0]!.falls).toBe(2);
    expect(p[0]!.selfDestructs).toBe(1);
  });

  it('un KO par un coéquipier n’est crédité à personne et n’est pas une autodestruction', () => {
    const sim = newMatch(teamConfig('stock', [0, 0, 1], { stocks: 1, teamAttack: true }));
    hit(sim, 1, 0);
    ko(sim, 0);
    ko(sim, 1);
    const p = stats(sim);
    expect(p[1]!.kos).toBe(0);
    expect(p[0]!.falls).toBe(1);
    expect(p[0]!.selfDestructs).toBe(0);
  });

  it('le score vaut KO marqués moins chutes', () => {
    const sim = newMatch(config('time', 2));
    hit(sim, 1, 0);
    ko(sim, 0);
    expect(view(sim).score[1]).toBe(1);
    expect(view(sim).score[0]).toBe(-1);
  });
});

describe('dégâts infligés et subis', () => {
  it('compte la hausse des dégâts pour la victime et l’attaquant', () => {
    const sim = newMatch(config('stock', 2, { stocks: 1 }));
    hit(sim, 1, 0);
    hit(sim, 1, 0);
    ko(sim, 0);
    const p = stats(sim);
    expect(p[0]!.damageTaken).toBe(2 * SHOT_DAMAGE);
    expect(p[1]!.damageDealt).toBe(2 * SHOT_DAMAGE);
    expect(p[1]!.damageTaken).toBe(0);
  });

  it('ignore une baisse des dégâts (soin, réapparition)', () => {
    const sim = newMatch(config('stock', 2, { stocks: 1 }));
    hit(sim, 1, 0);
    setDamage(sim, 0, 0);
    run(sim, 1);
    hit(sim, 1, 0);
    ko(sim, 0);
    expect(stats(sim)[0]!.damageTaken).toBe(2 * SHOT_DAMAGE);
  });

  it('les dégâts infligés à un coéquipier ne comptent pas comme infligés', () => {
    const sim = newMatch(teamConfig('stock', [0, 0, 1], { stocks: 1, teamAttack: true }));
    hit(sim, 1, 0);
    ko(sim, 0);
    ko(sim, 1);
    const p = stats(sim);
    expect(p[0]!.damageTaken).toBe(SHOT_DAMAGE);
    expect(p[1]!.damageDealt).toBe(0);
  });
});
