/**
 * Outils des tests de la démo en ligne dans Edge : serveur Vite (qui héberge comptes, lobby et
 * relais), un contexte de navigation par onglet (chacun a son cookie, donc son compte invité).
 */
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import type { OnlineTestHook } from '../src/main.ts';

declare global {
  var __online: OnlineTestHook;
}

export interface Tab {
  readonly page: Page;
  readonly errors: string[];
}

export async function startDemo(): Promise<{
  server: ViteDevServer;
  browser: Browser;
  url: string;
}> {
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
  const browser = await chromium.launch({ channel: 'msedge' });
  return { server, browser, url: `http://127.0.0.1:${address.port}/` };
}

export async function openTab(browser: Browser, url: string): Promise<Tab> {
  const context = await browser.newContext({ viewport: { width: 960, height: 600 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(url);
  await page.waitForFunction(() => globalThis.__online?.lobby().status === 'online', null, {
    timeout: 15_000,
  });
  return { page, errors };
}

/** Le premier onglet crée un salon, les autres le rejoignent par son code ; renvoie le code. */
export async function gather(host: Tab, others: Tab[]): Promise<string> {
  await host.page.click('#create-room');
  const codeEl = host.page.locator('#room-code');
  await codeEl.waitFor();
  const code = (await codeEl.getAttribute('data-code'))!;
  const shown = (await codeEl.textContent())!;
  for (const t of others) {
    // Saisie comme un joueur la recopierait : minuscules et tiret.
    await t.page.fill('input[name="code"]', shown.toLowerCase());
    await t.page.click('#join-room button[type="submit"]');
    await t.page.locator('#room-code').waitFor();
  }
  await host.page.waitForFunction(
    (n) => __online.lobby().room?.members.length === n,
    others.length + 1,
  );
  return code;
}

/** Chacun choisit son personnage, les non-hôtes se déclarent prêts, l'hôte lance. */
export async function pickReadyStart(
  host: Tab,
  others: Tab[],
  fighter = 'mannequin',
): Promise<void> {
  for (const t of [host, ...others]) await t.page.selectOption('select[name="fighter"]', fighter);
  for (const t of others) await t.page.check('input[name="ready"]');
  await host.page.waitForFunction(() =>
    __online
      .lobby()
      .room!.members.every(
        (m) => m.fighter !== null && (m.ready || m.id === __online.lobby().room!.host),
      ),
  );
  await host.page.click('#start');
}

export async function waitRunning(tab: Tab, minFrame = 60): Promise<void> {
  await tab.page.waitForFunction(
    (f) => __online.status() === 'running' && (__online.stats()?.frame ?? 0) > f,
    minFrame,
    { timeout: 30_000 },
  );
}

/**
 * Erreurs de console tolérées : Edge écrit « Failed to load resource » pour une réponse en erreur
 * attendue (comme dans le test du panneau Compte de `apps/demo`). Aucune autre.
 */
export function unexpected(errors: string[]): string[] {
  return errors.filter((e) => !e.startsWith('Failed to load resource'));
}
