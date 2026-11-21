/**
 * Protections HTTP, de bout en bout : un test par protection de la spec.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryStore } from '../src/store-memory.ts';
import type { AccountStore } from '../src/store.ts';
import { Agent, startServer, type Running } from './helpers.ts';

let running: Running | undefined;

async function start(overrides?: Parameters<typeof startServer>[0]): Promise<Running> {
  running = await startServer(overrides);
  return running;
}

afterEach(async () => {
  await running?.close();
  running = undefined;
});

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-resource-policy': 'same-origin',
};

describe('protections HTTP', () => {
  it('exige du JSON pour toute requête qui modifie quelque chose', async () => {
    const { api } = await start();
    const browser = new Agent(api);
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
      const reply = await browser.post('/guest', 'pseudo=Zoe', { 'content-type': type });
      expect(reply.status, type).toBe(415);
      expect(reply.body.error.code).toBe('unsupported_media_type');
    }
    // Sans corps ni type du tout.
    expect((await browser.send('POST', '/guest')).status).toBe(415);
    // Le paramètre charset est permis.
    const ok = await browser.post(
      '/guest',
      {},
      { 'content-type': 'application/json; charset=utf-8' },
    );
    expect(ok.status).toBe(201);
  });

  it('refuse une requête venue d’une autre origine', async () => {
    const { api, origin } = await start({ allowedOrigins: ['https://jeu.example'] });
    const browser = new Agent(api);
    const foreign = await browser.post('/guest', {}, { origin: 'https://malveillant.example' });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe('forbidden_origin');
    // Même origine que le serveur (cas du proxy inverse) ou origine autorisée : acceptées.
    expect((await browser.post('/guest', {}, { origin })).status).toBe(201);
    expect((await browser.post('/guest', {}, { origin: 'https://jeu.example' })).status).toBe(201);
    // « null » (page en sandbox, fichier local) n'est pas une origine autorisée.
    expect((await browser.post('/guest', {}, { origin: 'null' })).status).toBe(403);
  });

  it('refuse une requête que le navigateur déclare intersite', async () => {
    const { api } = await start();
    const reply = await new Agent(api).post('/guest', {}, { 'sec-fetch-site': 'cross-site' });
    expect(reply.status).toBe(403);
    expect(reply.body.error.code).toBe('forbidden_origin');
    expect(
      (await new Agent(api).post('/guest', {}, { 'sec-fetch-site': 'same-origin' })).status,
    ).toBe(201);
  });

  it('refuse un corps de plus de 8 Ko', async () => {
    const { api } = await start();
    const reply = await new Agent(api).post('/guest', { pseudo: 'x'.repeat(9000) });
    expect(reply.status).toBe(413);
    expect(reply.body.error.code).toBe('payload_too_large');
  });

  it('refuse un JSON invalide, autre chose qu’un objet, ou des champs inattendus', async () => {
    const { api } = await start();
    const browser = new Agent(api);
    for (const body of ['{pas du json', '[]', 'null', '"texte"', '42']) {
      const reply = await browser.post('/guest', body);
      expect(reply.status, body).toBe(400);
      expect(reply.body.error.code).toBe('bad_request');
    }
    const extra = await browser.post('/register', {
      pseudo: 'Élodie',
      password: 'tartiflette',
      admin: true,
    });
    expect(extra.status).toBe(400);
    expect(extra.body.error.code).toBe('bad_request');
    // Un champ du mauvais type est refusé par la règle qui le concerne.
    const typed = await browser.post('/register', { pseudo: 42, password: 'tartiflette' });
    expect(typed.status).toBe(400);
    expect(typed.body.error.code).toBe('invalid_pseudo');
  });

  it('envoie les en-têtes de sécurité sur toutes les réponses, et aucun en-tête CORS', async () => {
    const { api } = await start();
    const browser = new Agent(api);
    const replies = [
      await browser.get('/session'),
      await browser.post('/guest'),
      await browser.get('/inconnue'),
      await browser.post('/guest', 'mauvais'),
    ];
    for (const reply of replies) {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(reply.headers.get(name), name).toBe(value);
      }
      expect(reply.headers.get('access-control-allow-origin')).toBeNull();
      expect(reply.headers.get('content-type')).toMatch(/^application\/json; charset=utf-8$|^$/);
    }
  });

  it('répond 404 à une adresse inconnue et 405 à une méthode non prévue', async () => {
    const { api, origin } = await start();
    const browser = new Agent(api);
    const unknown = await browser.get('/admin');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('not_found');
    expect((await fetch(`${origin}/`)).status).toBe(404);
    const wrong = await browser.send('DELETE', '/session');
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toBe('GET');
    expect(wrong.body.error.code).toBe('method_not_allowed');
  });

  it('limite les tentatives et annonce le délai par Retry-After', async () => {
    const { api } = await start();
    const browser = new Agent(api);
    for (let i = 0; i < 20; i++) {
      expect((await browser.post('/login', { pseudo: `Joueur${i}`, password: 'x' })).status).toBe(
        401,
      );
    }
    const refused = await browser.post('/login', { pseudo: 'Encore', password: 'x' });
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe('rate_limited');
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('ignore X-Forwarded-For sauf derrière un proxy de confiance', async () => {
    const { api } = await start();
    const browser = new Agent(api);
    // Changer d'adresse annoncée ne contourne pas la limite.
    for (let i = 0; i < 20; i++) {
      await browser.post(
        '/login',
        { pseudo: `J${i}x`, password: 'x' },
        { 'x-forwarded-for': `10.0.0.${i}` },
      );
    }
    const spoofed = await browser.post(
      '/login',
      { pseudo: 'Encore', password: 'x' },
      { 'x-forwarded-for': '10.9.9.9' },
    );
    expect(spoofed.status).toBe(429);
  });

  it('lit la dernière adresse de X-Forwarded-For derrière un proxy de confiance', async () => {
    const { api } = await start({ trustProxy: true });
    const browser = new Agent(api);
    // Le client peut écrire ce qu'il veut en tête de liste ; le proxy ajoute la vraie adresse à la fin.
    for (let i = 0; i < 20; i++) {
      await browser.post(
        '/login',
        { pseudo: `J${i}x`, password: 'x' },
        { 'x-forwarded-for': `1.2.3.${i}, 203.0.113.5` },
      );
    }
    const same = await browser.post(
      '/login',
      { pseudo: 'Encore', password: 'x' },
      { 'x-forwarded-for': '9.9.9.9, 203.0.113.5' },
    );
    expect(same.status).toBe(429);
    const other = await browser.post(
      '/login',
      { pseudo: 'Encore', password: 'x' },
      { 'x-forwarded-for': '203.0.113.6' },
    );
    expect(other.status).toBe(401);
  });

  it('donne exactement la même réponse pour un pseudo inconnu et un mauvais mot de passe', async () => {
    const { api } = await start();
    const browser = new Agent(api);
    await browser.post('/register', { pseudo: 'Élodie', password: 'tartiflette' });
    const unknown = await new Agent(api).post('/login', {
      pseudo: 'Personne',
      password: 'x-y-z-w',
    });
    const wrong = await new Agent(api).post('/login', { pseudo: 'Élodie', password: 'x-y-z-w' });
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.text).toBe(wrong.text);
  });

  it('ignore sans erreur un cookie forgé', async () => {
    const { api } = await start();
    for (const cookie of [
      'sid=',
      'sid=abc',
      `sid=${'A'.repeat(43)}`,
      'sid=%00%ff',
      'autre=1; sid',
    ]) {
      const browser = new Agent(api);
      browser.cookie = cookie;
      const reply = await browser.get('/session');
      expect(reply.status, cookie).toBe(200);
      expect(reply.body).toEqual({ account: null });
    }
  });

  it('cache le détail d’une erreur interne', async () => {
    const failing: AccountStore = {
      ...createMemoryStore(),
      findSession: () => Promise.reject(new Error('disque plein : /var/lib/secret')),
    };
    const { api, logs } = await start({ store: failing });
    const browser = new Agent(api);
    browser.cookie = `sid=${'A'.repeat(43)}`;
    const reply = await browser.get('/session');
    expect(reply.status).toBe(500);
    expect(reply.body).toEqual({
      error: { code: 'internal', message: 'Erreur interne du serveur.' },
    });
    expect(reply.text).not.toContain('disque');
    expect(logs.some((line) => line.includes('GET /session 500'))).toBe(true);
  });

  it('n’écrit ni pseudo, ni mot de passe, ni jeton, ni adresse dans le journal', async () => {
    const { api, logs } = await start();
    const browser = new Agent(api);
    await browser.post('/register', { pseudo: 'Élodie', password: 'tartiflette' });
    await browser.post('/login', { pseudo: 'Élodie', password: 'mauvais-mot' });
    await browser.get('/session?pseudo=Élodie');
    const token = browser.cookie!.split('=')[1]!;
    expect(logs.length).toBeGreaterThanOrEqual(3);
    const all = logs.join('\n');
    for (const secret of ['Élodie', 'tartiflette', 'mauvais-mot', token, '127.0.0.1']) {
      expect(all).not.toContain(secret);
    }
    expect(logs[0]).toMatch(/^POST \/register 201 \d+ ms$/);
  });
});
