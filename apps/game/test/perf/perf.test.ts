/**
 * Performance de l'application (SPEC-app-shell.md, critère n° 9), avec les seuils de
 * SPEC-render.md : sur l'écran de combat de l'application, 8 combattants à inputs aléatoires,
 * objets fréquents, son actif, dans Edge, 95 % des images produites en moins de 16,7 ms et un
 * dessin moyen sous 4 ms ; menus au-dessus de la scène de fond : 95 % sous 16,7 ms.
 *
 * Le temps d'une image est celui de toute la boucle de l'application (navigation, simulation,
 * dessin, HUD), côté processeur. Build mesuré : `dist-e2e` (le build de production plus la prise
 * de test). Comme pour la démo, si Edge sans fenêtre dessine sans carte graphique, la mesure
 * recommence dans une fenêtre visible.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGateway } from '../../../../deploy/gateway.ts';
import { hook } from '../helpers.ts';

const MEASURE_MS = 10_000;
const MAX_FRAME_MS = 16.7;
const MAX_DRAW_MS = 4;
const SOFTWARE = /swiftshader|llvmpipe|software|basic render/i;
const STAGES = ['belvedere', 'recif', 'canal', 'geysers'];

const mean = (v: number[]): number => v.reduce((s, x) => s + x, 0) / Math.max(1, v.length);
function percentile(v: number[], share: number): number {
  const sorted = [...v].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
}

interface Perf {
  frame: number[];
  draw: number[];
  interval: number[];
}

let gateway: Server;
let url: string;
let browser: Browser | undefined;

beforeAll(async () => {
  gateway = createGateway({
    root: fileURLToPath(new URL('../../dist-e2e/', import.meta.url)),
    port: 0,
    // Aucun serveur : la mesure ne joue qu'en local.
    upstreams: { accounts: new URL('http://127.0.0.1:9'), game: new URL('http://127.0.0.1:9') },
  });
  await new Promise<void>((r) => gateway.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(gateway.address() as { port: number }).port}/`;
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => gateway.close(() => r()));
});

async function open(): Promise<{ page: Page; gpu: string; windowed: boolean }> {
  for (const headless of [true, false]) {
    await browser?.close();
    browser = await chromium.launch({ channel: 'msedge', headless });
    const page = await (
      await browser.newContext({ viewport: { width: 1280, height: 720 } })
    ).newPage();
    await page.goto(url);
    await page.waitForFunction(
      () => 'screen' in ((window as never as { __game?: object }).__game ?? {}),
    );
    const gpu = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'inconnu';
    });
    if (!SOFTWARE.test(gpu) || !headless) return { page, gpu, windowed: !headless };
  }
  throw new Error('inaccessible');
}

async function measure(page: Page): Promise<Perf> {
  await hook(page, 'perfStart');
  await page.waitForTimeout(MEASURE_MS);
  return (await hook<Perf>(page, 'perfStop'))!;
}

function report(name: string, p: Perf): { p95: number; drawMean: number } {
  const p95 = percentile(p.frame, 0.95);
  const drawMean = mean(p.draw);
  console.log(
    `${name} : ${p.frame.length} images, p95 ${p95.toFixed(2)} ms, moyenne ${mean(p.frame).toFixed(2)} ms, ` +
      `dessin moyen ${drawMean.toFixed(2)} ms, intervalle médian ${percentile(p.interval, 0.5).toFixed(1)} ms`,
  );
  return { p95, drawMean };
}

describe('performance de l’application', () => {
  it('menus au-dessus de la scène de fond', async () => {
    const { page, gpu, windowed } = await open();
    console.log(`Carte graphique : ${gpu}${windowed ? ' (fenêtre visible)' : ''}`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => (window as never as { __game: { screen(): string } }).__game.screen() === 'main-menu',
    );
    await page.waitForTimeout(1000);
    const r = report('Menus', await measure(page));
    expect(r.p95).toBeLessThan(MAX_FRAME_MS);
  }, 60_000);

  it.each(STAGES)(
    'combat à 8, objets fréquents, son actif : %s',
    async (stage) => {
      const { page } = await open();
      await page.keyboard.press('Enter'); // geste de l'utilisateur : le son démarre
      await hook(page, 'perfTraining', stage);
      await page.waitForFunction(
        () =>
          (window as never as { __game: { match(): { frame: number } } }).__game.match().frame >
          300,
      );
      const audio = await page.evaluate(
        () =>
          (window as never as { __game: { match(): { players: number } } }).__game.match().players,
      );
      expect(audio).toBe(8);
      const r = report(`Combat ${stage}`, await measure(page));
      expect(r.p95).toBeLessThan(MAX_FRAME_MS);
      expect(r.drawMean).toBeLessThan(MAX_DRAW_MS);
    },
    60_000,
  );

  it('taille du client compressé (consignée)', () => {
    const dir = fileURLToPath(new URL('../../dist/assets/', import.meta.url));
    let total = 0;
    for (const f of readdirSync(dir)) total += gzipSync(readFileSync(join(dir, f))).length;
    console.log(`Client compressé (gzip) : ${(total / 1024).toFixed(0)} Ko`);
    expect(total).toBeGreaterThan(0);
  });
});
