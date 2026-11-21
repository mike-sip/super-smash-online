/**
 * Panneau Classement de la démo, dans Microsoft Edge : avec un vrai serveur comptes + classement
 * relayé par Vite et des matchs semés comme les enverra `lobby`, puis sans serveur du tout.
 */
import { fileURLToPath } from 'node:url';
import { createMemoryStore, MemoryRateLimiter } from '@game/accounts';
import { createGameServer, createMemoryRankingStore, type GameServer } from '@game/ranking';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedMatches } from '../../../packages/ranking/src/seed.ts';
import type { DemoTestHook } from '../src/main.ts';

declare global {
  var __demo: DemoTestHook;
}

const REPORT_SECRET = 'cle-des-rapports-pour-les-tests-de-la-demo';
/** Erreur attendue quand le serveur est absent (relais de Vite en échec). */
const EXPECTED_RESOURCE_ERROR = /^Failed to load resource: the server responded with a status of/;

async function startDemo(serverUrl: string): Promise<{ server: ViteDevServer; url: string }> {
  // La configuration de Vite lit cette variable pour savoir où relayer /api/accounts et /api/ranking.
  process.env.ACCOUNTS_URL = serverUrl;
  const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'silent',
    server: { port: 0, host: '127.0.0.1' },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('Le serveur de la démo ne donne pas son port.');
  }
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ channel: 'msedge' });
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

async function open(url: string): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(url);
  await page.waitForFunction(() => globalThis.__demo !== undefined && __demo.frame() > 10);
  return { page, errors };
}

const part = (page: Page, name: string) => page.locator(`[data-ranking="${name}"]`);

describe('panneau Classement avec un serveur', () => {
  let game: GameServer;
  let origin: string;
  let demo: { server: ViteDevServer; url: string };

  beforeAll(async () => {
    const generous = { capacity: 1000, windowSeconds: 1 };
    game = createGameServer(
      {
        host: '127.0.0.1',
        port: 0,
        store: createMemoryStore(),
        ticketSecrets: ['cle-de-ticket-pour-les-tests-de-la-demo'],
        allowedOrigins: [],
        secureCookies: false,
        trustProxy: false,
        hashing: { logN: 10, r: 8, p: 1 },
        limiters: {
          authPerAddress: new MemoryRateLimiter(generous),
          guestPerAddress: new MemoryRateLimiter(generous),
          loginFailuresPerPseudo: new MemoryRateLimiter(generous),
        },
        log: () => {},
      },
      { store: createMemoryRankingStore(), reportSecrets: [REPORT_SECRET] },
    );
    const { port } = await game.listen();
    origin = `http://127.0.0.1:${port}`;
    demo = await startDemo(origin);
  }, 60_000);

  afterAll(async () => {
    await demo?.server.close();
    await game?.close();
  });

  it('montre le classement, ma cote et mon historique ; le jeu continue', async () => {
    const { page, errors } = await open(demo.url);
    expect(await page.locator('#leaderboard').isHidden()).toBe(true);

    // Sans session : le classement (vide) et une invitation à se connecter.
    await page.locator('[data-control="KeyE"]').click();
    await expect.poll(() => part(page, 'board-empty').textContent()).toContain('5 matchs');
    expect(await part(page, 'me').textContent()).toContain('Ouvrez une session');

    // Un compte créé depuis la page (cookie dans le navigateur), puis des matchs semés côté serveur.
    const id = await page.evaluate(async () => {
      const response = await fetch('/api/accounts/v1/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pseudo: 'Testeuse', password: 'mot-de-passe-solide' }),
      });
      return ((await response.json()) as { account: { id: string } }).account.id;
    });
    await seedMatches({ baseUrl: origin, secret: REPORT_SECRET, count: 30, with: id, seed: 11 });

    // Réouverture : les données sont relues.
    await page.keyboard.press('KeyE');
    await page.keyboard.press('KeyE');
    await part(page, 'board').waitFor();
    const rows = await part(page, 'board').locator('tr').count();
    expect(rows).toBeGreaterThan(2);
    expect(await part(page, 'board').textContent()).toMatch(/Rang.*Joueur.*Cote/);
    await expect.poll(() => part(page, 'me').textContent()).toMatch(/Cote \d+/);
    expect(await part(page, 'stats').textContent()).toMatch(/30 match\(s\)/);
    expect(await part(page, 'fighters').locator('tr').count()).toBeGreaterThan(1);
    // Les 10 derniers matchs, plus la ligne d'en-tête.
    expect(await part(page, 'history').locator('tr').count()).toBe(11);
    expect(await part(page, 'history').textContent()).toMatch(/\/\d/);

    // Taper la touche du panneau ne fait pas bouger le joueur, et le jeu tourne toujours.
    const frame = await page.evaluate(() => __demo.frame());
    await page.waitForFunction((f) => __demo.frame() > f + 10, frame);
    expect(errors).toEqual([]);
    await page.screenshot({ path: 'test-results/leaderboard.png' });
    await page.close();
  }, 90_000);
});

describe('panneau Classement sans serveur', () => {
  let demo: { server: ViteDevServer; url: string };

  beforeAll(async () => {
    // Port 1 : rien n'y écoute.
    demo = await startDemo('http://127.0.0.1:1');
  }, 60_000);

  afterAll(async () => {
    await demo?.server.close();
  });

  it('le dit clairement et laisse jouer', async () => {
    const { page, errors } = await open(demo.url);
    await page.keyboard.press('KeyE');
    await expect.poll(() => part(page, 'status').textContent()).toContain('injoignable');
    expect(await part(page, 'status').textContent()).toContain('Le jeu reste jouable.');
    await page.keyboard.press('KeyE');
    const start = await page.evaluate(() => __demo.fighter(0).x);
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction((x) => __demo.fighter(0).x > x + 5, start);
    await page.keyboard.up('ArrowRight');
    expect(errors.filter((e) => !EXPECTED_RESOURCE_ERROR.test(e))).toEqual([]);
    await page.close();
  }, 60_000);
});
