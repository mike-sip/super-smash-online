/**
 * Déterminisme entre moteurs JavaScript (critère de succès n° 1) : la simulation est empaquetée,
 * exécutée dans chaque navigateur, et ses checksums comparés à la référence versionnée.
 *
 * Trois moteurs : V8 (Microsoft Edge, déjà présent sur Windows), SpiderMonkey (Firefox) et
 * JavaScriptCore (WebKit). Firefox et WebKit s'installent avec :
 *   pnpm --filter @game/sim-core exec playwright-core install firefox webkit
 */
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit, type Browser } from 'playwright-core';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';
import golden from './golden.json' with { type: 'json' };

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

const ENGINES: [name: string, launch: () => Promise<Browser>][] = [
  ['Chromium (Microsoft Edge)', () => chromium.launch({ channel: 'msedge' })],
  ['Firefox', () => firefox.launch()],
  ['WebKit', () => webkit.launch()],
];

/**
 * Par défaut les trois moteurs sont exigés. Sur une machine où l'un d'eux ne peut pas démarrer,
 * `SIM_BROWSERS=chromium,webkit` restreint la liste : le test manquant est alors signalé comme
 * ignoré dans le rapport, jamais passé sous silence.
 */
const wanted = (process.env.SIM_BROWSERS ?? 'chromium,firefox,webkit').toLowerCase();
const enabled = (name: string): boolean => wanted.includes(name.split(' ')[0]!.toLowerCase());

describe('déterminisme entre navigateurs', () => {
  let script: string;

  beforeAll(async () => {
    script = await bundle();
  }, 60_000);

  for (const [name, launch] of ENGINES) {
    it.skipIf(!enabled(name))(
      `obtient les checksums de référence dans ${name}`,
      async () => {
        let browser: Browser;
        try {
          browser = await launch();
        } catch (cause) {
          throw new Error(`Impossible de lancer ${name}. Voir l'en-tête de ce fichier.`, {
            cause,
          });
        }
        try {
          const page = await browser.newPage();
          await page.addScriptTag({ content: script });
          const checksums = await page.evaluate(() =>
            (
              globalThis as unknown as { __runReferenceCases: () => number[] }
            ).__runReferenceCases(),
          );
          expect(checksums).toEqual(golden.map((g) => g.checksum));
        } finally {
          await browser.close();
        }
      },
      180_000,
    );
  }
});
