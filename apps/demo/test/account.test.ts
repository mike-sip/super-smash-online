/**
 * Panneau Compte de la démo, dans Microsoft Edge : avec un vrai serveur des comptes relayé par
 * Vite, puis sans serveur du tout.
 */
import { fileURLToPath } from 'node:url';
import { createAccountsServer, createMemoryStore, type AccountsServer } from '@game/accounts';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DemoTestHook } from '../src/main.ts';

declare global {
  var __demo: DemoTestHook;
}

/** Erreur attendue quand le serveur refuse une requête (mauvais mot de passe) ou est absent. */
const EXPECTED_RESOURCE_ERROR = /^Failed to load resource: the server responded with a status of/;

async function startDemo(accountsUrl: string): Promise<{ server: ViteDevServer; url: string }> {
  // La configuration de Vite lit cette variable pour savoir où relayer /api/accounts.
  process.env.ACCOUNTS_URL = accountsUrl;
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

const status = (page: Page) => page.locator('[data-account="status"]');
const message = (page: Page) => page.locator('[data-account="message"]');

async function submit(page: Page, form: string, values: Record<string, string>): Promise<void> {
  for (const [field, value] of Object.entries(values)) {
    await page.locator(`[data-account="${field}"]`).fill(value);
  }
  await page.locator(`[data-account="${form}-submit"]`).click();
}

describe('panneau Compte avec un serveur des comptes', () => {
  let accounts: AccountsServer;
  let demo: { server: ViteDevServer; url: string };

  beforeAll(async () => {
    accounts = createAccountsServer({
      host: '127.0.0.1',
      port: 0,
      store: createMemoryStore(),
      ticketSecrets: ['cle-de-ticket-pour-les-tests-de-la-demo'],
      allowedOrigins: [],
      secureCookies: false,
      trustProxy: false,
      hashing: { logN: 10, r: 8, p: 1 },
      log: () => {},
    });
    const { port } = await accounts.listen();
    demo = await startDemo(`http://127.0.0.1:${port}`);
  }, 60_000);

  afterAll(async () => {
    await demo?.server.close();
    await accounts?.close();
  });

  it('mène un joueur d’invité à compte, de la déconnexion à la suppression', async () => {
    const { page, errors } = await open(demo.url);
    expect(await page.locator('#account').isHidden()).toBe(true);
    await page.locator('[data-control="KeyU"]').click();
    await page.locator('[data-account="guest-submit"]').waitFor();

    // Taper dans un champ du panneau ne fait pas bouger le joueur.
    const x = await page.evaluate(() => __demo.fighter(0).x);
    await page.locator('[data-account="guest-pseudo"]').pressSequentially('Zoxz');
    expect(await page.evaluate(() => __demo.fighter(0).x)).toBe(x);
    expect(await page.evaluate(() => __demo.fighter(0).grounded)).toBe(true);

    await submit(page, 'guest', { 'guest-pseudo': 'Zoë' });
    await expect.poll(() => status(page).textContent()).toBe('Invité : Zoë');

    await submit(page, 'profile', { fighter: 'vanguard' });
    await expect.poll(() => message(page).textContent()).toBe('Profil enregistré.');

    // Le cookie de session est hors de portée des scripts de la page.
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === 'sid')).toMatchObject({
      httpOnly: true,
      sameSite: 'Strict',
    });
    expect(await page.evaluate(() => document.cookie)).not.toContain('sid=');

    await expect
      .poll(() => page.locator('[data-account="convert-hint"]').textContent())
      .toContain('mot de passe oublié');
    await submit(page, 'convert', {
      'convert-pseudo': 'Zoe_Fan',
      'convert-password': 'tartiflette',
    });
    await expect.poll(() => status(page).textContent()).toBe('Connecté : Zoe_Fan');

    // Rechargement : la session est toujours là, profil compris.
    await page.reload();
    await page.waitForFunction(() => globalThis.__demo !== undefined && __demo.frame() > 10);
    await page.keyboard.press('KeyU');
    await expect.poll(() => status(page).textContent()).toBe('Connecté : Zoe_Fan');
    expect(await page.locator('[data-account="fighter"]').inputValue()).toBe('vanguard');

    await page.locator('[data-account="logout"]').click();
    await page.locator('[data-account="login-submit"]').waitFor();
    await submit(page, 'login', { 'login-pseudo': 'zoe_fan', 'login-password': 'tartiflette' });
    await expect.poll(() => status(page).textContent()).toBe('Connecté : Zoe_Fan');

    await page.locator('[data-account="delete"]').click();
    await submit(page, 'delete', { 'delete-password': 'tartiflette' });
    await expect.poll(() => message(page).textContent()).toBe('Compte supprimé.');
    await page.locator('[data-account="register-submit"]').waitFor();

    // Le jeu tourne toujours, panneau ouvert.
    const frame = await page.evaluate(() => __demo.frame());
    await page.waitForFunction((f) => __demo.frame() > f + 10, frame);
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);

  it('affiche les refus du serveur en français', async () => {
    const { page, errors } = await open(demo.url);
    await page.keyboard.press('KeyU');
    await page.locator('[data-account="login-submit"]').waitFor();
    await submit(page, 'login', { 'login-pseudo': 'Personne', 'login-password': 'mauvais-mot' });
    await expect.poll(() => message(page).textContent()).toBe('Pseudo ou mot de passe incorrect.');
    // Refusé par le client avant tout envoi.
    await submit(page, 'register', { 'register-pseudo': 'ab', 'register-password': 'tartiflette' });
    await expect
      .poll(() => message(page).textContent())
      .toBe('Le pseudo doit faire de 3 à 16 caractères.');
    expect(errors.filter((e) => !EXPECTED_RESOURCE_ERROR.test(e))).toEqual([]);
    // Une seule requête en erreur : la connexion refusée.
    expect(errors).toHaveLength(1);
    await page.close();
  }, 60_000);
});

describe('panneau Compte sans serveur des comptes', () => {
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
    await page.keyboard.press('KeyU');
    await expect.poll(() => status(page).textContent()).toContain('injoignable');
    expect(await status(page).textContent()).toContain('Le jeu reste jouable sans compte.');

    // Le panneau fermé, le jeu répond toujours au clavier.
    await page.keyboard.press('KeyU');
    const start = await page.evaluate(() => __demo.fighter(0).x);
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction((x) => __demo.fighter(0).x > x + 5, start);
    await page.keyboard.up('ArrowRight');
    expect(errors.filter((e) => !EXPECTED_RESOURCE_ERROR.test(e))).toEqual([]);
    await page.close();
  }, 60_000);
});
