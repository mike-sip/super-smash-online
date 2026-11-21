import { beforeEach, describe, expect, it } from 'vitest';
import type { MatchReport, ReportedPlayer } from '../src/protocol.ts';
import { LEADERBOARD_MIN_MATCHES, RankingService } from '../src/service.ts';
import { createMemoryRankingStore } from '../src/store-memory.ts';
import type { RankingStore } from '../src/store.ts';
import { report, uuid } from './fixtures.ts';
import { FakeAccounts } from './helpers.ts';

const NOW = 1_800_000_000_000;

/** Les 8 joueurs de `report()` : uuid(100) à uuid(107). */
const P = Array.from({ length: 8 }, (_, i) => uuid(100 + i));

function withPlayers(
  n: number,
  changes: Partial<ReportedPlayer>[],
  extra: Partial<MatchReport> = {},
) {
  const base = report(n, extra);
  return { ...base, players: base.players.map((p, i) => ({ ...p, ...changes[i] })) };
}

describe('RankingService', () => {
  let store: RankingStore;
  let accounts: FakeAccounts;
  let service: RankingService;

  beforeEach(() => {
    store = createMemoryRankingStore();
    accounts = new FakeAccounts();
    P.forEach((id, i) => accounts.add(id, `Joueur${i}`));
    service = new RankingService({ store, accounts, now: () => NOW });
  });

  describe('soumission', () => {
    it('enregistre un match classé et renvoie les variations', async () => {
      const outcome = await service.submit(report(2));
      expect(outcome).toEqual({
        ok: true,
        created: true,
        value: {
          status: 'recorded',
          ranked: true,
          changes: [
            { accountId: P[0], before: 1000, after: 1016, delta: 16 },
            { accountId: P[1], before: 1000, after: 984, delta: -16 },
          ],
        },
      });
      expect(await service.getRating(P[0]!)).toBe(1016);
      expect(await service.getRating(P[2]!)).toBeNull();
    });

    it('refuse un rapport invalide avec la liste des problèmes', async () => {
      const outcome = await service.submit({ ...report(2), version: 2 });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toBe('invalid_report');
        expect(outcome.problems?.join()).toMatch(/version/);
      }
    });

    it('le même rapport deux fois ne compte qu’une fois, même renvoyé plus tard', async () => {
      const first = await service.submit(report(2));
      const again = await service.submit({ ...report(2), reportedAt: NOW + 120_000 });
      expect(again).toEqual({
        ok: true,
        created: false,
        value: { ...(first.ok ? first.value : {}), status: 'duplicate' },
      });
      expect(await service.getRating(P[0]!)).toBe(1016);
      expect((await store.findPlayer(P[0]!))?.matchesPlayed).toBe(1);
    });

    it('soumissions simultanées du même match : une seule prise en compte', async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () => service.submit(report(3))));
      expect(results.filter((r) => r.ok && r.created)).toHaveLength(1);
      expect(results.every((r) => r.ok)).toBe(true);
      expect((await store.findPlayer(P[0]!))?.matchesPlayed).toBe(1);
      expect(accounts.recorded.filter((r) => r.id === P[0])).toHaveLength(1);
    });

    it('un contenu différent sous le même identifiant est un conflit, sans effet', async () => {
      await service.submit(report(2));
      const outcome = await service.submit(withPlayers(2, [{ placement: 2 }, { placement: 1 }]));
      expect(outcome).toEqual({ ok: false, error: 'conflict' });
      expect(await service.getRating(P[0]!)).toBe(1016);
    });

    it('les matchs successifs partent des cotes à jour', async () => {
      await service.submit(report(2));
      await service.submit({ ...report(2), matchId: uuid(2) });
      expect(await service.getRating(P[0]!)).toBe(1031);
    });

    it('salon privé : historique et statistiques, aucune cote', async () => {
      const outcome = await service.submit(report(2, { ranked: false }));
      expect(outcome.ok && outcome.value).toEqual({
        status: 'recorded',
        ranked: false,
        changes: [],
      });
      expect(await service.getRating(P[0]!)).toBeNull();
      expect((await store.findPlayer(P[0]!))?.wins).toBe(1);
    });

    it('les invités sont retirés du calcul ; un invité selon les comptes l’est même si le rapport dit non', async () => {
      accounts.add(P[1]!, 'Invité-1', true);
      const outcome = await service.submit(withPlayers(3, [{}, { guest: false }, {}]));
      expect(outcome.ok && outcome.value.changes.map((c) => [c.accountId, c.delta])).toEqual([
        [P[0], 16],
        [P[2], -16],
      ]);
      const guestPart = (await store.findMatch(uuid(1)))?.participants[1];
      expect(guestPart).toMatchObject({ guest: true, delta: null, accountId: P[1] });
      expect((await store.findPlayer(P[1]!))?.matchesPlayed).toBe(1);
    });

    it('un compte inconnu des comptes est traité comme un invité, sans données gardées', async () => {
      accounts.forget(P[1]!);
      await service.submit(report(3));
      const part = (await store.findMatch(uuid(1)))?.participants[1];
      expect(part).toMatchObject({ accountId: null, guest: true, delta: null });
      expect(await store.findPlayer(P[1]!)).toBeNull();
    });

    it('un seul inscrit : match non classé', async () => {
      accounts.add(P[1]!, 'Invité', true);
      const outcome = await service.submit(withPlayers(2, [{}, { guest: true }]));
      expect(outcome.ok && outcome.value.ranked).toBe(false);
    });

    it('abandon : classé dernier, place effective et victoire en conséquence', async () => {
      await service.submit(withPlayers(3, [{ leftAtFrame: 100 }, {}, {}]));
      const m = (await store.findMatch(uuid(1)))!;
      expect(m.participants.map((p) => [p.effectivePlacement, p.won, p.delta])).toEqual([
        [3, false, -16],
        [1, true, 16],
        [2, false, 0],
      ]);
      expect(m.units).toBe(3);
    });

    it('en équipes, les membres de l’équipe gagnante ont une victoire', async () => {
      await service.submit(
        withPlayers(
          4,
          [
            { team: 0, placement: 1 },
            { team: 0, placement: 1 },
            { team: 1, placement: 2 },
            { team: 1, placement: 2 },
          ],
          { teams: true },
        ),
      );
      const m = (await store.findMatch(uuid(1)))!;
      expect(m.participants.map((p) => p.won)).toEqual([true, true, false, false]);
      expect(m.units).toBe(2);
    });
  });

  describe('compteurs des comptes', () => {
    it('mis à jour après l’enregistrement, et marqués synchronisés', async () => {
      await service.submit(report(2));
      expect(accounts.recorded).toEqual([
        { id: P[0], won: true },
        { id: P[1], won: false },
      ]);
      expect(await store.unsynced(10)).toEqual([]);
    });

    it('une panne des comptes n’empêche pas l’enregistrement ; la reprise rattrape', async () => {
      accounts.failRecords = 1;
      const outcome = await service.submit(report(2));
      expect(outcome.ok && outcome.created).toBe(true);
      expect(accounts.recorded).toEqual([{ id: P[1], won: false }]);
      expect(await store.unsynced(10)).toHaveLength(1);
      expect(await service.syncPending()).toBe(1);
      expect(accounts.recorded).toContainEqual({ id: P[0], won: true });
      expect(await store.unsynced(10)).toEqual([]);
      expect(await service.syncPending()).toBe(0);
    });

    it('un compte disparu entre-temps est marqué synchronisé sans erreur', async () => {
      await store.recordMatch({
        matchId: uuid(9),
        fingerprint: 'x',
        ranked: false,
        requestedRanked: false,
        mode: 'stock',
        teams: false,
        endFrame: 1,
        endedAt: NOW,
        recordedAt: NOW,
        units: 2,
        participants: [
          {
            slot: 0,
            accountId: uuid(0xeee),
            guest: false,
            fighter: 'vanguard',
            team: -1,
            placement: 1,
            effectivePlacement: 1,
            kos: 0,
            falls: 0,
            leftAtFrame: null,
            won: true,
            ratingBefore: null,
            ratingAfter: null,
            delta: null,
            synced: false,
          },
        ],
      });
      expect(await service.syncPending()).toBe(1);
      expect(await store.unsynced(10)).toEqual([]);
    });
  });

  describe('lectures', () => {
    async function play(n: number, order: number[]): Promise<void> {
      // order : indices de P dans l'ordre d'arrivée.
      const base = report(order.length, { matchId: uuid(1000 + n), endedAt: NOW + n * 1000 });
      await service.submit({
        ...base,
        players: order.map((who, place) => ({ ...base.players[place]!, accountId: P[who]! })),
      });
    }

    it('classement : seuil de 5 matchs classés, pseudos actuels', async () => {
      expect(LEADERBOARD_MIN_MATCHES).toBe(5);
      for (let n = 0; n < 5; n++) await play(n, [0, 1, 2]);
      await play(5, [3, 0]);
      accounts.add(P[0]!, 'Renommé');
      const board = await service.leaderboard(0, 10);
      expect(board.total).toBe(3);
      expect(board.entries.map((e) => [e.rank, e.pseudo])).toEqual([
        [1, 'Renommé'],
        [2, 'Joueur1'],
        [3, 'Joueur2'],
      ]);
      expect(board.entries[0]).toMatchObject({ rankedMatches: 6, wins: 5 });
    });

    it('classement : bornes de pagination', async () => {
      for (let n = 0; n < 5; n++) await play(n, [0, 1]);
      expect((await service.leaderboard(0, 1)).entries).toHaveLength(1);
      expect((await service.leaderboard(-5, 1000)).entries).toHaveLength(2);
    });

    it('profil : cote, provisoire, rang, statistiques par personnage', async () => {
      for (let n = 0; n < 5; n++) await play(n, [0, 1]);
      await play(5, [1, 0]);
      const profile = await service.profile(P[0]!);
      expect(profile).toMatchObject({
        provisional: false,
        rank: 1,
        rankedMatches: 6,
        matchesPlayed: 6,
        wins: 5,
      });
      expect(profile.rating).toBeGreaterThan(1000);
      expect(profile.peakRating).toBeGreaterThanOrEqual(profile.rating!);
      expect(profile.fighters).toEqual([
        { fighter: 'vanguard', played: 5, wins: 5 },
        { fighter: 'striker', played: 1, wins: 0 },
      ]);
      const fresh = await service.profile(uuid(0x777));
      expect(fresh).toEqual({
        rating: null,
        provisional: true,
        rank: null,
        peakRating: null,
        rankedMatches: 0,
        matchesPlayed: 0,
        wins: 0,
        kos: 0,
        falls: 0,
        fighters: [],
      });
    });

    it('historique : entrées complètes, noms, curseur', async () => {
      accounts.add(P[2]!, 'Invité-9', true);
      for (let n = 0; n < 3; n++) await play(n, [0, 1, 2]);
      await accounts.delete(P[1]!);
      const page = await service.history(P[0]!, undefined, 2);
      expect(page.ok).toBe(true);
      if (!page.ok) return;
      expect(page.value.matches).toHaveLength(2);
      const [latest] = page.value.matches;
      expect(latest).toMatchObject({
        matchId: uuid(1002),
        endedAt: new Date(NOW + 2000).toISOString(),
        mode: 'stock',
        teams: false,
        ranked: true,
        placement: 1,
        units: 3,
        fighter: 'vanguard',
        left: false,
      });
      expect(latest!.delta).toBeGreaterThan(0);
      expect(latest!.players).toEqual([
        {
          name: 'Joueur0',
          kind: 'account',
          fighter: 'vanguard',
          placement: 1,
          team: -1,
          left: false,
        },
        {
          name: 'Joueur supprimé',
          kind: 'deleted',
          fighter: 'striker',
          placement: 2,
          team: -1,
          left: false,
        },
        {
          name: 'Invité-9',
          kind: 'guest',
          fighter: 'vanguard',
          placement: 3,
          team: -1,
          left: false,
        },
      ]);
      expect(page.value.next).not.toBeNull();
      const rest = await service.history(P[0]!, page.value.next!, 2);
      expect(rest.ok && rest.value.matches.map((m) => m.matchId)).toEqual([uuid(1000)]);
      expect(rest.ok && rest.value.next).toBeNull();
    });

    it('historique : curseur mal formé refusé', async () => {
      for (const cursor of ['x', '12.abc', '-1.' + uuid(1), '1.' + uuid(1) + 'x', '']) {
        expect((await service.history(P[0]!, cursor)).ok).toBe(false);
      }
    });
  });

  describe('suppression', () => {
    it('à la suppression d’un compte, ses données partent et il est anonymisé chez les autres', async () => {
      const detach = service.attach();
      await service.submit(report(2));
      await accounts.delete(P[0]!);
      expect(await store.findPlayer(P[0]!)).toBeNull();
      expect((await store.findMatch(uuid(1)))?.participants[0]?.accountId).toBeNull();
      expect(await service.getRating(P[1]!)).toBe(984);
      detach();
    });

    it('le balayage efface les comptes disparus sans prévenir (invités purgés)', async () => {
      await service.submit(report(3));
      accounts.forget(P[2]!);
      expect(await service.sweep()).toBe(1);
      expect(await store.findPlayer(P[2]!)).toBeNull();
      expect(await store.knownAccounts()).not.toContain(P[2]);
      expect(await service.sweep()).toBe(0);
    });
  });
});
