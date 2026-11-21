import { defaultMatchConfig } from '@game/match-rules';
import { describe, expect, it } from 'vitest';
import type { DeclaredResult } from '../src/protocol.ts';
import { buildRecord, createTracker, declare, settle } from '../src/results.ts';

function playerResult(placement: number, team = 0) {
  return {
    team,
    placement,
    kos: 2 - placement,
    falls: placement - 1,
    selfDestructs: 0,
    score: 3 - 2 * placement,
    damageDealt: 100,
    damageTaken: 80,
    stocksLeft: 2 - placement,
    ultimatesUsed: 0,
    eliminatedAt: placement === 1 ? -1 : 1500,
  };
}

const RESULT: DeclaredResult = {
  endFrame: 1600,
  reason: 'last-standing',
  winners: [0],
  winningTeam: null,
  players: [playerResult(1), playerResult(2), playerResult(3)],
};

function tracker(kind: 'private' | 'quick' = 'private') {
  return createTracker({
    matchId: '11111111-2222-4333-8444-555555555555',
    gameId: 'g1',
    kind,
    region: 'eu',
    config: defaultMatchConfig('stock', 3),
    stage: 'arene',
    startedAt: 1000,
    players: ['a', 'b', 'c'].map((id) => ({ id, name: id, guest: id === 'c', fighter: 'vif' })),
  });
}

describe('concordance des résultats', () => {
  it('unanime : accepté une fois toutes les déclarations arrivées', () => {
    const t = tracker();
    expect(declare(t, 'a', RESULT, 10)).toEqual({ ok: true });
    expect(settle(t, 11, 15_000)).toBeNull();
    declare(t, 'b', structuredClone(RESULT), 12);
    expect(settle(t, 13, 15_000)).toBeNull();
    declare(t, 'c', structuredClone(RESULT), 14);
    expect(settle(t, 15, 15_000)).toEqual({ status: 'agreed', result: RESULT });
  });

  it('désaccord : contesté sans attendre', () => {
    const t = tracker();
    declare(t, 'a', RESULT, 10);
    declare(t, 'b', { ...RESULT, winners: [1] }, 11);
    expect(settle(t, 12, 15_000)).toMatchObject({ status: 'contested' });
  });

  it('désynchronisation signalée par le relais : contesté', () => {
    const t = tracker();
    for (const id of ['a', 'b', 'c']) declare(t, id, RESULT, 10);
    t.desynced = true;
    expect(settle(t, 11, 15_000)).toMatchObject({ status: 'contested' });
  });

  it('un joueur parti du relais n’est pas attendu ; sa déclaration éventuelle compte', () => {
    const t = tracker();
    t.leftAt[2] = 900;
    declare(t, 'a', RESULT, 10);
    declare(t, 'b', RESULT, 11);
    expect(settle(t, 12, 15_000)).toMatchObject({ status: 'agreed' });
    const u = tracker();
    u.leftAt[2] = 900;
    declare(u, 'c', { ...RESULT, winners: [2] }, 5);
    declare(u, 'a', RESULT, 10);
    declare(u, 'b', RESULT, 11);
    expect(settle(u, 12, 15_000)).toMatchObject({ status: 'contested' });
  });

  it('déclarations manquantes 15 s après la première : contesté', () => {
    const t = tracker();
    declare(t, 'a', RESULT, 10);
    expect(settle(t, 15_009, 15_000)).toBeNull();
    expect(settle(t, 15_010, 15_000)).toMatchObject({ status: 'contested' });
  });

  it('refuse un intrus, un doublon, un nombre de places ou des équipes incohérents', () => {
    const t = tracker();
    expect(declare(t, 'eve', RESULT, 1)).toMatchObject({ code: 'not_in_match' });
    declare(t, 'a', RESULT, 1);
    expect(declare(t, 'a', RESULT, 2)).toMatchObject({ code: 'bad_request' });
    const two = { ...RESULT, players: RESULT.players.slice(0, 2) };
    expect(declare(t, 'b', two, 2)).toMatchObject({ code: 'bad_request' });
    const teams = createTracker({
      ...tracker(),
      config: { ...defaultMatchConfig('stock', 3), teams: true },
      players: tracker().players,
    });
    const wrongTeams = {
      ...RESULT,
      players: [playerResult(1, 3), playerResult(2), playerResult(3)],
    };
    expect(declare(teams, 'a', wrongTeams, 1)).toMatchObject({ code: 'bad_request' });
  });
});

describe('enregistrement pour le classement', () => {
  it('résultat accepté : places, résultats, départs', () => {
    const t = tracker('quick');
    t.leftAt[1] = 700;
    const record = buildRecord(t, 'agreed', RESULT, 9000);
    expect(record).toMatchObject({
      matchId: '11111111-2222-4333-8444-555555555555',
      ranked: true,
      kind: 'quick',
      region: 'eu',
      status: 'agreed',
      endFrame: 1600,
      winners: [0],
      startedAt: 1000,
      endedAt: 9000,
    });
    expect(record.players.map((p) => [p.accountId, p.leftAtFrame, p.result?.placement])).toEqual([
      ['a', null, 1],
      ['b', 700, 2],
      ['c', null, 3],
    ]);
    expect(record.players[2]!.guest).toBe(true);
  });

  it('contesté ou abandonné : aucun résultat transmis, salon privé non classé', () => {
    const record = buildRecord(tracker(), 'contested', RESULT, 9000);
    expect(record.ranked).toBe(false);
    expect(record.winners).toEqual([]);
    expect(record.endFrame).toBeNull();
    expect(record.players.every((p) => p.result === null)).toBe(true);
  });
});
