/**
 * Règles de match dans la démo (Microsoft Edge) : HUD de match, choix du mode et des équipes,
 * écran de résultats, combat libre.
 */
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DemoTestHook } from '../src/main.ts';

declare global {
  var __demo: DemoTestHook;
}

describe('démo : règles de match', () => {
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(url + query);
    await page.waitForFunction(() => globalThis.__demo !== undefined && __demo.frame() > 10);
    return { page, errors };
  }

  it('joue en Stock par défaut, avec chronomètre et vies dans le HUD', async () => {
    const { page, errors } = await open('?dummies=2');
    expect(await page.evaluate(() => __demo.rules()?.mode)).toBe('stock');
    expect(await page.locator('[data-hud="clock"]').textContent()).toMatch(/^[67]:\d\d$/);
    expect(await page.locator('[data-hud^="stocks-"]').allTextContents()).toEqual([
      '●●●',
      '●●●',
      '●●●',
    ]);
    expect(await page.locator('[data-hud^="meter-"]:visible').count()).toBe(3);
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);

  it('choisit le mode Temps et les équipes dans le panneau des règles', async () => {
    const { page, errors } = await open('?dummies=3');
    await page.keyboard.press('KeyG');
    await page.locator('[data-setup="mode"]').selectOption('time');
    await page.locator('[data-setup="teams"]').check();
    for (const [p, team] of [0, 1, 0, 1].entries()) {
      await page.locator(`[data-setup="team-${p}"]`).selectOption(String(team));
    }
    await page.locator('[data-setup="start"]').click();
    await page.waitForFunction(() => __demo.rules()?.mode === 'time');

    const match = await page.evaluate(() => __demo.match());
    expect(match.phase).toBe('playing');
    expect(match.team).toEqual([0, 1, 0, 1]);
    expect(match.stocks).toEqual([-1, -1, -1, -1]);
    expect(await page.locator('[data-hud="clock"]').textContent()).toMatch(/^(3:00|2:5\d)$/);
    expect(await page.locator('[data-hud^="score-"]:visible').allTextContents()).toEqual([
      '0',
      '0',
      '0',
      '0',
    ]);
    // Le choix est gardé dans l'adresse.
    expect(new URL(page.url()).searchParams.get('rules')).toBe('time');
    expect(new URL(page.url()).searchParams.get('teams')).toBe('0,1,0,1');
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);

  it('refuse des règles invalides sans lancer de match', async () => {
    const { page, errors } = await open('?dummies=1');
    await page.keyboard.press('KeyG');
    await page.locator('[data-setup="stocks"]').fill('0');
    await page.locator('[data-setup="start"]').click();
    expect(await page.locator('[data-setup="errors"]').textContent()).toContain('stocks');
    expect(await page.locator('#rules').isVisible()).toBe(true);
    expect(await page.evaluate(() => __demo.rules()?.stocks)).toBe(3);
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);

  it('montre les résultats en fin de match, puis rejoue', async () => {
    const { page, errors } = await open('?dummies=2&mode=random&rules=stock&stocks=1');
    await page.evaluate(() => {
      __demo.knockOut(1);
      __demo.knockOut(2);
    });
    await page.locator('#results').waitFor({ state: 'visible' });
    expect(await page.locator('[data-results="headline"]').textContent()).toBe('Victoire de J1');
    expect(await page.locator('[data-results^="player-"]').count()).toBe(3);
    expect(await page.locator('[data-hud="clock"]').textContent()).toBe('Terminé');
    const result = await page.evaluate(() => __demo.result());
    expect(result?.winners).toEqual([0]);
    // J2, éliminé avant J3, finit troisième.
    expect(result?.players.map((p) => p.placement)).toEqual([1, 3, 2]);

    await page.locator('[data-results="replay"]').click();
    await page.waitForFunction(() => __demo.match().phase === 'playing');
    expect(await page.locator('#results').isVisible()).toBe(false);
    expect(await page.evaluate(() => __demo.match().stocks)).toEqual([1, 1, 1]);
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);

  it('garde le combat libre, sans HUD de match, avec réapparition automatique', async () => {
    const { page, errors } = await open('?rules=free');
    expect(await page.evaluate(() => __demo.rules())).toBeNull();
    expect(await page.locator('[data-hud="match"]').count()).toBe(0);
    await page.evaluate(() => {
      __demo.knockOut(1);
      __demo.fastForward(70);
    });
    expect(await page.evaluate(() => __demo.fighter(1).action)).not.toBe(10);
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);
});
