/**
 * Parcours de bout en bout : un vrai serveur HTTP, de vraies requêtes, un cookie gardé entre
 * elles. Chaque parcours de la spec y passe.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyTicket } from '../src/ticket.ts';
import { Agent, TEST_SECRET, startServer, type Running } from './helpers.ts';

let running: Running;

beforeEach(async () => {
  running = await startServer();
});

afterEach(async () => {
  await running.close();
});

describe('API des comptes, de bout en bout', () => {
  it('répond à la sonde de santé', async () => {
    expect((await new Agent(running.api).get('/health')).body).toEqual({ ok: true });
  });

  it('répond 200 avec un compte nul quand il n’y a pas de session', async () => {
    const reply = await new Agent(running.api).get('/session');
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ account: null });
  });

  it('mène un joueur d’invité à compte, puis à la suppression', async () => {
    const browser = new Agent(running.api);

    // Invité : une requête, un cookie, un pseudo.
    const guest = await browser.post('/guest');
    expect(guest.status).toBe(201);
    expect(guest.body.account).toMatchObject({ guest: true, favoriteFighter: null });
    expect(guest.body.account.pseudo).toMatch(/^Invité-\d{5}$/);
    const [cookie] = browser.setCookies;
    expect(cookie).toMatch(
      /^sid=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000$/,
    );
    const id = guest.body.account.id as string;

    // Rechargement de la page : la session est toujours là.
    expect((await browser.get('/session')).body.account.id).toBe(id);

    // Profil de l'invité.
    const profile = await browser.patch('/profile', { favoriteFighter: 'zephyr' });
    expect(profile.status).toBe(200);
    expect(profile.body.account.favoriteFighter).toBe('zephyr');

    // Conversion : même identifiant, profil gardé, nouveau cookie.
    const oldCookie = browser.cookie;
    const converted = await browser.post('/convert', { pseudo: 'Zoë', password: 'tartiflette' });
    expect(converted.status).toBe(200);
    expect(converted.body.account).toMatchObject({
      id,
      pseudo: 'Zoë',
      guest: false,
      favoriteFighter: 'zephyr',
    });
    expect(browser.cookie).not.toBe(oldCookie);
    const stale = new Agent(running.api);
    stale.cookie = oldCookie;
    expect((await stale.get('/session')).body).toEqual({ account: null });

    // Déconnexion : cookie effacé, session morte.
    const sessionCookie = browser.cookie;
    const logout = await browser.post('/logout');
    expect(logout.status).toBe(204);
    expect(browser.setCookies[0]).toMatch(/^sid=; Path=\/; HttpOnly; SameSite=Strict; Max-Age=0$/);
    expect((await browser.get('/session')).body).toEqual({ account: null });
    const replay = new Agent(running.api);
    replay.cookie = sessionCookie;
    expect((await replay.get('/session')).body).toEqual({ account: null });

    // Connexion depuis un autre navigateur.
    const other = new Agent(running.api);
    const login = await other.post('/login', { pseudo: 'ZOE', password: 'tartiflette' });
    expect(login.status).toBe(200);
    expect(login.body.account).toMatchObject({ id, favoriteFighter: 'zephyr' });
    await browser.post('/login', { pseudo: 'Zoë', password: 'tartiflette' });

    // Changement de mot de passe : l'autre navigateur est déconnecté.
    const change = await browser.post('/password', {
      current: 'tartiflette',
      next: 'raclette-fondue',
    });
    expect(change.status).toBe(204);
    expect((await other.get('/session')).body).toEqual({ account: null });
    expect((await browser.get('/session')).body.account.id).toBe(id);

    // Ticket pour le relais, vérifié comme le relais le fera.
    const issued = await browser.post('/tickets', { audience: 'relay' });
    expect(issued.status).toBe(200);
    const verified = verifyTicket(issued.body.ticket, {
      secrets: [TEST_SECRET],
      audience: 'relay',
    });
    expect(verified).toMatchObject({ ok: true, claims: { sub: id, name: 'Zoë', guest: false } });
    expect(issued.body.expiresAt).toBe(verified.ok ? verified.claims.exp : -1);
    expect(verifyTicket(issued.body.ticket, { secrets: [TEST_SECRET], audience: 'lobby' })).toEqual(
      { ok: false, error: 'wrong_audience' },
    );

    // Suppression : tout disparaît, le pseudo est libre.
    const deleted = await browser.post('/delete', { password: 'raclette-fondue' });
    expect(deleted.status).toBe(204);
    expect(browser.cookie).toBeNull();
    expect((await browser.get('/session')).body).toEqual({ account: null });
    const gone = await other.post('/login', { pseudo: 'Zoë', password: 'raclette-fondue' });
    expect(gone.status).toBe(401);
    expect(gone.body).toEqual({
      error: { code: 'invalid_credentials', message: 'Pseudo ou mot de passe incorrect.' },
    });
    expect((await other.post('/register', { pseudo: 'zoe', password: 'tartiflette' })).status).toBe(
      201,
    );
  });

  it('inscrit directement un compte', async () => {
    const browser = new Agent(running.api);
    const reply = await browser.post('/register', { pseudo: 'Élodie', password: 'tartiflette' });
    expect(reply.status).toBe(201);
    expect(reply.body.account).toMatchObject({ pseudo: 'Élodie', guest: false });
    expect((await browser.get('/session')).body.account.pseudo).toBe('Élodie');
  });

  it('donne la raison d’un refus d’inscription', async () => {
    const browser = new Agent(running.api);
    const invalid = await browser.post('/register', { pseudo: 'a', password: 'tartiflette' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toEqual({
      code: 'invalid_pseudo',
      message: 'Le pseudo doit faire de 3 à 16 caractères.',
    });
    await browser.post('/register', { pseudo: 'Élodie', password: 'tartiflette' });
    const taken = await new Agent(running.api).post('/register', {
      pseudo: 'ELODIE',
      password: 'tartiflette',
    });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('pseudo_taken');
    const weak = await new Agent(running.api).post('/register', {
      pseudo: 'Marius',
      password: 'password',
    });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('invalid_password');
  });

  it('supprime un invité sans mot de passe', async () => {
    const browser = new Agent(running.api);
    await browser.post('/guest', { pseudo: 'Zoë' });
    expect((await browser.post('/delete')).status).toBe(204);
    expect((await browser.get('/session')).body).toEqual({ account: null });
  });

  it('refuse les routes protégées sans session', async () => {
    const browser = new Agent(running.api);
    for (const [method, path, body] of [
      ['POST', '/convert', { pseudo: 'Zoë', password: 'tartiflette' }],
      ['PATCH', '/profile', { favoriteFighter: 'x' }],
      ['POST', '/password', { current: 'a', next: 'b' }],
      ['POST', '/delete', {}],
      ['POST', '/tickets', { audience: 'relay' }],
    ] as const) {
      const reply = await browser.send(method, path, body);
      expect(reply.status, path).toBe(401);
      expect(reply.body.error.code, path).toBe('unauthenticated');
    }
  });

  it('accepte une déconnexion sans session, sans effet', async () => {
    expect((await new Agent(running.api).post('/logout')).status).toBe(204);
  });

  it('ne renvoie jamais d’empreinte ni de jeton dans un corps de réponse', async () => {
    const browser = new Agent(running.api);
    const replies = [
      await browser.post('/register', { pseudo: 'Élodie', password: 'tartiflette' }),
      await browser.get('/session'),
      await browser.patch('/profile', { favoriteFighter: 'vanguard' }),
      await browser.post('/login', { pseudo: 'Élodie', password: 'tartiflette' }),
    ];
    const token = browser.cookie!.split('=')[1]!;
    for (const reply of replies) {
      expect(reply.text).not.toContain('scrypt');
      expect(reply.text).not.toContain('tartiflette');
      expect(reply.text).not.toContain(token);
      expect(Object.keys(reply.body.account).sort()).toEqual([
        'createdAt',
        'favoriteFighter',
        'guest',
        'id',
        'pseudo',
        'stats',
      ]);
    }
  });
});

describe('cookies', () => {
  it('sont Secure et préfixés __Host- en production', async () => {
    const secure = await startServer({ secureCookies: true });
    const browser = new Agent(secure.api);
    await browser.post('/guest');
    expect(browser.setCookies[0]).toMatch(
      /^__Host-sid=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Secure; Max-Age=2592000$/,
    );
    // Le cookie de développement n'est pas lu en production.
    const dev = new Agent(secure.api);
    dev.cookie = browser.cookie!.replace('__Host-sid', 'sid');
    expect((await dev.get('/session')).body).toEqual({ account: null });
    expect((await browser.get('/session')).body.account).not.toBeNull();
    await secure.close();
  });

  it('sont renvoyés avec une nouvelle durée quand la session est prolongée', async () => {
    let now = Date.UTC(2026, 10, 14);
    const timed = await startServer({ now: () => now });
    const browser = new Agent(timed.api);
    await browser.post('/guest');
    const first = browser.cookie;
    now += 10 * 60_000;
    await browser.get('/session');
    expect(browser.setCookies).toEqual([]);
    now += 2 * 3_600_000;
    await browser.get('/session');
    expect(browser.setCookies).toHaveLength(1);
    expect(browser.setCookies[0]).toContain('Max-Age=2592000');
    // Même jeton, durée renouvelée.
    expect(browser.cookie).toBe(first);
    await timed.close();
  });
});
