import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateReport } from '../src/protocol.ts';
import { SEED_PSEUDOS, randomReport, seedMatches } from '../src/seed.ts';
import { uuid } from './fixtures.ts';
import { Browser, REPORT_SECRET, startGameServer, type Running } from './server.ts';

describe('données de démonstration', () => {
  it('les rapports inventés sont toujours valides', () => {
    let state = 1;
    const next = (): number => (state = (state * 48271) % 2147483647) / 2147483647;
    const pool = Array.from({ length: 8 }, (_, i) => uuid(i + 1));
    for (let i = 0; i < 500; i++) {
      const r = randomReport(next, pool, i % 2 ? uuid(99) : null, 1_000 + i, 2_000);
      expect(validateReport(r)).toEqual({ ok: true, report: r });
      if (i % 2) expect(r.players[0]!.accountId).toBe(uuid(99));
    }
  });

  describe('contre un vrai serveur', () => {
    let running: Running;
    beforeEach(async () => {
      running = await startGameServer();
    });
    afterEach(async () => {
      await running.close();
    });

    it('crée les comptes, envoie les matchs, et peut inclure un compte donné', async () => {
      const me = new Browser(running.origin);
      const myId = await me.register('Testeur');
      const first = await seedMatches({
        baseUrl: running.origin,
        secret: REPORT_SECRET,
        count: 12,
        with: myId,
        seed: 3,
      });
      expect(first.sent).toBe(12);
      expect(first.accounts).toHaveLength(SEED_PSEUDOS.length);
      // Une seconde fois : les comptes existent déjà, on s'y reconnecte.
      const second = await seedMatches({
        baseUrl: running.origin,
        secret: REPORT_SECRET,
        count: 3,
        seed: 4,
      });
      expect(second.accounts).toEqual(first.accounts);
      const history = await me.send('GET', '/api/ranking/v1/me/matches?limit=50');
      expect(history.body.matches).toHaveLength(12);
    });
  });
});
