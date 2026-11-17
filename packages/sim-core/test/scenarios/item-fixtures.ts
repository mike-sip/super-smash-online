/**
 * Objets de test, aux valeurs choisies pour des scénarios lisibles. Les vrais objets sont dans le
 * module `stages-items`.
 */
import type { EntityDef, ItemSpawnDef, StageDef } from '../../src/defs.ts';
import type { SimConfig } from '../../src/step.ts';
import { fx } from '../../src/fixed.ts';
import { ENTITY_PASS, createSim, type Sim } from '../../src/index.ts';
import { TEST_ENTITIES, TEST_STAGE, testConfig } from '../../src/testing/fixtures.ts';

const BASE = TEST_ENTITIES.length;
export const K_ROCK = BASE + 1;
export const K_STICK = BASE + 2;
export const K_BOMB = BASE + 3;
export const K_HEAL = BASE + 4;
export const K_BOOM = BASE + 5;

export const ROCK: EntityDef = {
  name: 'rock',
  radius: fx(1.5),
  gravity: fx(0.1),
  lifetime: 1200,
  stageCollision: ENTITY_PASS,
  hit: { damage: fx(8), angle: 30, baseKnockback: fx(15), knockbackGrowth: fx(0.4) },
  destroyOnHit: false,
  item: { throwSpeed: fx(3), breakOnHit: true, breakOnContact: false },
};

export const STICK: EntityDef = {
  name: 'stick',
  radius: fx(2),
  gravity: fx(0.1),
  lifetime: 1200,
  stageCollision: ENTITY_PASS,
  hit: { damage: fx(9), angle: 40, baseKnockback: fx(20), knockbackGrowth: fx(0.5) },
  destroyOnHit: false,
  item: {
    throwSpeed: fx(2.5),
    breakOnHit: false,
    breakOnContact: false,
    swing: {
      name: 'stick swing',
      totalFrames: 24,
      hits: [
        {
          start: 6,
          end: 9,
          x1: fx(3),
          y1: fx(8),
          x2: fx(12),
          y2: fx(6),
          radius: fx(3),
          group: 0,
          damage: fx(12),
          angle: 40,
          baseKnockback: fx(30),
          knockbackGrowth: fx(0.9),
        },
      ],
      cancels: [],
    },
  },
};

export const BOOM: EntityDef = {
  name: 'boom',
  radius: fx(12),
  gravity: fx(0),
  lifetime: 8,
  stageCollision: ENTITY_PASS,
  hit: { damage: fx(18), angle: 70, baseKnockback: fx(45), knockbackGrowth: fx(1) },
  destroyOnHit: false,
};

export const BOMB: EntityDef = {
  name: 'bomb',
  radius: fx(2),
  gravity: fx(0.1),
  lifetime: 600,
  stageCollision: ENTITY_PASS,
  destroyOnHit: false,
  item: { throwSpeed: fx(2.5), breakOnHit: false, breakOnContact: true, burst: K_BOOM },
};

export const HEAL: EntityDef = {
  name: 'heal',
  radius: fx(2),
  gravity: fx(0.1),
  lifetime: 1200,
  stageCollision: ENTITY_PASS,
  destroyOnHit: false,
  item: { heal: fx(12), throwSpeed: fx(0), breakOnHit: false, breakOnContact: false },
};

export const ITEM_ENTITIES: EntityDef[] = [...TEST_ENTITIES, ROCK, STICK, BOMB, HEAL, BOOM];

export const ITEM_STAGE: StageDef = {
  ...TEST_STAGE,
  name: 'items',
  itemSpawns: [{ x1: fx(-40), x2: fx(40), y: fx(70) }],
};

export const ITEM_TABLE: ItemSpawnDef = {
  table: [
    { kind: K_ROCK, weight: 30 },
    { kind: K_STICK, weight: 20 },
    { kind: K_BOMB, weight: 14 },
    { kind: K_HEAL, weight: 36 },
  ],
  minInterval: 60,
  maxInterval: 120,
  maxActive: 3,
};

export function itemConfig(players = 2, items?: ItemSpawnDef, seed = 1): SimConfig {
  return { ...testConfig(players, seed), stage: ITEM_STAGE, entities: ITEM_ENTITIES, items };
}

/** Simulation à objets, sans apparition automatique : les scénarios posent leurs objets. */
export function itemSim(players = 2): Sim {
  return createSim(itemConfig(players));
}
