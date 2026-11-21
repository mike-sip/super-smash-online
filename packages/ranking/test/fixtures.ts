/** Fabriques partagées par les tests : identifiants et rapports bien formés. */
import type { MatchReport, ReportedPlayer } from '../src/protocol.ts';

/** UUID v4 déterministe, à partir d'un entier. */
export function uuid(n: number): string {
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

/** Rapport valide en chacun pour soi : le joueur i finit à la place i + 1. */
export function report(players: number, extra: Partial<MatchReport> = {}): MatchReport {
  const list: ReportedPlayer[] = [];
  for (let i = 0; i < players; i++) {
    list.push({
      accountId: uuid(100 + i),
      guest: false,
      fighter: i % 2 === 0 ? 'vanguard' : 'striker',
      team: -1,
      placement: i + 1,
      kos: players - 1 - i,
      falls: i,
      leftAtFrame: null,
    });
  }
  return {
    version: 1,
    matchId: uuid(1),
    reportedAt: 1_800_000_000_000,
    endedAt: 1_800_000_000_000,
    ranked: true,
    mode: 'stock',
    teams: false,
    endFrame: 3600,
    players: list,
    ...extra,
  };
}
