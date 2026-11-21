/**
 * Benchmark bloquant du crochet de règles (critère de succès n° 5 de SPEC-match-rules.md).
 * Lancer avec `pnpm --filter @game/match-rules bench`.
 *
 * Mode Temps à 8 joueurs, limite d'une heure : le match reste en phase de jeu pendant toute la
 * mesure, avec KO, réapparitions et attribution, le chemin le plus chargé du crochet.
 */
import { createSim, type Sim, type SimRules } from '@game/sim-core';
import { testConfig } from '@game/sim-core/testing';
import {
  createMatchSimConfig,
  defaultMatchConfig,
  readMatch,
  createMatchView,
} from '../src/index.ts';
import { Rng, randomStep } from '../test/determinism/harness.ts';

const PLAYERS = 8;
const WARMUP_FRAMES = 100_000;
const MEASURED_FRAMES = 100_000;
const HEAP_FRAMES = 10_000;
const LIMITS = { hookMeanMs: 0.02, heapGrowthBytes: 32 * 1024 };

const match = { ...defaultMatchConfig('time', PLAYERS), timeLimit: 3600 };
const { stage, fighters, entities } = testConfig(PLAYERS);
const config = createMatchSimConfig(match, { stage, fighters, entities, seed: 1 });
const rules = config.rules!;

// Le crochet est chronométré de l'intérieur : seul son propre coût est mesuré.
let hookMs = 0;
const timed: SimRules = {
  init: (sim) => rules.init(sim),
  afterStep(sim) {
    const t0 = performance.now();
    rules.afterStep(sim);
    hookMs += performance.now() - t0;
  },
};
const sim: Sim = createSim({ ...config, rules: timed });
const rng = new Rng(1);
const inputs = new Uint32Array(PLAYERS);
// KO imposés de temps en temps, en plus de ceux du jeu, pour exercer réapparitions et crédit.
const KO_EVERY = 120;

for (let f = 0; f < WARMUP_FRAMES; f++) randomStep(sim, rng, inputs, KO_EVERY);
hookMs = 0;
for (let f = 0; f < MEASURED_FRAMES; f++) randomStep(sim, rng, inputs, KO_EVERY);
const hookMean = hookMs / MEASURED_FRAMES;

// Tas : le crochet réel, sans chronomètre, sur une simulation déjà échauffée.
const plain = createSim(config);
const view = createMatchView();
for (let f = 0; f < WARMUP_FRAMES; f++) randomStep(plain, rng, inputs, KO_EVERY);
const gc = (globalThis as { gc?: () => void }).gc;
if (gc === undefined) throw new Error('Lancer avec node --expose-gc.');
// Médiane de 5 fenêtres consécutives : la première après l'échauffement varie de -10 à +45 Ko
// d'une exécution à l'autre (fin de compilation par paliers), les suivantes sont proches de 0.
// Une allocation systématique, même de 16 octets par frame, ferait 160 Ko dans chaque fenêtre.
const windows: number[] = [];
for (let w = 0; w < 5; w++) {
  gc();
  const before = process.memoryUsage().heapUsed;
  for (let f = 0; f < HEAP_FRAMES; f++) {
    randomStep(plain, rng, inputs, KO_EVERY);
    readMatch(plain, view);
  }
  gc();
  windows.push(process.memoryUsage().heapUsed - before);
}
const growth = [...windows].sort((a, b) => a - b)[2]!;
readMatch(plain, view);

const rows: [string, number, number, string][] = [
  ['crochet, moyenne', hookMean, LIMITS.hookMeanMs, 'ms'],
  ['tas après 10000 frames', growth, LIMITS.heapGrowthBytes, 'octets'],
];
console.log(`match-rules, ${PLAYERS} joueurs, mode Temps, ${MEASURED_FRAMES} frames mesurées\n`);
let failed = false;
for (const [name, value, limit, unit] of rows) {
  const ok = value < limit;
  failed ||= !ok;
  const shown = unit === 'ms' ? value.toFixed(5) : String(Math.round(value));
  console.log(`${ok ? 'ok    ' : 'ÉCHEC '} ${name.padEnd(28)} ${shown} ${unit} (seuil ${limit})`);
}
console.log(
  `\nphase en fin de mesure : ${view.phase}, scores ${Array.from(view.score.subarray(0, PLAYERS)).join(' ')}`,
);
if (failed) process.exit(1);
