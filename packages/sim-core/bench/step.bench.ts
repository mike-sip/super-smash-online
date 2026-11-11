/**
 * Benchmark bloquant : sort en erreur si un seuil de SPEC-sim-core.md est dépassé.
 * Lancer avec `pnpm --filter @game/sim-core bench`.
 *
 * Les seuils sont ceux de la spec, mesurés sur la machine de développement. Relever un seuil
 * demande un accord explicite (« Demander d'abord »).
 */
import {
  MAX_ENTITIES,
  STATE_BYTES,
  createSim,
  fx,
  loadState,
  saveState,
  spawnEntity,
  type Sim,
} from '../src/index.ts';
import { E_BALL, testConfig } from '../src/testing/fixtures.ts';
import { InputStream, stepWithRespawn } from '../test/determinism/harness.ts';

const PLAYERS = 8;
/** Le critère de succès n° 3 se mesure avec 16 entités actives. */
const ENTITIES = 16;
/**
 * Le moteur JavaScript compile les fonctions par paliers, et tant qu'une fonction n'a pas atteint
 * le dernier, ses calculs intermédiaires sont alloués sur le tas. L'échauffement est long pour
 * mesurer le régime établi, celui d'une vraie partie, et non cette phase de démarrage.
 */
const WARMUP_FRAMES = 300_000;
const MEASURED_FRAMES = 100_000;
const HEAP_FRAMES = 10_000;

const LIMITS = {
  stepMeanMs: 0.25,
  stepP99Ms: 1,
  snapshotMs: 0.05,
  stateBytes: 64 * 1024,
  /**
   * Historique : 16 Ko, relevé à 64 Ko le 2026-11-11 avec accord, puis resserré à 32 Ko le même
   * jour une fois la vraie cause trouvée (une fonction de bornage dans geometry.ts renvoyait un
   * nombre non entier, alloué à chaque appel). La mesure est d'environ 15 Ko : le harnais
   * lui-même (réapparitions, création d'entités) en représente l'essentiel. Une seule allocation
   * de 16 octets par frame ferait 160 Ko.
   */
  heapGrowthBytes: 32 * 1024,
};

/** Maintient `ENTITIES` entités en vie : des balles qui tombent et rebondissent sur le stage. */
function topUpEntities(sim: Sim, frame: number): void {
  let alive = 0;
  for (let e = 0; e < MAX_ENTITIES; e++) if (sim.state.eKind[e] !== 0) alive++;
  for (let k = alive; k < ENTITIES; k++) {
    const x = ((frame * 7 + k * 13) % 100) - 50;
    spawnEntity(sim, E_BALL, -1, x * 4096, FALL_HEIGHT, k % 2 === 0 ? DRIFT : -DRIFT, 0);
  }
}
const FALL_HEIGHT = fx(50);
const DRIFT = fx(0.3);

const sim = createSim(testConfig(PLAYERS));
const stream = new InputStream(1);
const inputs = new Uint32Array(PLAYERS);
const snap = new Uint8Array(STATE_BYTES);

for (let f = 0; f < WARMUP_FRAMES; f++) {
  stream.fill(inputs);
  topUpEntities(sim, f);
  stepWithRespawn(sim, inputs);
  saveState(sim, snap);
  loadState(sim, snap);
}

// Temps par step.
const samples = new Float64Array(MEASURED_FRAMES);
for (let f = 0; f < MEASURED_FRAMES; f++) {
  stream.fill(inputs);
  topUpEntities(sim, f);
  const t0 = performance.now();
  stepWithRespawn(sim, inputs);
  samples[f] = performance.now() - t0;
}
let total = 0;
for (let f = 0; f < MEASURED_FRAMES; f++) total += samples[f]!;
samples.sort();
const stepMeanMs = total / MEASURED_FRAMES;
const stepP99Ms = samples[Math.floor(MEASURED_FRAMES * 0.99)]!;

// Coût d'un snapshot, moyenné sur une boucle serrée (trop court pour être chronométré seul).
function timeLoop(fn: () => void, iterations: number): number {
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  return (performance.now() - t0) / iterations;
}
const saveMs = timeLoop(() => saveState(sim, snap), 200_000);
const loadMs = timeLoop(() => loadState(sim, snap), 200_000);

// Allocations : le tas ne doit pas grandir pendant que la simulation tourne.
const gc = (globalThis as { gc?: () => void }).gc;
let heapGrowthBytes: number | null = null;
if (gc) {
  gc();
  const before = process.memoryUsage().heapUsed;
  for (let f = 0; f < HEAP_FRAMES; f++) {
    stream.fill(inputs);
    topUpEntities(sim, f);
    stepWithRespawn(sim, inputs);
  }
  const after = process.memoryUsage().heapUsed;
  heapGrowthBytes = after - before;
}

const rows: [label: string, value: number | null, limit: number, unit: string][] = [
  ['step, moyenne', stepMeanMs, LIMITS.stepMeanMs, 'ms'],
  ['step, 99e centile', stepP99Ms, LIMITS.stepP99Ms, 'ms'],
  ['saveState', saveMs, LIMITS.snapshotMs, 'ms'],
  ['loadState', loadMs, LIMITS.snapshotMs, 'ms'],
  ['taille de l’état', STATE_BYTES, LIMITS.stateBytes, 'octets'],
  [`tas après ${HEAP_FRAMES} frames`, heapGrowthBytes, LIMITS.heapGrowthBytes, 'octets'],
];

let failed = false;
console.log(`sim-core, ${PLAYERS} joueurs, ${MEASURED_FRAMES} frames mesurées\n`);
for (const [label, value, limit, unit] of rows) {
  if (value === null) {
    failed = true;
    console.log(`ÉCHEC  ${label.padEnd(28)} non mesuré (relancer avec --expose-gc)`);
    continue;
  }
  const ok = value <= limit;
  failed ||= !ok;
  const shown = unit === 'ms' ? value.toFixed(5) : String(value);
  console.log(`${ok ? 'ok   ' : 'ÉCHEC'}  ${label.padEnd(28)} ${shown} ${unit} (seuil ${limit})`);
}
process.exit(failed ? 1 : 0);
