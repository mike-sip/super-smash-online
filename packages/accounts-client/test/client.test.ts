/**
 * Le client contre un vrai serveur des comptes. Node n'a pas de pot à cookies : un petit
 * `fetch` enveloppé joue le rôle du navigateur, qui garde le cookie `HttpOnly` à la place du client.
 */
import { createServer, type Server } from 'node:http';
import {
  createAccountsServer,
  createMemoryStore,
  verifyTicket,
  type AccountsServer,
} from '@game/accounts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAccountsClient, type AccountsClient } from '../src/index.ts';

const SECRET = 'cle-de-ticket-pour-les-tests-du-client-01';

let server: AccountsServer;
let origin: string;

/** `fetch` qui garde les cookies comme un navigateur ; compte aussi les appels. */
function browserFetch() {
  let cookie: string | null = null;
  const state = { calls: 0 };
  const wrapped: typeof fetch = async (input, init) => {
    state.calls++;
    const headers = new Headers(init?.headers);
    if (cookie !== null) headers.set('cookie', cookie);
    const response = await fetch(origin + String(input), { ...init, headers });
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';')[0]!;
      cookie = line.includes('Max-Age=0') ? null : pair;
    }
    return response;
  };
  return { fetch: wrapped, state };
}

function client(): { api: AccountsClient; state: { calls: number } } {
  const { fetch, state } = browserFetch();
  return { api: createAccountsClient({ fetch }), state };
}

beforeAll(async () => {
  server = createAccountsServer({
    host: '127.0.0.1',
    port: 0,
    store: createMemoryStore(),
    ticketSecrets: [SECRET],
    allowedOrigins: [],
    secureCookies: false,
    trustProxy: false,
    hashing: { logN: 10, r: 8, p: 1 },
    log: () => {},
  });
  origin = `http://127.0.0.1:${(await server.listen()).port}`;
});

afterAll(async () => {
  await server.close();
});

describe('client des comptes', () => {
  let api: AccountsClient;
  beforeEach(() => {
    api = client().api;
  });

  it('suit un joueur d’invité à compte, puis à la suppression', async () => {
    expect(await api.session()).toEqual({ ok: true, value: null });

    const guest = await api.guest();
    expect(guest.ok && guest.value.guest).toBe(true);
    const id = guest.ok ? guest.value.id : '';
    expect(await api.session()).toMatchObject({ ok: true, value: { id } });

    const profile = await api.updateProfile({ favoriteFighter: 'zephyr' });
    expect(profile).toMatchObject({ ok: true, value: { favoriteFighter: 'zephyr' } });

    const converted = await api.convert('Zoë', 'tartiflette');
    expect(converted).toMatchObject({ ok: true, value: { id, pseudo: 'Zoë', guest: false } });

    const ticket = await api.ticket('relay');
    expect(ticket.ok).toBe(true);
    if (ticket.ok) {
      expect(
        verifyTicket(ticket.value.ticket, { secrets: [SECRET], audience: 'relay' }),
      ).toMatchObject({ ok: true, claims: { sub: id } });
    }

    expect(await api.logout()).toEqual({ ok: true, value: undefined });
    expect(await api.session()).toEqual({ ok: true, value: null });

    const login = await api.login('ZOE', 'tartiflette');
    expect(login).toMatchObject({ ok: true, value: { id, favoriteFighter: 'zephyr' } });

    expect(await api.changePassword('tartiflette', 'raclette-fondue')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await api.deleteAccount('raclette-fondue')).toEqual({ ok: true, value: undefined });
    expect(await api.session()).toEqual({ ok: true, value: null });
  });

  it('inscrit directement un compte, et supprime un invité sans mot de passe', async () => {
    expect(await api.register('Élodie', 'tartiflette')).toMatchObject({
      ok: true,
      value: { pseudo: 'Élodie' },
    });
    const other = client().api;
    await other.guest('Zoë');
    expect(await other.deleteAccount()).toEqual({ ok: true, value: undefined });
  });

  it('rend les erreurs du serveur avec leur message en français, sans exception', async () => {
    await api.register('Marius', 'pastis-bien-frais');
    const taken = await client().api.register('marius', 'tartiflette');
    expect(taken).toEqual({
      ok: false,
      error: { code: 'pseudo_taken', message: 'Ce pseudo est déjà pris.' },
    });
    const wrong = await client().api.login('Marius', 'mauvais');
    expect(wrong).toEqual({
      ok: false,
      error: { code: 'invalid_credentials', message: 'Pseudo ou mot de passe incorrect.' },
    });
    expect(await client().api.ticket('relay')).toMatchObject({
      ok: false,
      error: { code: 'unauthenticated' },
    });
  });

  it('vérifie pseudo et mot de passe avant d’envoyer quoi que ce soit', async () => {
    const { api: local, state } = client();
    expect(await local.register('a', 'tartiflette')).toEqual({
      ok: false,
      error: { code: 'invalid_pseudo', message: 'Le pseudo doit faire de 3 à 16 caractères.' },
    });
    expect(await local.convert('Marius', 'court')).toMatchObject({
      ok: false,
      error: { code: 'invalid_password' },
    });
    expect(await local.updateProfile({ pseudo: 'Admin' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_pseudo' },
    });
    expect(await local.guest('x')).toMatchObject({ ok: false, error: { code: 'invalid_pseudo' } });
    expect(state.calls).toBe(0);
  });

  it('donne le délai d’attente quand les tentatives sont limitées', async () => {
    const { api: spammer } = client();
    let last = await spammer.login('Inconnu', 'x');
    for (let i = 0; i < 25 && !(last.ok === false && last.error.code === 'rate_limited'); i++) {
      last = await spammer.login(`Inconnu${i}`, 'x');
    }
    expect(last).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
    expect(!last.ok && last.error.retryAfter).toBeGreaterThan(0);
  });
});

describe('client sans serveur joignable', () => {
  let html: Server;
  let htmlOrigin: string;

  beforeAll(async () => {
    // Un serveur qui répond autre chose que l'API : page d'erreur d'un proxy, par exemple.
    html = createServer((_, response) => {
      response.writeHead(502, { 'content-type': 'text/html' }).end('<h1>Bad Gateway</h1>');
    });
    await new Promise<void>((resolve) => html.listen(0, '127.0.0.1', resolve));
    const address = html.address();
    htmlOrigin = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => html.close(() => resolve()));
  });

  it('rend une erreur « network » quand le serveur est éteint', async () => {
    const api = createAccountsClient({ baseUrl: 'http://127.0.0.1:1/api/accounts/v1' });
    const result = await api.session();
    expect(result).toEqual({
      ok: false,
      error: { code: 'network', message: 'Serveur des comptes injoignable.' },
    });
    expect(await api.guest()).toMatchObject({ ok: false, error: { code: 'network' } });
  });

  it('rend une erreur « network » quand la réponse n’est pas celle de l’API', async () => {
    const api = createAccountsClient({ baseUrl: `${htmlOrigin}/api/accounts/v1` });
    expect(await api.session()).toEqual({
      ok: false,
      error: { code: 'network', message: 'Serveur des comptes injoignable.' },
    });
  });
});
