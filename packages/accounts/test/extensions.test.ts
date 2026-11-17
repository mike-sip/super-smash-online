/**
 * Points d'extension pour les modules hébergés dans le même processus (`ranking`) : routes HTTP
 * sous un autre préfixe, et pseudos actuels pour l'affichage. Ajouts facultatifs : sans eux, le
 * serveur se comporte exactement comme avant (le reste de la suite le vérifie).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { HttpExtension } from '../src/index.ts';
import { Agent, startServer, type Running } from './helpers.ts';

let running: Running | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

/** Extension d'essai : renvoie ce qu'elle voit de la requête. */
function echo(calls: string[] = []): HttpExtension {
  return {
    prefix: '/api/echo/v1',
    async handle(request, response, context) {
      const path = new URL(request.url ?? '/', 'http://x').pathname;
      calls.push(`${request.method} ${path}`);
      if (path.endsWith('/boom')) throw new Error('panne de l’extension');
      const auth = await context.auth();
      for (const [name, value] of Object.entries(context.securityHeaders)) {
        response.setHeader(name, value);
      }
      const body = JSON.stringify({
        path,
        auth,
        sameOrigin: context.originAllowed(),
        hasAddress: context.address.length > 0,
      });
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(body);
      return path.endsWith('/me') ? '/me' : '/autre';
    },
  };
}

describe('extensions HTTP', () => {
  it('reçoivent les requêtes de leur préfixe, et seulement celles-là', async () => {
    const calls: string[] = [];
    running = await startServer({ extensions: [echo(calls)] });
    const agent = new Agent(running.origin);
    expect((await agent.get('/api/echo/v1/me')).body.path).toBe('/api/echo/v1/me');
    expect((await agent.get('/api/echo/v1')).status).toBe(200);
    // Un préfixe ressemblant n'est pas le sien.
    expect((await agent.get('/api/echo/v10/me')).status).toBe(404);
    expect((await agent.get('/api/echoes')).status).toBe(404);
    expect(calls).toEqual(['GET /api/echo/v1/me', 'GET /api/echo/v1']);
    // Les routes des comptes restent intactes.
    expect((await agent.get('/api/accounts/v1/health')).body).toEqual({ ok: true });
  });

  it('voient la session du cookie, ou null', async () => {
    running = await startServer({ extensions: [echo()] });
    const agent = new Agent(running.origin);
    expect((await agent.get('/api/echo/v1/me')).body.auth).toBeNull();
    const guest = await agent.post('/api/accounts/v1/guest', { pseudo: 'Visiteur' });
    expect(guest.status).toBe(201);
    const seen = (await agent.get('/api/echo/v1/me')).body;
    expect(seen.auth).toEqual({ accountId: guest.body.account.id, guest: true });
    expect(seen.hasAddress).toBe(true);
  });

  it('peuvent appliquer la règle d’origine des comptes', async () => {
    running = await startServer({ extensions: [echo()], allowedOrigins: ['https://jeu.example'] });
    const agent = new Agent(running.origin);
    expect((await agent.get('/api/echo/v1/me')).body.sameOrigin).toBe(true);
    const own = await agent.get('/api/echo/v1/me', { origin: running.origin });
    expect(own.body.sameOrigin).toBe(true);
    const listed = await agent.get('/api/echo/v1/me', { origin: 'https://jeu.example' });
    expect(listed.body.sameOrigin).toBe(true);
    const foreign = await agent.get('/api/echo/v1/me', { origin: 'https://ailleurs.example' });
    expect(foreign.body.sameOrigin).toBe(false);
    const cross = await agent.get('/api/echo/v1/me', { 'sec-fetch-site': 'cross-site' });
    expect(cross.body.sameOrigin).toBe(false);
  });

  it('une extension en panne donne une erreur 500 générique et une ligne de journal', async () => {
    running = await startServer({ extensions: [echo()] });
    const agent = new Agent(running.origin);
    const reply = await agent.get('/api/echo/v1/boom');
    expect(reply.status).toBe(500);
    expect(reply.body).toEqual({ error: { code: 'internal', message: expect.any(String) } });
    expect(reply.text).not.toMatch(/panne/);
    expect(reply.headers.get('x-content-type-options')).toBe('nosniff');
    expect(running.logs.at(-1)).toMatch(/^GET \/api\/echo\/v1\?? 500 \d+ ms$/);
  });

  it('journalisent la route renvoyée par l’extension, jamais l’adresse brute', async () => {
    running = await startServer({ extensions: [echo()] });
    const agent = new Agent(running.origin);
    await agent.get('/api/echo/v1/me?secret=1');
    await agent.get('/api/echo/v1/Pseudo-Secret');
    expect(running.logs.slice(-2)).toEqual([
      expect.stringMatching(/^GET \/api\/echo\/v1\/me 200 \d+ ms$/),
      expect.stringMatching(/^GET \/api\/echo\/v1\/autre 200 \d+ ms$/),
    ]);
  });

  it('refuse deux extensions au même préfixe, ou un préfixe des comptes', async () => {
    await expect(startServer({ extensions: [echo(), echo()] })).rejects.toThrow(/préfixe/);
    await expect(
      startServer({ extensions: [{ ...echo(), prefix: '/api/accounts/v1/x' }] }),
    ).rejects.toThrow(/préfixe/);
    await expect(startServer({ extensions: [{ ...echo(), prefix: 'api/x/' }] })).rejects.toThrow(
      /préfixe/,
    );
  });
});

describe('publicNames', () => {
  it('donne le pseudo actuel et le marqueur invité des comptes existants', async () => {
    running = await startServer();
    const agent = new Agent(running.origin);
    const a = (
      await agent.post('/api/accounts/v1/register', {
        pseudo: 'Alice',
        password: 'motdepasse-solide',
      })
    ).body.account;
    await agent.send('PATCH', '/api/accounts/v1/profile', { pseudo: 'Alicia' });
    const other = new Agent(running.origin);
    const g = (await other.post('/api/accounts/v1/guest', { pseudo: 'Passant' })).body.account;
    const names = await running.server.service.publicNames([
      a.id,
      g.id,
      '00000000-0000-4000-8000-000000000000',
    ]);
    expect(names).toEqual(
      new Map([
        [a.id, { pseudo: 'Alicia', guest: false }],
        [g.id, { pseudo: 'Passant', guest: true }],
      ]),
    );
    expect(await running.server.service.publicNames([])).toEqual(new Map());
  });
});
