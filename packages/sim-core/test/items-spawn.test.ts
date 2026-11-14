import { describe, expect, it } from 'vitest';
import { fx } from '../src/fixed.ts';
import { EV_ITEM_SPAWN, MAX_ENTITIES, createSim, step } from '../src/index.ts';
import { G_ITEM_TIMER } from '../src/state.ts';
import { ITEM_MODE_FREE } from '../src/systems/items.ts';
import {
  ITEM_TABLE,
  K_BOMB,
  K_HEAL,
  K_ROCK,
  K_STICK,
  itemConfig,
} from './scenarios/item-fixtures.ts';

/** Joue `frames` frames sans input et relève chaque apparition (frame, type, x). */
function spawns(players: number, frames: number, seed = 1, table = ITEM_TABLE) {
  const sim = createSim(itemConfig(players, table, seed));
  const inputs = new Uint32Array(players);
  const out: { frame: number; kind: number; x: number; slot: number }[] = [];
  for (let f = 0; f < frames; f++) {
    step(sim, inputs);
    for (let e = 0; e < sim.events.count; e++) {
      if (sim.events.type[e] !== EV_ITEM_SPAWN) continue;
      const slot = sim.events.a[e]!;
      out.push({ frame: f, kind: sim.events.b[e]!, x: sim.state.ePosX[slot]!, slot });
      // Les objets sont retirés aussitôt : on mesure le tirage, pas le maximum.
      sim.state.eKind[slot] = 0;
    }
  }
  return { sim, out };
}

describe('apparition des objets', () => {
  it('n’a lieu qu’avec une table d’apparition', () => {
    const sim = createSim(itemConfig(2));
    const inputs = new Uint32Array(2);
    for (let f = 0; f < 2000; f++) step(sim, inputs);
    for (let e = 0; e < MAX_ENTITIES; e++) expect(sim.state.eKind[e]).toBe(0);
    expect(sim.state.g[G_ITEM_TIMER]).toBe(0);
  });

  it('respecte l’intervalle et la zone', () => {
    const { out } = spawns(2, 6000);
    expect(out.length).toBeGreaterThan(40);
    let prev = -1;
    for (const s of out) {
      // Délai tiré dans [60, 120] frames, y compris avant la première apparition.
      expect(s.frame - prev).toBeGreaterThanOrEqual(60);
      expect(s.frame - prev).toBeLessThanOrEqual(120);
      expect(s.x).toBeGreaterThanOrEqual(fx(-40));
      expect(s.x).toBeLessThanOrEqual(fx(40));
      prev = s.frame;
    }
  });

  it('tire les objets selon leurs poids', () => {
    const { out } = spawns(2, 400_000, 7);
    const share = (kind: number): number => out.filter((s) => s.kind === kind).length / out.length;
    expect(out.length).toBeGreaterThan(4000);
    expect(share(K_ROCK)).toBeCloseTo(0.3, 1);
    expect(share(K_STICK)).toBeCloseTo(0.2, 1);
    expect(share(K_BOMB)).toBeCloseTo(0.14, 1);
    expect(share(K_HEAL)).toBeCloseTo(0.36, 1);
  });

  it('ne dépasse jamais le maximum d’objets présents', () => {
    const sim = createSim(itemConfig(2, { ...ITEM_TABLE, table: [{ kind: K_ROCK, weight: 1 }] }));
    const inputs = new Uint32Array(2);
    for (let f = 0; f < 3000; f++) {
      step(sim, inputs);
      let items = 0;
      for (let e = 0; e < MAX_ENTITIES; e++) if (sim.state.eKind[e] === K_ROCK) items++;
      expect(items).toBeLessThanOrEqual(3);
    }
    let free = 0;
    for (let e = 0; e < MAX_ENTITIES; e++) if (sim.state.eMode[e] === ITEM_MODE_FREE) free++;
    expect(free).toBe(3);
  });

  it('est reproductible pour une graine, différent pour une autre', () => {
    const a = spawns(2, 3000, 3).out;
    expect(spawns(2, 3000, 3).out).toEqual(a);
    expect(spawns(2, 3000, 4).out).not.toEqual(a);
  });
});
