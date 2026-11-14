import { ENTITY_PASS, M_NSPECIAL, createSim, fx, type EntityDef } from '@game/sim-core';
import { TEST_FIGHTER, TEST_STAGE } from '@game/sim-core/testing';
import { describe, expect, it } from 'vitest';
import { buildMatchConfig } from '../src/match.ts';
import { TEST_CHAR, TEST_HEAVY_CHAR } from './helpers.ts';

/** Deux entités de stage fictives, placées en tête de liste. */
const STAGE_ENTITIES: EntityDef[] = ['caisse', 'bombe'].map((name) => ({
  name,
  radius: fx(2),
  gravity: fx(0),
  lifetime: 60,
  stageCollision: ENTITY_PASS,
  destroyOnHit: false,
}));

describe('buildMatchConfig', () => {
  it('donne un combattant par joueur, dans l’ordre', () => {
    const config = buildMatchConfig({
      stage: TEST_STAGE,
      players: [TEST_CHAR, TEST_HEAVY_CHAR],
      seed: 7,
    });
    expect(config.fighters.map((f) => f.name)).toEqual(['test', 'heavy']);
    expect(config.seed).toBe(7);
    expect(config.stage).toBe(TEST_STAGE);
    expect(() => createSim(config)).not.toThrow();
  });

  it('place les projectiles après les entités du stage et renumérote les coups', () => {
    const config = buildMatchConfig({
      stage: TEST_STAGE,
      players: [TEST_HEAVY_CHAR, TEST_CHAR],
      entities: STAGE_ENTITIES,
      seed: 1,
    });
    expect(config.entities!.map((e) => e.name)).toEqual(['caisse', 'bombe', 'shot', 'ball']);
    const spawn = config.fighters[1]!.moves[M_NSPECIAL]!.spawn!;
    expect(config.entities![spawn.kind - 1]!.name).toBe('shot');
  });

  it('n’ajoute qu’une fois les projectiles d’un personnage choisi plusieurs fois', () => {
    const config = buildMatchConfig({
      stage: TEST_STAGE,
      players: Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? TEST_CHAR : TEST_HEAVY_CHAR)),
      entities: STAGE_ENTITIES,
      seed: 1,
    });
    expect(config.entities).toHaveLength(4);
    expect(config.fighters[0]).toBe(config.fighters[2]);
    expect(() => createSim(config)).not.toThrow();
  });

  it('ne modifie pas les données d’origine', () => {
    buildMatchConfig({
      stage: TEST_STAGE,
      players: [TEST_CHAR, TEST_CHAR],
      entities: STAGE_ENTITIES,
      seed: 1,
    });
    expect(TEST_FIGHTER.moves[M_NSPECIAL]!.spawn!.kind).toBe(1);
  });

  it('refuse un identifiant inconnu', () => {
    expect(() =>
      buildMatchConfig({ stage: TEST_STAGE, players: ['nacre', 'sorel'], seed: 1 }),
    ).toThrow(/inconnu/);
  });
});
