/**
 * Benchmark bloquant : un `step` à 8 joueurs avec les quatre personnages doit rester sous les seuils
 * de `sim-core` (SPEC-fighters.md, critère n° 6). Sort en erreur sinon.
 *
 *   pnpm --filter @game/fighters bench
 */
import { AutoMatch, mixedConfig } from '../test/sim-helpers.ts';

const WARMUP_FRAMES = 200_000;
const MEASURED_FRAMES = 100_000;
const LIMITS = { stepMeanMs: 0.25, stepP99Ms: 1 };

const match = new AutoMatch(mixedConfig(8, 1), 12345);
for (let f = 0; f < WARMUP_FRAMES; f++) {
  match.draw();
  match.play();
}

const samples = new Float64Array(MEASURED_FRAMES);
for (let f = 0; f < MEASURED_FRAMES; f++) {
  match.draw();
  const t0 = performance.now();
  match.play();
  samples[f] = performance.now() - t0;
}
const mean = samples.reduce((a, b) => a + b, 0) / MEASURED_FRAMES;
const p99 = Float64Array.from(samples).sort()[Math.floor(MEASURED_FRAMES * 0.99)]!;

const rows: [string, number, number][] = [
  ['step, moyenne', mean, LIMITS.stepMeanMs],
  ['step, 99e centile', p99, LIMITS.stepP99Ms],
];
console.log(`fighters, 8 joueurs (les quatre personnages), ${MEASURED_FRAMES} frames mesurées\n`);
let failed = false;
for (const [label, value, limit] of rows) {
  const ok = value < limit;
  failed ||= !ok;
  console.log(
    `${ok ? 'ok    ' : 'ÉCHEC '} ${label.padEnd(20)} ${value.toFixed(5)} ms (seuil ${limit})`,
  );
}
process.exitCode = failed ? 1 : 0;
