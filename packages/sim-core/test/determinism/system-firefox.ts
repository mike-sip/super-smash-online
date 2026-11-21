/**
 * Déterminisme dans le Firefox installé sur la machine (SpiderMonkey), sans Playwright.
 *
 * `browser.test.ts` pilote Firefox par Playwright, qui exige sa propre version modifiée du
 * navigateur (à télécharger). Ce script s'en passe : il empaquette la simulation, la sert sur
 * 127.0.0.1 dans une page qui exécute les cas de référence et renvoie ses checksums, ouvre cette
 * page dans le Firefox du système (sans tête, profil jetable), puis compare à `golden.json`.
 *
 * Usage, depuis la racine du dépôt :
 *   node packages/sim-core/test/determinism/system-firefox.ts [chemin de firefox]
 * (par défaut : FIREFOX, puis l'emplacement habituel selon le système).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import golden from './golden.json' with { type: 'json' };

const CANDIDATES = [
  process.argv[2],
  process.env.FIREFOX,
  'C:/Program Files/Mozilla Firefox/firefox.exe',
  'C:/Program Files (x86)/Mozilla Firefox/firefox.exe',
  '/Applications/Firefox.app/Contents/MacOS/firefox',
  '/usr/bin/firefox',
];

/** Délai maximal pour les cinq cas de référence. */
const TIMEOUT_MS = 10 * 60_000;

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
  for (const out of Array.isArray(result) ? result : [result]) {
    if (!('output' in out)) continue;
    for (const chunk of out.output) if (chunk.type === 'chunk') return chunk.code;
  }
  throw new Error('Vite n’a produit aucun script.');
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>Déterminisme</title>
<script src="/sim.js"></script>
<script>
  setTimeout(() => {
    let body;
    try {
      body = JSON.stringify({ ua: navigator.userAgent, checksums: globalThis.__runReferenceCases() });
    } catch (e) {
      body = JSON.stringify({ ua: navigator.userAgent, error: String(e && e.stack || e) });
    }
    fetch('/result', { method: 'POST', body });
  }, 50);
</script>`;

async function main(): Promise<void> {
  const firefox = CANDIDATES.find((p) => p !== undefined && existsSync(p));
  if (firefox === undefined) {
    console.error('Firefox introuvable : passez son chemin en argument ou dans FIREFOX.');
    process.exit(2);
  }
  const script = await bundle();
  let done: (value: { ua: string; checksums?: number[]; error?: string }) => void = () => {};
  const result = new Promise<{ ua: string; checksums?: number[]; error?: string }>((r) => {
    done = r;
  });
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/result') {
      let data = '';
      req.on('data', (c: Buffer) => (data += c.toString()));
      req.on('end', () => {
        res.end('ok');
        done(JSON.parse(data) as { ua: string; checksums?: number[]; error?: string });
      });
      return;
    }
    const js = req.url === '/sim.js';
    res.setHeader('Content-Type', js ? 'text/javascript' : 'text/html; charset=utf-8');
    res.end(js ? script : PAGE);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const profile = mkdtempSync(join(tmpdir(), 'fracas-firefox-'));
  const child = spawn(
    firefox,
    [
      '--headless',
      '--no-remote',
      '--new-instance',
      '--profile',
      profile,
      `http://127.0.0.1:${port}/`,
    ],
    { stdio: 'ignore' },
  );
  const timer = setTimeout(() => done({ ua: '?', error: 'délai dépassé' }), TIMEOUT_MS);
  const started = Date.now();
  const out = await result;
  clearTimeout(timer);
  child.kill();
  server.close();
  // Firefox libère son profil un peu après sa fermeture.
  setTimeout(() => rmSync(profile, { recursive: true, force: true }), 2000);

  const expected = golden.map((g) => g.checksum);
  console.log(`Navigateur : ${out.ua}`);
  if (out.error !== undefined) {
    console.error(`Échec : ${out.error}`);
    process.exitCode = 1;
    return;
  }
  const same = JSON.stringify(out.checksums) === JSON.stringify(expected);
  console.log(`Checksums  : ${JSON.stringify(out.checksums)}`);
  console.log(`Référence  : ${JSON.stringify(expected)}`);
  console.log(
    `${same ? 'Identiques' : 'DIFFÉRENTS'} (${golden.length} cas de ${golden[0]!.frames} frames à ` +
      `${golden[0]!.players} joueurs, ${((Date.now() - started) / 1000).toFixed(1)} s)`,
  );
  if (!same) process.exitCode = 1;
}

await main();
