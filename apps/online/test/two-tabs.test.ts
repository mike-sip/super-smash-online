/**
 * Deux onglets de Microsoft Edge jouent ensemble dans la démo en ligne (critère n° 5) : chacun
 * dans son propre contexte de navigation, sur le serveur de développement Vite qui héberge aussi
 * le relais. Une touche dans le premier fait bouger son combattant dans le second ; aux mêmes
 * frames confirmées, les deux onglets envoient les mêmes empreintes.
 */
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OnlineTestHook } from '../src/main.ts';

declare global {
  var __online: OnlineTestHook;
}

describe('démo en ligne', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let url: string;

  beforeAll(async () => {
    server = await createServer({
      root: fileURLToPath(new URL('..', import.meta.url)),
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1' },
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (address === null || address === undefined || typeof address === 'string') {
      throw new Error('Le serveur de la démo ne donne pas son port.');
    }
    url = `http://127.0.0.1:${address.port}/`;
    browser = await chromium.launch({ channel: 'msedge' });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  async function open(query: string): Promise<{ page: Page; errors: string[] }> {
    // Un contexte par onglet : chacun se comporte comme une fenêtre au premier plan.
    const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(url + query);
    return { page, errors };
  }

  it('affiche le formulaire sans partie dans l’adresse', async () => {
    const { page, errors } = await open('');
    await expect.poll(() => page.locator('#join').isVisible()).toBe(true);
    await page.locator('input[name="game"]').fill('formulaire');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/game=formulaire&players=2&local=1/);
    await page.waitForFunction(() => globalThis.__online?.status() === 'waiting');
    expect(errors).toEqual([]);
    await page.context().close();
  }, 60_000);

  it('deux onglets jouent la même partie et restent synchronisés', async () => {
    const a = await open('?game=duel&players=2');
    const b = await open('?game=duel&players=2');
    for (const { page } of [a, b]) {
      await page.waitForFunction(
        () => __online.status() === 'running' && __online.stats().frame > 60,
        null,
        {
          timeout: 20_000,
        },
      );
    }
    const slotA = (await a.page.evaluate(() => __online.localSlots()))[0]!;
    const slotB = (await b.page.evaluate(() => __online.localSlots()))[0]!;
    expect(new Set([slotA, slotB])).toEqual(new Set([0, 1]));

    // Le joueur du premier onglet court à droite : le second le voit avancer.
    const startX = await b.page.evaluate((p) => __online.fighter(p)!.x, slotA);
    await a.page.keyboard.down('ArrowRight');
    await b.page.waitForFunction((args) => __online.fighter(args.p)!.x > args.x + 5, {
      p: slotA,
      x: startX,
    });
    await a.page.keyboard.up('ArrowRight');
    // Et un saut du second est vu par le premier.
    await b.page.keyboard.down('KeyZ');
    await a.page.waitForFunction((p) => !__online.fighter(p)!.grounded, slotB);
    await b.page.keyboard.up('KeyZ');

    // Laisse passer quelques empreintes après ces inputs, puis compare frame par frame.
    await a.page.waitForTimeout(2000);
    const sumsA = new Map(await a.page.evaluate(() => __online.checksums()));
    const sumsB = new Map(await b.page.evaluate(() => __online.checksums()));
    const common = [...sumsA.keys()].filter((f) => sumsB.has(f));
    expect(common.length).toBeGreaterThan(10);
    for (const f of common) expect(sumsA.get(f), `frame ${f}`).toBe(sumsB.get(f));

    for (const { page, errors } of [a, b]) {
      expect(await page.evaluate(() => __online.desyncs())).toBe(0);
      expect(errors).toEqual([]);
    }
    const stats = await a.page.evaluate(() => __online.stats());
    console.log(
      `deux onglets : frame ${stats.frame}, aller-retour ${stats.rttMs.toFixed(1)} ms, ` +
        `${stats.rollbacks} rollbacks, ${stats.stalls} attentes, ${common.length} empreintes comparées`,
    );
    await a.page.context().close();
    await b.page.context().close();
  }, 90_000);
});
