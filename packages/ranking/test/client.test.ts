import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRankingClient } from '../src/client.ts';
import type { MatchReport } from '../src/protocol.ts';
import { report } from './fixtures.ts';
import { Browser, postReport, startGameServer, type Running } from './server.ts';

/** `fetch` qui garde le cookie d'un `Browser`, comme le ferait le navigateur. */
function browserFetch(browser: Browser): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (browser.cookie !== null) headers.set('cookie', browser.cookie);
    return fetch(input, { ...init, headers });
  };
}

describe('client du classement', () => {
  let running: Running;
  let alice: Browser;
  let ids: string[];

  beforeEach(async () => {
    running = await startGameServer();
    alice = new Browser(running.origin);
    const bob = new Browser(running.origin);
    ids = [await alice.register('Alice'), await bob.register('Bob')];
    const base = report(2, { reportedAt: Date.now() });
    const r: MatchReport = {
      ...base,
      players: base.players.map((p, i) => ({ ...p, accountId: ids[i]! })),
    };
    await postReport(running.origin, r);
  });
  afterEach(async () => {
    await running.close();
  });

  it('lit le classement, le profil et l’historique', async () => {
    const client = createRankingClient({
      baseUrl: `${running.origin}/api/ranking/v1`,
      fetch: browserFetch(alice),
    });
    const board = await client.leaderboard(0, 10);
    expect(board).toEqual({ ok: true, value: { total: 0, entries: [] } });
    const me = await client.me();
    expect(me.ok && me.value.profile?.rating).toBe(1016);
    const history = await client.myMatches();
    expect(history.ok && history.value.matches).toHaveLength(1);
    const bad = await client.myMatches('zzz');
    expect(bad).toEqual({
      ok: false,
      error: { code: 'bad_request', message: 'Requête invalide.' },
    });
  });

  it('sans session : profil null, historique refusé', async () => {
    const client = createRankingClient({ baseUrl: `${running.origin}/api/ranking/v1` });
    expect(await client.me()).toEqual({ ok: true, value: { profile: null, guest: false } });
    const history = await client.myMatches();
    expect(history.ok === false && history.error.code).toBe('unauthenticated');
  });

  it('serveur éteint ou réponse non JSON : erreur network, sans exception', async () => {
    const off = createRankingClient({ baseUrl: 'http://127.0.0.1:9/api/ranking/v1' });
    expect(await off.leaderboard()).toEqual({
      ok: false,
      error: { code: 'network', message: 'Serveur du classement injoignable.' },
    });
    const html = createRankingClient({
      fetch: async () => new Response('<html>502</html>', { status: 502 }),
    });
    expect((await html.me()).ok).toBe(false);
  });
});
