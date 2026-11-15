/** Stockage en mémoire : tests, et secours si SQLite n'est pas disponible. */
import {
  MatchExistsError,
  type FighterRecord,
  type HistoryCursor,
  type LeaderboardRow,
  type MatchRecord,
  type ParticipantRecord,
  type PlayerRecord,
  type RankingStore,
  type UnsyncedParticipation,
} from './store.ts';

type MutablePlayer = {
  -readonly [K in keyof PlayerRecord]: PlayerRecord[K];
};

/** Ordre du classement : cote décroissante, matchs classés décroissants, identifiant. */
function compareBoard(a: PlayerRecord, b: PlayerRecord): number {
  if (a.rating !== b.rating) return b.rating! - a.rating!;
  if (a.rankedMatches !== b.rankedMatches) return b.rankedMatches - a.rankedMatches;
  return a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0;
}

/** Ordre de l'historique : fin décroissante, puis identifiant décroissant. */
function newerFirst(a: MatchRecord, b: MatchRecord): number {
  if (a.endedAt !== b.endedAt) return b.endedAt - a.endedAt;
  return a.matchId < b.matchId ? 1 : a.matchId > b.matchId ? -1 : 0;
}

function isOlder(m: MatchRecord, cursor: HistoryCursor): boolean {
  return m.endedAt < cursor.endedAt || (m.endedAt === cursor.endedAt && m.matchId < cursor.matchId);
}

export function createMemoryRankingStore(): RankingStore {
  const matches = new Map<string, MatchRecord>();
  /** Ordre d'enregistrement, pour `unsynced`. */
  const order: string[] = [];
  const players = new Map<string, MutablePlayer>();
  const fighters = new Map<string, Map<string, { played: number; wins: number }>>();

  const copy = (m: MatchRecord): MatchRecord => structuredClone(m);

  function eligible(minMatches: number): PlayerRecord[] {
    return [...players.values()]
      .filter((p) => p.rating !== null && p.rankedMatches >= minMatches)
      .sort(compareBoard);
  }

  function apply(p: ParticipantRecord): void {
    if (p.accountId === null) return;
    const player = players.get(p.accountId) ?? {
      accountId: p.accountId,
      rating: null,
      peakRating: null,
      rankedMatches: 0,
      matchesPlayed: 0,
      wins: 0,
      kos: 0,
      falls: 0,
    };
    player.matchesPlayed += 1;
    if (p.won) player.wins += 1;
    player.kos += p.kos;
    player.falls += p.falls;
    if (p.ratingAfter !== null) {
      player.rating = p.ratingAfter;
      player.peakRating = Math.max(player.peakRating ?? p.ratingAfter, p.ratingAfter);
      player.rankedMatches += 1;
    }
    players.set(p.accountId, player);
    const byFighter = fighters.get(p.accountId) ?? new Map();
    const stats = byFighter.get(p.fighter) ?? { played: 0, wins: 0 };
    stats.played += 1;
    if (p.won) stats.wins += 1;
    byFighter.set(p.fighter, stats);
    fighters.set(p.accountId, byFighter);
  }

  return {
    async recordMatch(match) {
      if (matches.has(match.matchId)) throw new MatchExistsError();
      matches.set(match.matchId, copy(match));
      order.push(match.matchId);
      for (const p of match.participants) apply(p);
    },

    async findMatch(matchId) {
      const m = matches.get(matchId);
      return m === undefined ? null : copy(m);
    },

    async ratings(accountIds) {
      const result = new Map<string, number>();
      for (const id of accountIds) {
        const rating = players.get(id)?.rating;
        if (rating !== undefined && rating !== null) result.set(id, rating);
      }
      return result;
    },

    async findPlayer(accountId) {
      const p = players.get(accountId);
      return p === undefined ? null : { ...p };
    },

    async fighterStats(accountId) {
      const byFighter = fighters.get(accountId);
      if (byFighter === undefined) return [];
      const list: FighterRecord[] = [...byFighter].map(([fighter, s]) => ({ fighter, ...s }));
      return list.sort((a, b) =>
        a.played !== b.played ? b.played - a.played : a.fighter < b.fighter ? -1 : 1,
      );
    },

    async leaderboard(offset, limit, minMatches) {
      const list = eligible(minMatches);
      const rows: LeaderboardRow[] = list.slice(offset, offset + limit).map((p) => ({
        rank: 1 + list.filter((o) => o.rating! > p.rating!).length,
        accountId: p.accountId,
        rating: p.rating!,
        rankedMatches: p.rankedMatches,
        wins: p.wins,
      }));
      return { total: list.length, rows };
    },

    async rankOf(accountId, minMatches) {
      const list = eligible(minMatches);
      const me = list.find((p) => p.accountId === accountId);
      if (me === undefined) return null;
      return 1 + list.filter((o) => o.rating! > me.rating!).length;
    },

    async history(accountId, before, limit) {
      return [...matches.values()]
        .filter((m) => m.participants.some((p) => p.accountId === accountId))
        .filter((m) => before === null || isOlder(m, before))
        .sort(newerFirst)
        .slice(0, limit)
        .map(copy);
    },

    async unsynced(limit) {
      const result: UnsyncedParticipation[] = [];
      for (const id of order) {
        for (const p of matches.get(id)!.participants) {
          if (p.synced || p.accountId === null) continue;
          if (result.length >= limit) return result;
          result.push({ matchId: id, slot: p.slot, accountId: p.accountId, won: p.won });
        }
      }
      return result;
    },

    async markSynced(matchId, slot) {
      const m = matches.get(matchId);
      if (m === undefined) return;
      matches.set(matchId, {
        ...m,
        participants: m.participants.map((p) => (p.slot === slot ? { ...p, synced: true } : p)),
      });
    },

    async deleteAccount(accountId) {
      let found = players.delete(accountId);
      fighters.delete(accountId);
      for (const [id, m] of matches) {
        if (!m.participants.some((p) => p.accountId === accountId)) continue;
        found = true;
        matches.set(id, {
          ...m,
          participants: m.participants.map((p) =>
            p.accountId === accountId ? { ...p, accountId: null, synced: true } : p,
          ),
        });
      }
      return found;
    },

    async knownAccounts() {
      const ids = new Set(players.keys());
      for (const m of matches.values()) {
        for (const p of m.participants) if (p.accountId !== null) ids.add(p.accountId);
      }
      return [...ids];
    },

    async close() {},
  };
}
