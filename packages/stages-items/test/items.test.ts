import {
  BTN_ATTACK,
  EV_ITEM_PICKUP,
  EV_ITEM_SPAWN,
  ITEM_MODE_HELD,
  checksum,
  createSim,
  encodeInput,
  fx,
  spawnEntity,
  step,
  type Sim,
  type SimConfig,
} from '@game/sim-core';
import { describe, expect, it } from 'vitest';
import {
  ITEMS,
  STAGES,
  applyItems,
  applyStage,
  isHazardEntity,
  itemOf,
  type ItemId,
} from '../src/index.ts';
import { baseConfig, lcg, randomInputs } from './helpers.ts';

/** Type d'entité de l'objet `id` dans `config`. */
function kindOf(config: SimConfig, id: ItemId): number {
  const index = config.entities!.findIndex((_, k) => itemOf(config, k + 1) === id);
  expect(index).toBeGreaterThanOrEqual(0);
  return index + 1;
}

/** Simulation à 2 joueurs sur le Récif, objets autorisés mais sans apparition automatique. */
function itemSim(): Sim {
  const config = applyItems(applyStage(baseConfig(2), 'recif'), { frequency: 'normal' });
  const sim = createSim({ ...config, items: undefined });
  sim.state.posX[0] = fx(0);
  sim.state.facing[0] = 1;
  sim.state.posX[1] = fx(60);
  return sim;
}

function put(sim: Sim, id: ItemId, x: number): number {
  const kind = kindOf(sim.config, id);
  return spawnEntity(sim, kind, -1, fx(x), sim.entityDefs[kind - 1]!.radius, 0, 0);
}

function run(sim: Sim, input0: number, frames: number): void {
  const inputs = new Uint32Array(sim.config.fighters.length);
  inputs[0] = input0;
  for (let f = 0; f < frames; f++) step(sim, inputs);
}

describe('applyItems', () => {
  it('ne fait rien apparaître à « off »', () => {
    const base = baseConfig(2);
    const config = applyItems(base, { frequency: 'off' });
    expect(config.items).toBeUndefined();
    expect(config.entities).toBe(base.entities);
  });

  it('ajoute les objets après les entités existantes, avec les poids et délais de la spec', () => {
    const base = baseConfig(2);
    const before = base.entities!.length;
    const config = applyItems(base, { frequency: 'normal' });
    expect(config.entities!.slice(0, before)).toEqual(base.entities);
    const items = config.items!;
    expect(items.minInterval).toBe(600);
    expect(items.maxInterval).toBe(960);
    expect(items.maxActive).toBe(3);
    const weights = Object.fromEntries(
      items.table.map((row) => [itemOf(config, row.kind), row.weight]),
    );
    expect(weights).toEqual({ galet: 30, baton: 20, petard: 14, baie: 30, fiole: 6 });
    expect(itemOf(config, 1)).toBeUndefined();
    // Le pétard explose en une entité de la configuration, qui n'est pas un objet.
    const petard = config.entities![kindOf(config, 'petard') - 1]!;
    const burst = petard.item!.burst!;
    expect(config.entities![burst - 1]!.item).toBeUndefined();
    expect(config.entities![burst - 1]!.hit!.damage).toBe(fx(18));
  });

  it('applique chaque fréquence', () => {
    const base = baseConfig(2);
    const at = (frequency: 'low' | 'high') => applyItems(base, { frequency }).items!;
    expect(at('low')).toMatchObject({ minInterval: 1080, maxInterval: 1560, maxActive: 2 });
    expect(at('high')).toMatchObject({ minInterval: 300, maxInterval: 540, maxActive: 4 });
  });

  it('restreint la liste aux objets autorisés', () => {
    const config = applyItems(baseConfig(2), { frequency: 'high', kinds: ['baie', 'galet'] });
    expect(config.items!.table.map((row) => itemOf(config, row.kind))).toEqual(['galet', 'baie']);
    expect(applyItems(baseConfig(2), { frequency: 'high', kinds: [] }).items).toBeUndefined();
  });

  it('se combine avec applyStage dans les deux ordres, sans doublon', () => {
    const a = applyItems(applyStage(baseConfig(2), 'geysers'), { frequency: 'normal' });
    const b = applyStage(applyItems(baseConfig(2), { frequency: 'normal' }), 'geysers');
    for (const config of [a, b]) {
      const jet = config.stage.hazards![0]!.kind;
      expect(isHazardEntity(config, jet)).toBe(true);
      expect(new Set(config.items!.table.map((row) => itemOf(config, row.kind))).size).toBe(5);
    }
    expect(a.entities).toHaveLength(b.entities!.length);
    expect(applyItems(a, { frequency: 'normal' }).entities).toHaveLength(a.entities!.length);
  });

  it('décrit les 5 objets dans l’ordre de la spec', () => {
    expect(ITEMS.map((item) => item.id)).toEqual(['galet', 'baton', 'petard', 'baie', 'fiole']);
  });
});

describe('objets réels', () => {
  it('la baie retire 12 %, la fiole 35 %', () => {
    for (const [id, heal] of [
      ['baie', 12],
      ['fiole', 35],
    ] as const) {
      const sim = itemSim();
      sim.state.damage[0] = fx(50);
      put(sim, id, 1);
      run(sim, 0, 2);
      expect(sim.state.damage[0]).toBe(fx(50 - heal));
    }
  });

  it('le coup de bâton inflige 12 %', () => {
    const sim = itemSim();
    put(sim, 'baton', 3);
    run(sim, 0, 2);
    run(sim, encodeInput(0, 0, BTN_ATTACK), 1);
    expect(sim.state.eMode[sim.state.held[0]! - 1]).toBe(ITEM_MODE_HELD);
    run(sim, 0, 2);
    sim.state.posX[1] = fx(10);
    sim.state.facing[1] = -1;
    run(sim, encodeInput(0, 0, BTN_ATTACK), 1);
    run(sim, 0, 20);
    expect(sim.state.damage[1]).toBe(fx(12));
  });

  it('le pétard qui traîne explose au bout de 10 s et blesse qui est à côté', () => {
    const sim = itemSim();
    put(sim, 'petard', 4);
    run(sim, 0, 599);
    expect(sim.state.damage[0]).toBe(0);
    run(sim, 0, 3);
    expect(sim.state.damage[0]).toBe(fx(18));
  });
});

describe('objets en partie', () => {
  it('apparaissent, se ramassent et se rejouent à l’identique sur chaque stage', () => {
    // Avec des inputs aléatoires, un ramassage reste rare : on les compte sur l'ensemble des stages.
    let picked = 0;
    for (const stage of STAGES) {
      const play = (): { sum: number; spawned: number; picked: number } => {
        const config = applyItems(applyStage(baseConfig(8, 5), stage.id), { frequency: 'high' });
        const sim = createSim(config);
        const next = lcg(77);
        const inputs = new Uint32Array(8);
        let spawned = 0;
        let picked = 0;
        for (let f = 0; f < 7200; f++) {
          randomInputs(next, inputs);
          step(sim, inputs);
          for (let e = 0; e < sim.events.count; e++) {
            if (sim.events.type[e] === EV_ITEM_SPAWN) spawned++;
            if (sim.events.type[e] === EV_ITEM_PICKUP) picked++;
          }
        }
        return { sum: checksum(sim), spawned, picked };
      };
      const first = play();
      expect(first.spawned, stage.id).toBeGreaterThan(5);
      picked += first.picked;
      expect(play()).toEqual(first);
    }
    expect(picked).toBeGreaterThan(0);
  });
});
