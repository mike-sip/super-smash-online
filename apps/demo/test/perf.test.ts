/**
 * Mesure de performance (critères « fluide » et « économe » de SPEC-render.md).
 *
 * Scénario : 8 combattants à inputs aléatoires et 16 entités, démo compilée comme en production,
 * dans Microsoft Edge, pendant 10 secondes, sur le stage de test puis sur chacun des 4 stages de
 * la v1 avec leur décor, objets à « high » (critère n° 6 de SPEC-stages-items.md ; les objets
 * comptent parmi les 16 entités). Lancement : `pnpm --filter @game/demo perf`.
 *
 * Ce qui est mesuré, et comment :
 * - temps de production d'une image : simulation puis dessin, côté processeur, dans la page ;
 * - écart entre deux images affichées : indicatif, il est plafonné par l'écran (16,7 ms à 60 Hz)
 *   et ne peut donc pas servir de seuil ;
 * - appels de dessin : comptés sur le contexte WebGL lui-même, sans passer par le moteur de rendu ;
 * - croissance du tas : mémoire encore retenue après un ramasse-miettes forcé, sur 600 images.
 *
 * Sans fenêtre, Edge peut dessiner sans carte graphique : les chiffres n'auraient alors aucun
 * rapport avec la réalité. Le script le détecte et recommence dans une fenêtre visible.
 */
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build, preview, type PreviewServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DemoTestHook } from '../src/main.ts';

declare global {
  var __demo: DemoTestHook;
  var __drawCalls: number;
}

const SCENARIO = '?dummies=7&mode=random&entities=16';
/** Stages mesurés : le stage de test d'origine, puis ceux de la v1, objets à « high ». */
const STAGES = ['test', 'belvedere', 'recif', 'canal', 'geysers'] as const;
const query = (stage: (typeof STAGES)[number]): string =>
  stage === 'test' ? `${SCENARIO}&stage=test` : `${SCENARIO}&stage=${stage}&items=high`;
const MEASURE_MS = 10_000;
const WARMUP_FRAMES = 300;
const HEAP_FRAMES = 600;

// Seuils de la spec.
const MAX_FRAME_MS = 16.7;
const MAX_DRAW_MS = 4;
const MAX_DRAW_CALLS = 100;
const MAX_HEAP_GROWTH = 256 * 1024;

const SOFTWARE = /swiftshader|llvmpipe|software|basic render/i;

const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

function percentile(values: number[], share: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
}

/** Compte les appels de dessin directement sur WebGL, avant que la page ne charge. */
function countDrawCalls(): void {
  globalThis.__drawCalls = 0;
  const proto = WebGL2RenderingContext.prototype as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;
  for (const name of [
    'drawArrays',
    'drawElements',
    'drawArraysInstanced',
    'drawElementsInstanced',
    'drawRangeElements',
  ]) {
    const original = proto[name]!;
    proto[name] = function (this: unknown, ...args: unknown[]) {
      globalThis.__drawCalls++;
      return original.apply(this, args);
    };
  }
}

async function gpuName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'inconnu';
  });
}

async function waitFrames(page: Page, frames: number): Promise<void> {
  const from = await page.evaluate(() => __demo.frame());
  await page.waitForFunction(([start, count]) => __demo.frame() >= start! + count!, [from, frames]);
}

describe('performance de la démo', () => {
  let server: PreviewServer;
  let browser: Browser | undefined;
  let url: string;

  beforeAll(async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    await build({ root, logLevel: 'silent' });
    server = await preview({ root, logLevel: 'silent', preview: { port: 0, host: '127.0.0.1' } });
    const address = server.httpServer.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Le serveur de la démo ne donne pas son port.');
    }
    url = `http://127.0.0.1:${address.port}/`;
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server?.httpServer.close(() => resolve()));
  });

  /** Ouvre la démo ; sans fenêtre d'abord, puis dans une fenêtre si le rendu est logiciel. */
  async function open(search: string): Promise<{ page: Page; gpu: string; windowed: boolean }> {
    await browser?.close();
    for (const headless of [true, false]) {
      browser = await chromium.launch({ channel: 'msedge', headless });
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      await context.addInitScript(countDrawCalls);
      const page = await context.newPage();
      await page.goto(url + search);
      const gpu = await gpuName(page);
      if (!SOFTWARE.test(gpu) || !headless) return { page, gpu, windowed: !headless };
      await browser.close();
    }
    throw new Error('Inatteignable.');
  }

  it.each(STAGES)(
    'tient les seuils de la spec à 8 combattants et 16 entités : %s',
    async (stage) => {
      const { page, gpu, windowed } = await open(query(stage));
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.waitForFunction(() => globalThis.__demo !== undefined);
      expect(await page.evaluate(() => __demo.players)).toBe(8);
      expect(await page.evaluate(() => __demo.stage())).toBe(stage);
      await waitFrames(page, WARMUP_FRAMES);

      // Temps par image, sur 10 secondes.
      await page.evaluate(() => {
        __drawCalls = 0;
        __demo.perfStart();
      });
      await page.waitForTimeout(MEASURE_MS);
      const { report, drawCalls } = await page.evaluate(() => ({
        report: __demo.perfStop(),
        drawCalls: __drawCalls,
      }));
      const images = report.intervals.length;
      const work = report.simulate.map((ms, i) => ms + report.draw[i]!);

      // Croissance du tas en régime établi, ramasse-miettes forcé avant chaque lecture.
      const cdp = await page.context().newCDPSession(page);
      const heap = async (): Promise<number> => {
        await cdp.send('HeapProfiler.collectGarbage');
        return (await cdp.send('Runtime.getHeapUsage')).usedSize;
      };
      const heapBefore = await heap();
      await waitFrames(page, HEAP_FRAMES);
      const heapGrowth = (await heap()) - heapBefore;

      const result = {
        stage,
        rendu: `${SOFTWARE.test(gpu) ? 'LOGICIEL' : 'matériel'} — ${gpu}`,
        fenetre: windowed ? 'visible' : 'sans fenêtre',
        images,
        productionMoyenneMs: +mean(work).toFixed(3),
        production95Ms: +percentile(work, 0.95).toFixed(3),
        productionMaxMs: +Math.max(...work).toFixed(3),
        simulationMoyenneMs: +mean(report.simulate).toFixed(3),
        dessinMoyenMs: +mean(report.draw).toFixed(3),
        dessin95Ms: +percentile(report.draw, 0.95).toFixed(3),
        ecartMoyenMs: +mean(report.intervals).toFixed(2),
        ecart95Ms: +percentile(report.intervals, 0.95).toFixed(2),
        imagesEnRetard: report.intervals.filter((ms) => ms > 25).length,
        appelsDeDessinParImage: +(drawCalls / Math.max(1, images)).toFixed(1),
        croissanceDuTasKo: +(heapGrowth / 1024).toFixed(1),
      };
      // Écrit directement sur la sortie : le rapport doit s'afficher même quand le test passe.
      process.stdout.write(`\nPerformance de la démo\n${JSON.stringify(result, null, 2)}\n\n`);

      expect(errors).toEqual([]);
      // Dix secondes à 60 Hz font 600 images ; nettement moins, c'est que l'affichage ne suit pas.
      expect(images).toBeGreaterThan(500);
      expect(result.production95Ms).toBeLessThan(MAX_FRAME_MS);
      expect(result.dessinMoyenMs).toBeLessThan(MAX_DRAW_MS);
      expect(result.appelsDeDessinParImage).toBeLessThan(MAX_DRAW_CALLS);
      expect(heapGrowth).toBeLessThan(MAX_HEAP_GROWTH);
    },
    120_000,
  );
});
