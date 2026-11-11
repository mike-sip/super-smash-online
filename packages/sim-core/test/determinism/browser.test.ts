/**
 * Déterminisme entre Node et un vrai navigateur : la simulation est empaquetée, exécutée dans
 * la page, et ses checksums comparés à ceux calculés ici.
 *
 * Phase C : Microsoft Edge (moteur Chromium), déjà présent sur Windows, donc sans téléchargement.
 * La matrice complète Chromium, Firefox et WebKit arrive en phase E (T17).
 */
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CASES, runCase } from './cases.ts';

async function bundle(): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL('./browser-entry.ts', import.meta.url)),
        formats: ['iife'],
        name: 'SimDeterminism',
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  for (const out of outputs) {
    if (!('output' in out)) continue;
    for (const chunk of out.output) {
      if (chunk.type === 'chunk') return chunk.code;
    }
  }
  throw new Error('Vite n’a produit aucun script.');
}

describe('déterminisme Node / navigateur', () => {
  let browser: Browser;

  beforeAll(async () => {
    try {
      browser = await chromium.launch({ channel: 'msedge' });
    } catch (cause) {
      throw new Error(
        'Impossible de lancer Microsoft Edge. Ce test exige un navigateur Chromium installé.',
        { cause },
      );
    }
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it('obtient les mêmes checksums dans Edge que dans Node', async () => {
    const page = await browser.newPage();
    await page.addScriptTag({ content: await bundle() });
    const inBrowser = await page.evaluate(() =>
      (globalThis as unknown as { __runDeterminismCases: () => number[] }).__runDeterminismCases(),
    );
    const inNode = CASES.map((c) => runCase(c).checksum);
    expect(inBrowser).toEqual(inNode);
    expect(inBrowser).toHaveLength(CASES.length);
  }, 120_000);
});
