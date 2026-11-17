import type { MatchResult, PlayerResult } from '@game/match-rules';
import { defaultMatchConfig } from '@game/match-rules';
import { describe, expect, it } from 'vitest';
import {
  canonicalReport,
  reportFromResult,
  validateReport,
  type MatchReport,
  type ReportedPlayer,
} from '../src/protocol.ts';
import { report, uuid } from './fixtures.ts';

function problemsOf(value: unknown): string[] {
  const result = validateReport(value);
  return result.ok ? [] : result.problems;
}

function withPlayers(
  players: Partial<ReportedPlayer>[],
  extra: Partial<MatchReport> = {},
): unknown {
  const base = report(players.length, extra);
  return { ...base, players: base.players.map((p, i) => ({ ...p, ...players[i] })) };
}

describe('validateReport', () => {
  it('accepte un rapport bien formé et le renvoie tel quel', () => {
    const value = report(4);
    const result = validateReport(value);
    expect(result).toEqual({ ok: true, report: value });
  });

  it('refuse ce qui n’est pas un objet', () => {
    for (const value of [null, undefined, 42, 'x', [], true]) {
      expect(validateReport(value).ok).toBe(false);
    }
  });

  it('refuse les champs inconnus ou manquants, à la racine comme par joueur', () => {
    expect(problemsOf({ ...report(2), extra: 1 }).join()).toMatch(/extra/);
    const missing: Record<string, unknown> = { ...report(2) };
    delete missing.ranked;
    expect(problemsOf(missing).join()).toMatch(/ranked/);
    expect(problemsOf(withPlayers([{ ...{ admin: true } } as never, {}])).join()).toMatch(/admin/);
    expect(problemsOf(JSON.parse('{"__proto__":1}')).join()).toMatch(/__proto__/);
  });

  it('exige la version 1, un UUID, des dates et une frame de fin entières', () => {
    expect(problemsOf({ ...report(2), version: 2 }).join()).toMatch(/version/);
    expect(problemsOf({ ...report(2), matchId: 'abc' }).join()).toMatch(/matchId/);
    expect(problemsOf({ ...report(2), matchId: uuid(0xabc).toUpperCase() }).join()).toMatch(
      /matchId/,
    );
    expect(problemsOf({ ...report(2), reportedAt: 1.5 }).join()).toMatch(/reportedAt/);
    expect(problemsOf({ ...report(2), endedAt: -1 }).join()).toMatch(/endedAt/);
    expect(problemsOf({ ...report(2), endFrame: '10' }).join()).toMatch(/endFrame/);
    expect(problemsOf({ ...report(2), mode: 'coins' }).join()).toMatch(/mode/);
    expect(problemsOf({ ...report(2), ranked: 'yes' }).join()).toMatch(/ranked/);
    expect(problemsOf({ ...report(2), teams: 1 }).join()).toMatch(/teams/);
  });

  it('exige de 2 à 8 joueurs aux comptes distincts', () => {
    expect(problemsOf(report(1)).join()).toMatch(/joueurs/);
    expect(problemsOf(report(9)).join()).toMatch(/joueurs/);
    expect(problemsOf({ ...report(2), players: 'x' }).join()).toMatch(/joueurs/);
    expect(
      problemsOf(withPlayers([{ accountId: uuid(50) }, { accountId: uuid(50) }])).join(),
    ).toMatch(/plusieurs fois/);
  });

  it('vérifie chaque champ d’un joueur', () => {
    const cases: [Partial<ReportedPlayer> | Record<string, unknown>, RegExp][] = [
      [{ accountId: 'nope' }, /accountId/],
      [{ guest: 'no' }, /guest/],
      [{ fighter: 'Vanguard' }, /fighter/],
      [{ fighter: '' }, /fighter/],
      [{ fighter: 'a'.repeat(33) }, /fighter/],
      [{ kos: -1 }, /kos/],
      [{ falls: 1.5 }, /falls/],
      [{ kos: 100_000 }, /kos/],
      [{ leftAtFrame: -1 }, /leftAtFrame/],
      [{ leftAtFrame: 999_999 }, /leftAtFrame/],
      [{ team: 4 }, /team/],
      [{ placement: 0 }, /placement/],
    ];
    for (const [change, pattern] of cases) {
      expect(problemsOf(withPlayers([change as Partial<ReportedPlayer>, {}])).join()).toMatch(
        pattern,
      );
    }
  });

  it('exige des places cohérentes en chacun pour soi : 1, puis le nombre de mieux classés + 1', () => {
    expect(problemsOf(withPlayers([{ placement: 1 }, { placement: 2 }, { placement: 3 }]))).toEqual(
      [],
    );
    expect(problemsOf(withPlayers([{ placement: 1 }, { placement: 1 }, { placement: 3 }]))).toEqual(
      [],
    );
    expect(problemsOf(withPlayers([{ placement: 1 }, { placement: 2 }, { placement: 2 }]))).toEqual(
      [],
    );
    expect(
      problemsOf(withPlayers([{ placement: 2 }, { placement: 2 }, { placement: 3 }])).join(),
    ).toMatch(/places/);
    expect(
      problemsOf(withPlayers([{ placement: 1 }, { placement: 1 }, { placement: 2 }])).join(),
    ).toMatch(/places/);
    expect(
      problemsOf(withPlayers([{ placement: 1 }, { placement: 3 }, { placement: 3 }])).join(),
    ).toMatch(/places/);
  });

  it('en équipes : même place pour toute l’équipe, places cohérentes entre équipes, deux équipes au moins', () => {
    const teams = { teams: true };
    const ok = withPlayers(
      [
        { team: 0, placement: 1 },
        { team: 0, placement: 1 },
        { team: 1, placement: 2 },
        { team: 1, placement: 2 },
      ],
      teams,
    );
    expect(problemsOf(ok)).toEqual([]);
    const split = withPlayers(
      [
        { team: 0, placement: 1 },
        { team: 0, placement: 2 },
        { team: 1, placement: 2 },
      ],
      teams,
    );
    expect(problemsOf(split).join()).toMatch(/équipe/);
    const gap = withPlayers(
      [
        { team: 0, placement: 1 },
        { team: 1, placement: 3 },
        { team: 1, placement: 3 },
      ],
      teams,
    );
    expect(problemsOf(gap).join()).toMatch(/places/);
    const single = withPlayers(
      [
        { team: 2, placement: 1 },
        { team: 2, placement: 1 },
      ],
      teams,
    );
    expect(problemsOf(single).join()).toMatch(/deux équipes/);
    const noTeam = withPlayers(
      [
        { team: -1, placement: 1 },
        { team: 1, placement: 2 },
      ],
      teams,
    );
    expect(problemsOf(noTeam).join()).toMatch(/team/);
  });

  it('sans équipes, le champ team est ignoré (-1 à 3 acceptés)', () => {
    expect(problemsOf(withPlayers([{ team: -1 }, { team: 3, placement: 2 }]))).toEqual([]);
  });
});

describe('reportFromResult', () => {
  function playerResult(placement: number, team: number, kos: number): PlayerResult {
    return {
      team,
      placement,
      kos,
      falls: 3 - kos,
      selfDestructs: 0,
      score: 0,
      damageDealt: 0,
      damageTaken: 0,
      stocksLeft: 0,
      ultimatesUsed: 0,
      eliminatedAt: -1,
    };
  }

  it('construit un rapport valide depuis un MatchResult', () => {
    const config = defaultMatchConfig('stock', 3);
    const result: MatchResult = {
      config,
      endFrame: 4658,
      reason: 'last-standing',
      winners: [1],
      winningTeam: null,
      players: [playerResult(2, -1, 1), playerResult(1, -1, 2), playerResult(3, -1, 0)],
    };
    const built = reportFromResult(result, {
      matchId: uuid(7),
      ranked: true,
      endedAt: 1_000,
      reportedAt: 2_000,
      players: [
        { accountId: uuid(10), guest: false, fighter: 'vanguard', leftAtFrame: null },
        { accountId: uuid(11), guest: true, fighter: 'striker', leftAtFrame: null },
        { accountId: uuid(12), guest: false, fighter: 'vanguard', leftAtFrame: 300 },
      ],
    });
    expect(validateReport(built)).toEqual({ ok: true, report: built });
    expect(built.mode).toBe('stock');
    expect(built.teams).toBe(false);
    expect(built.endFrame).toBe(4658);
    expect(built.players[1]).toEqual({
      accountId: uuid(11),
      guest: true,
      fighter: 'striker',
      team: -1,
      placement: 1,
      kos: 2,
      falls: 1,
      leftAtFrame: null,
    });
  });

  it('lève si le nombre de joueurs ne correspond pas', () => {
    const config = defaultMatchConfig('stock', 2);
    const result: MatchResult = {
      config,
      endFrame: 1,
      reason: 'last-standing',
      winners: [0],
      winningTeam: null,
      players: [playerResult(1, -1, 1), playerResult(2, -1, 0)],
    };
    expect(() =>
      reportFromResult(result, {
        matchId: uuid(1),
        ranked: true,
        endedAt: 0,
        reportedAt: 0,
        players: [],
      }),
    ).toThrow();
  });
});

describe('canonicalReport', () => {
  it('ne dépend pas de l’ordre des clés', () => {
    const a = report(3);
    // Mêmes valeurs, clés dans l'ordre inverse.
    const reverse = (o: object): object => Object.fromEntries(Object.entries(o).reverse());
    const shuffled = {
      ...reverse({ ...a, players: undefined }),
      players: a.players.map(reverse),
    } as unknown as MatchReport;
    expect(Object.keys(shuffled)[0]).not.toBe('version');
    expect(canonicalReport(shuffled)).toBe(canonicalReport(a));
    expect(canonicalReport({ ...a, ranked: !a.ranked })).not.toBe(canonicalReport(a));
    expect(canonicalReport({ ...a, reportedAt: a.reportedAt + 60_000 })).toBe(canonicalReport(a));
  });
});
