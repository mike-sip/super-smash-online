import { describe, expect, it } from 'vitest';
import { createMatchmaker } from '../src/matchmaking.ts';

const SETTINGS = { regions: ['eu'], groupSize: 4, minPlayers: 2, maxWaitMs: 20_000, maxRttMs: 250 };

const ids = (groups: { id: string }[][]) => groups.map((g) => g.map((e) => e.id));

describe('file d’attente', () => {
  it('forme un groupe de 4 tout de suite, dans l’ordre d’arrivée', () => {
    const mm = createMatchmaker(SETTINGS);
    for (const id of ['a', 'b', 'c', 'd', 'e'])
      expect(mm.join(id, 'eu', 'vif', 30, 0).ok).toBe(true);
    expect(ids(mm.poll(0))).toEqual([['a', 'b', 'c', 'd']]);
    expect(mm.waiting('eu')).toBe(1);
    expect(mm.entry('e')).toMatchObject({ fighter: 'vif', region: 'eu' });
  });

  it('après 20 s, part avec tous ceux qui attendent s’ils sont au moins 2', () => {
    const mm = createMatchmaker(SETTINGS);
    mm.join('a', 'eu', 'vif', null, 0);
    expect(mm.poll(25_000)).toEqual([]);
    mm.join('b', 'eu', 'lourd', null, 10_000);
    mm.join('c', 'eu', 'lourd', null, 15_000);
    expect(mm.poll(19_999)).toEqual([]);
    expect(ids(mm.poll(20_000))).toEqual([['a', 'b', 'c']]);
    expect(mm.waiting('eu')).toBe(0);
  });

  it('refuse une région inconnue et un aller-retour trop long', () => {
    const mm = createMatchmaker(SETTINGS);
    expect(mm.join('a', 'na', 'vif', 30, 0)).toMatchObject({ ok: false, code: 'invalid_region' });
    expect(mm.join('a', 'eu', 'vif', 251, 0)).toMatchObject({ ok: false, code: 'high_latency' });
    expect(mm.join('a', 'eu', 'vif', 250, 0).ok).toBe(true);
  });

  it('sortie de file ; une seconde entrée remplace la première', () => {
    const mm = createMatchmaker(SETTINGS);
    mm.join('a', 'eu', 'vif', null, 0);
    mm.join('a', 'eu', 'lourd', null, 5);
    expect(mm.waiting('eu')).toBe(1);
    expect(mm.entry('a')).toMatchObject({ fighter: 'lourd', since: 5 });
    expect(mm.leave('a')).toBe(true);
    expect(mm.leave('a')).toBe(false);
    expect(mm.waiting('eu')).toBe(0);
  });

  it('régions indépendantes', () => {
    const mm = createMatchmaker({ ...SETTINGS, regions: ['eu', 'na'] });
    mm.join('a', 'eu', 'vif', null, 0);
    mm.join('b', 'na', 'vif', null, 0);
    expect(mm.poll(30_000)).toEqual([]);
  });
});
