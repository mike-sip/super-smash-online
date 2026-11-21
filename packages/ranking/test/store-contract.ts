/**
 * Suite de contrat de `RankingStore`, jouée sur chaque implémentation. Un nouveau stockage n'est
 * accepté que s'il la passe entière.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MatchExistsError,
  type MatchRecord,
  type ParticipantRecord,
  type RankingStore,
} from '../src/store.ts';
import { uuid } from './fixtures.ts';

const T0 = Date.UTC(2026, 10, 15);

export function participant(
  slot: number,
  accountId: string | null,
  overrides: Partial<ParticipantRecord> = {},
): ParticipantRecord {
  return {
    slot,
    accountId,
    guest: false,
    fighter: 'vanguard',
    team: -1,
    placement: slot + 1,
    effectivePlacement: slot + 1,
    kos: 1,
    falls: 2,
    leftAtFrame: null,
    won: slot === 0,
    ratingBefore: null,
    ratingAfter: null,
    delta: null,
    synced: false,
    ...overrides,
  };
}

export function match(
  n: number,
  participants: readonly ParticipantRecord[],
  overrides: Partial<MatchRecord> = {},
): MatchRecord {
  return {
    matchId: uuid(n),
    fingerprint: `empreinte-${n}`,
    ranked: participants.some((p) => p.delta !== null),
    requestedRanked: true,
    mode: 'stock',
    teams: false,
    endFrame: 3600,
    endedAt: T0 + n * 60_000,
    recordedAt: T0 + n * 60_000 + 5,
    units: participants.length,
    participants,
    ...overrides,
  };
}

/** Match classé à deux : `winner` passe de `wr` à `wr + d`, `loser` de `lr` à `lr - d`. */
export function rankedDuel(
  n: number,
  winner: string,
  loser: string,
  wr = 1000,
  lr = 1000,
  d = 16,
): MatchRecord {
  return match(n, [
    participant(0, winner, { ratingBefore: wr, ratingAfter: wr + d, delta: d, kos: 3, falls: 0 }),
    participant(1, loser, {
      ratingBefore: lr,
      ratingAfter: lr - d,
      delta: -d,
      kos: 0,
      falls: 3,
      fighter: 'striker',
    }),
  ]);
}

export function storeContract(name: string, open: () => Promise<RankingStore>): void {
  describe(`contrat du stockage : ${name}`, () => {
    let store: RankingStore;
    beforeEach(async () => {
      store = await open();
    });
    afterEach(async () => {
      await store.close();
    });

    const A = uuid(0xa);
    const B = uuid(0xb);
    const C = uuid(0xc);

    it('enregistre un match et le relit à l’identique', async () => {
      const m = rankedDuel(1, A, B);
      await store.recordMatch(m);
      expect(await store.findMatch(m.matchId)).toEqual(m);
      expect(await store.findMatch(uuid(999))).toBeNull();
    });

    it('refuse un match déjà enregistré, sans rien modifier', async () => {
      const m = rankedDuel(1, A, B);
      await store.recordMatch(m);
      await expect(store.recordMatch({ ...m, fingerprint: 'autre' })).rejects.toBeInstanceOf(
        MatchExistsError,
      );
      expect((await store.findMatch(m.matchId))?.fingerprint).toBe(m.fingerprint);
      expect((await store.findPlayer(A))?.matchesPlayed).toBe(1);
    });

    it('tient les compteurs, la cote et la meilleure cote', async () => {
      await store.recordMatch(rankedDuel(1, A, B));
      await store.recordMatch(rankedDuel(2, B, A, 984, 1016, 20));
      expect(await store.findPlayer(A)).toEqual({
        accountId: A,
        rating: 996,
        peakRating: 1016,
        rankedMatches: 2,
        matchesPlayed: 2,
        wins: 1,
        kos: 3,
        falls: 3,
      });
      expect(await store.findPlayer(B)).toMatchObject({ rating: 1004, peakRating: 1004, wins: 1 });
      expect(await store.findPlayer(C)).toBeNull();
      expect(await store.ratings([A, B, C])).toEqual(
        new Map([
          [A, 996],
          [B, 1004],
        ]),
      );
    });

    it('un match non classé compte dans les statistiques, pas dans la cote', async () => {
      await store.recordMatch(match(1, [participant(0, A), participant(1, B, { guest: true })]));
      expect(await store.findPlayer(A)).toEqual({
        accountId: A,
        rating: null,
        peakRating: null,
        rankedMatches: 0,
        matchesPlayed: 1,
        wins: 1,
        kos: 1,
        falls: 2,
      });
      expect((await store.ratings([A, B])).size).toBe(0);
      // Puis un match classé : la cote apparaît.
      await store.recordMatch(rankedDuel(2, A, C));
      expect((await store.findPlayer(A))?.rating).toBe(1016);
    });

    it('statistiques par personnage', async () => {
      await store.recordMatch(rankedDuel(1, A, B));
      await store.recordMatch(
        match(2, [
          participant(0, B, { fighter: 'striker' }),
          participant(1, A, { fighter: 'zoner' }),
        ]),
      );
      await store.recordMatch(match(3, [participant(0, A), participant(1, B)]));
      expect(await store.fighterStats(A)).toEqual([
        { fighter: 'vanguard', played: 2, wins: 2 },
        { fighter: 'zoner', played: 1, wins: 0 },
      ]);
      expect(await store.fighterStats(B)).toEqual([
        { fighter: 'striker', played: 2, wins: 1 },
        { fighter: 'vanguard', played: 1, wins: 0 },
      ]);
      expect(await store.fighterStats(C)).toEqual([]);
    });

    it('classement : seuil de matchs, ordre, rang olympique, pagination', async () => {
      const ids = [1, 2, 3, 4, 5].map((i) => uuid(0x100 + i));
      // ids[0] et ids[1] : 2 matchs classés ; ids[2] : 1 seul.
      await store.recordMatch(rankedDuel(1, ids[0]!, ids[2]!, 1000, 1000, 10));
      await store.recordMatch(rankedDuel(2, ids[1]!, ids[3]!, 1000, 1000, 10));
      await store.recordMatch(rankedDuel(3, ids[0]!, ids[3]!, 1010, 990, 5));
      await store.recordMatch(rankedDuel(4, ids[1]!, ids[4]!, 1010, 1000, 5));
      // Cotes : ids[0] 1015 (2), ids[1] 1015 (2), ids[2] 990 (1), ids[3] 985 (2), ids[4] 995 (1)
      const board = await store.leaderboard(0, 10, 2);
      expect(board.total).toBe(3);
      expect(board.rows).toEqual([
        { rank: 1, accountId: ids[0], rating: 1015, rankedMatches: 2, wins: 2 },
        { rank: 1, accountId: ids[1], rating: 1015, rankedMatches: 2, wins: 2 },
        { rank: 3, accountId: ids[3], rating: 985, rankedMatches: 2, wins: 0 },
      ]);
      expect((await store.leaderboard(1, 1, 2)).rows.map((r) => r.accountId)).toEqual([ids[1]]);
      expect((await store.leaderboard(5, 10, 2)).rows).toEqual([]);
      expect((await store.leaderboard(0, 10, 1)).total).toBe(5);
      expect(await store.rankOf(ids[3]!, 2)).toBe(3);
      expect(await store.rankOf(ids[2]!, 2)).toBeNull();
      expect(await store.rankOf(ids[2]!, 1)).toBe(4);
      expect(await store.rankOf(uuid(0xfff), 1)).toBeNull();
    });

    it('à cote égale, plus de matchs classés passe devant', async () => {
      await store.recordMatch(rankedDuel(1, A, B, 1000, 1000, 10));
      await store.recordMatch(rankedDuel(2, C, B, 1000, 990, 5));
      await store.recordMatch(rankedDuel(3, C, B, 1005, 985, 5));
      // A : 1010 (1 match) ; C : 1010 (2 matchs).
      const rows = (await store.leaderboard(0, 10, 1)).rows;
      expect(rows.slice(0, 2).map((r) => [r.accountId, r.rank])).toEqual([
        [C, 1],
        [A, 1],
      ]);
    });

    it('historique : du plus récent au plus ancien, par curseur', async () => {
      for (let n = 1; n <= 5; n++) await store.recordMatch(rankedDuel(n, A, n % 2 ? B : C));
      // Deux matchs à la même date : départagés par identifiant décroissant.
      await store.recordMatch({ ...rankedDuel(6, A, B), endedAt: T0 + 5 * 60_000 });
      const first = await store.history(A, null, 3);
      expect(first.map((m) => m.matchId)).toEqual([uuid(6), uuid(5), uuid(4)]);
      const last = first.at(-1)!;
      const second = await store.history(A, { endedAt: last.endedAt, matchId: last.matchId }, 3);
      expect(second.map((m) => m.matchId)).toEqual([uuid(3), uuid(2), uuid(1)]);
      expect(await store.history(A, { endedAt: T0, matchId: uuid(0) }, 3)).toEqual([]);
      const ofC = await store.history(C, null, 10);
      expect(ofC.map((m) => m.matchId)).toEqual([uuid(4), uuid(2)]);
      expect(ofC[0]).toEqual(await store.findMatch(uuid(4)));
    });

    it('participations à synchroniser', async () => {
      await store.recordMatch(rankedDuel(1, A, B));
      await store.recordMatch(match(2, [participant(0, C), participant(1, A, { synced: true })]));
      const pending = await store.unsynced(10);
      expect(pending).toEqual([
        { matchId: uuid(1), slot: 0, accountId: A, won: true },
        { matchId: uuid(1), slot: 1, accountId: B, won: false },
        { matchId: uuid(2), slot: 0, accountId: C, won: true },
      ]);
      expect(await store.unsynced(1)).toHaveLength(1);
      await store.markSynced(uuid(1), 1);
      expect((await store.unsynced(10)).map((u) => u.accountId)).toEqual([A, C]);
      expect((await store.findMatch(uuid(1)))?.participants[1]?.synced).toBe(true);
    });

    it('suppression d’un compte : données effacées, participations anonymisées', async () => {
      await store.recordMatch(rankedDuel(1, A, B));
      expect(await store.deleteAccount(A)).toBe(true);
      expect(await store.findPlayer(A)).toBeNull();
      expect(await store.fighterStats(A)).toEqual([]);
      expect(await store.history(A, null, 10)).toEqual([]);
      expect(await store.rankOf(A, 1)).toBeNull();
      const kept = await store.findMatch(uuid(1));
      expect(kept?.participants[0]).toMatchObject({ accountId: null, delta: 16, synced: true });
      expect(kept?.participants[1]?.accountId).toBe(B);
      expect((await store.unsynced(10)).map((u) => u.accountId)).toEqual([B]);
      expect(await store.findPlayer(B)).not.toBeNull();
      expect(await store.deleteAccount(A)).toBe(false);
    });

    it('comptes connus', async () => {
      expect(await store.knownAccounts()).toEqual([]);
      await store.recordMatch(rankedDuel(1, A, B));
      expect((await store.knownAccounts()).sort()).toEqual([A, B].sort());
      await store.deleteAccount(A);
      expect(await store.knownAccounts()).toEqual([B]);
    });

    it('une participation sans compte (déjà supprimé) ne crée pas de joueur', async () => {
      await store.recordMatch(match(1, [participant(0, A), participant(1, null)]));
      expect(await store.knownAccounts()).toEqual([A]);
      expect(await store.unsynced(10)).toEqual([
        { matchId: uuid(1), slot: 0, accountId: A, won: true },
      ]);
    });
  });
}
