import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MatchReport } from '../src/protocol.ts';
import { signReport } from '../src/report.ts';
import { report, uuid } from './fixtures.ts';
import { Browser, REPORT_SECRET, postReport, startGameServer, type Running } from './server.ts';

let running: Running;
let alice: Browser;
let bob: Browser;
let ids: string[];

/** Rapport entre des comptes réels, daté de maintenant. */
function realReport(players: string[], extra: Partial<MatchReport> = {}): MatchReport {
  const base = report(players.length, { reportedAt: Date.now(), endedAt: Date.now(), ...extra });
  return { ...base, players: base.players.map((p, i) => ({ ...p, accountId: players[i]! })) };
}

beforeEach(async () => {
  running = await startGameServer();
  alice = new Browser(running.origin);
  bob = new Browser(running.origin);
  ids = [await alice.register('Alice'), await bob.register('Bob')];
});

afterEach(async () => {
  await running.close();
});

describe('soumission d’un rapport', () => {
  it('un rapport signé est enregistré (201), le même renvoyé est un doublon (200)', async () => {
    const r = realReport(ids);
    const first = await postReport(running.origin, r);
    expect(first.status).toBe(201);
    expect(first.body).toEqual({
      status: 'recorded',
      ranked: true,
      changes: [
        { accountId: ids[0], before: 1000, after: 1016, delta: 16 },
        { accountId: ids[1], before: 1000, after: 984, delta: -16 },
      ],
    });
    const again = await postReport(running.origin, { ...r, reportedAt: Date.now() + 1000 });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ ...first.body, status: 'duplicate' });
    expect(await running.server.ranking.getRating(ids[0]!)).toBe(1016);
  });

  it('les compteurs du profil des comptes sont mis à jour', async () => {
    await postReport(running.origin, realReport(ids));
    const session = await alice.send('GET', '/api/accounts/v1/session');
    expect(session.body.account.stats).toEqual({ matchesPlayed: 1, wins: 1 });
  });

  it('soumissions simultanées : une seule prise en compte', async () => {
    const r = realReport(ids);
    const replies = await Promise.all(
      Array.from({ length: 6 }, () => postReport(running.origin, r)),
    );
    expect(replies.map((x) => x.status).sort()).toEqual([200, 200, 200, 200, 200, 201]);
    const session = await alice.send('GET', '/api/accounts/v1/session');
    expect(session.body.account.stats.matchesPlayed).toBe(1);
  });

  it('même identifiant, autre contenu : 409', async () => {
    const r = realReport(ids);
    await postReport(running.origin, r);
    const other = { ...r, players: r.players.map((p) => ({ ...p, placement: 3 - p.placement })) };
    const reply = await postReport(running.origin, other);
    expect(reply.status).toBe(409);
    expect(reply.body.error.code).toBe('conflict');
  });

  it('sans signature, mal signé, autre clé, corps modifié : 401', async () => {
    const r = realReport(ids);
    const body = JSON.stringify(r);
    const unsigned = await fetch(`${running.origin}/api/ranking/v1/matches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(unsigned.status).toBe(401);
    expect(unsigned.headers.get('www-authenticate')).toBe('Report');
    const wrongKey = await postReport(running.origin, r, {
      secret: 'une-autre-cle-assez-longue-0000000000',
    });
    expect(wrongKey.status).toBe(401);
    const tampered = await postReport(running.origin, r, {
      raw: body.replace('"placement":2', '"placement":1'),
      headers: { authorization: signReport(body, REPORT_SECRET) },
    });
    expect(tampered.status).toBe(401);
    expect(tampered.body.error.code).toBe('bad_signature');
    expect(await running.server.ranking.getRating(ids[0]!)).toBeNull();
  });

  it('venu d’un navigateur (Origin ou Sec-Fetch-Site) : 403, même bien signé', async () => {
    const r = realReport(ids);
    expect(
      (await postReport(running.origin, r, { headers: { origin: running.origin } })).status,
    ).toBe(403);
    expect(
      (await postReport(running.origin, r, { headers: { 'sec-fetch-site': 'same-origin' } }))
        .status,
    ).toBe(403);
  });

  it('un client connecté ne peut pas soumettre avec son cookie', async () => {
    const reply = await alice.send('POST', '/api/ranking/v1/matches', realReport(ids));
    expect(reply.status).toBe(401);
    expect(await running.server.ranking.getRating(ids[0]!)).toBeNull();
  });

  it('rapport trop ancien ou daté dans le futur : 400 stale_report', async () => {
    const old = await postReport(
      running.origin,
      realReport(ids, { reportedAt: Date.now() - 6 * 60_000 }),
    );
    expect(old.status).toBe(400);
    expect(old.body.error.code).toBe('stale_report');
    const future = await postReport(
      running.origin,
      realReport(ids, { reportedAt: Date.now() + 6 * 60_000 }),
    );
    expect(future.body.error.code).toBe('stale_report');
  });

  it('rapport invalide : 400 avec la liste des problèmes ; JSON invalide : 400', async () => {
    const bad = await postReport(running.origin, { ...realReport(ids), mode: 'coins' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('invalid_report');
    expect(bad.body.error.problems.join()).toMatch(/mode/);
    const notJson = await postReport(running.origin, null, { raw: '{oups' });
    expect(notJson.status).toBe(400);
    expect(notJson.body.error.code).toBe('bad_request');
  });

  it('type de contenu et taille du corps bornés', async () => {
    const body = JSON.stringify(realReport(ids));
    const form = await fetch(`${running.origin}/api/ranking/v1/matches`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', authorization: signReport(body, REPORT_SECRET) },
      body,
    });
    expect(form.status).toBe(415);
    const huge = 'x'.repeat(40 * 1024);
    const big = await postReport(running.origin, null, { raw: huge });
    expect(big.status).toBe(413);
  });

  it('soumission en mémoire par un module du même processus', async () => {
    const outcome = await running.server.ranking.submitMatch(realReport(ids));
    expect(outcome.ok && outcome.created).toBe(true);
  });
});

describe('lectures', () => {
  it('classement public, avec pseudos, après 5 matchs classés', async () => {
    for (let n = 0; n < 5; n++) {
      expect(
        (await postReport(running.origin, realReport(ids, { matchId: uuid(50 + n) }))).status,
      ).toBe(201);
    }
    const anonymous = new Browser(running.origin);
    const board = await anonymous.send('GET', '/api/ranking/v1/leaderboard?limit=10');
    expect(board.status).toBe(200);
    expect(board.body.total).toBe(2);
    expect(
      board.body.entries.map((e: { pseudo: string; rank: number }) => [e.rank, e.pseudo]),
    ).toEqual([
      [1, 'Alice'],
      [2, 'Bob'],
    ]);
    expect(board.headers.get('cache-control')).toBe('no-store');
    expect((await anonymous.send('GET', '/api/ranking/v1/leaderboard?offset=-1')).status).toBe(400);
  });

  it('/me : profil avec session, null sans', async () => {
    await postReport(running.origin, realReport(ids));
    const me = await alice.send('GET', '/api/ranking/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.guest).toBe(false);
    expect(me.body.profile).toMatchObject({
      rating: 1016,
      provisional: true,
      rankedMatches: 1,
      wins: 1,
    });
    const nobody = await new Browser(running.origin).send('GET', '/api/ranking/v1/me');
    expect(nobody).toMatchObject({ status: 200, body: { profile: null, guest: false } });
  });

  it('/me pour un invité : statistiques sans cote', async () => {
    const visitor = new Browser(running.origin);
    const guestId = await visitor.guest('Passant');
    await postReport(running.origin, realReport([ids[0]!, guestId, ids[1]!]));
    const me = await visitor.send('GET', '/api/ranking/v1/me');
    expect(me.body.guest).toBe(true);
    expect(me.body.profile).toMatchObject({ rating: null, matchesPlayed: 1 });
    expect(await running.server.ranking.getRating(ids[0]!)).toBe(1016);
  });

  it('/me/matches : historique avec session, 401 sans, curseur', async () => {
    for (let n = 0; n < 3; n++) {
      await postReport(
        running.origin,
        realReport(ids, { matchId: uuid(70 + n), endedAt: Date.now() + n }),
      );
    }
    const page = await alice.send('GET', '/api/ranking/v1/me/matches?limit=2');
    expect(page.status).toBe(200);
    expect(page.body.matches).toHaveLength(2);
    expect(page.body.matches[0].players.map((p: { name: string }) => p.name)).toEqual([
      'Alice',
      'Bob',
    ]);
    const rest = await alice.send(
      'GET',
      `/api/ranking/v1/me/matches?before=${encodeURIComponent(page.body.next)}`,
    );
    expect(rest.body.matches).toHaveLength(1);
    expect(rest.body.next).toBeNull();
    expect((await alice.send('GET', '/api/ranking/v1/me/matches?before=zzz')).status).toBe(400);
    const nobody = await new Browser(running.origin).send('GET', '/api/ranking/v1/me/matches');
    expect(nobody.status).toBe(401);
  });

  it('routes et méthodes inconnues', async () => {
    expect((await alice.send('GET', '/api/ranking/v1/nope')).status).toBe(404);
    const wrong = await alice.send('DELETE', '/api/ranking/v1/leaderboard');
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toBe('GET');
    expect((await alice.send('GET', '/api/ranking/v1/matches')).status).toBe(405);
  });

  it('le journal ne contient que méthode, route connue, statut et durée', async () => {
    await alice.send('GET', '/api/ranking/v1/me/matches?before=Alice');
    await alice.send('GET', '/api/ranking/v1/Alice');
    const lines = running.logs.filter((l) => l.includes('/api/ranking'));
    expect(lines.at(-2)).toMatch(/^GET \/api\/ranking\/v1\/me\/matches 400 \d+ ms$/);
    expect(lines.at(-1)).toMatch(/^GET \/api\/ranking\/v1\? 404 \d+ ms$/);
    expect(running.logs.join('\n')).not.toMatch(/Alice|Bob/);
  });
});

describe('suppression d’un compte', () => {
  it('efface ses données de classement et l’anonymise chez les autres', async () => {
    await postReport(running.origin, realReport(ids));
    const removed = await alice.send('POST', '/api/accounts/v1/delete', {
      password: 'mot-de-passe-solide',
    });
    expect(removed.status).toBe(204);
    expect(await running.server.ranking.getRating(ids[0]!)).toBeNull();
    const history = await bob.send('GET', '/api/ranking/v1/me/matches');
    expect(
      history.body.matches[0].players.map((p: { name: string; kind: string }) => [p.name, p.kind]),
    ).toEqual([
      ['Joueur supprimé', 'deleted'],
      ['Bob', 'account'],
    ]);
    expect(await running.server.ranking.getRating(ids[1]!)).toBe(984);
  });
});
