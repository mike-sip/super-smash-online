/**
 * Benchmark bloquant : sort en erreur si un seuil de SPEC-sim-core.md est dépassé.
 * Lancer avec `pnpm --filter @game/sim-core bench`.
 *
 * Les seuils sont ceux de la spec, mesurés sur la machine de développement. Relever un seuil
 * demande un accord explicite (« Demander d'abord »).
 *
 * Deux scénarios : celui de la spec de sim-core (stage de test, 16 entités), puis le même avec un
 * stage vivant (module stages-items : deux plateformes mobiles, des objets qui apparaissent sans
 * cesse, 4 au plus, complétés de balles jusqu'à 16 entités).
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
import type { StageDef } from '../src/defs.ts';
import type { SimConfig } from '../src/step.ts';
import { E_BALL, testConfig } from '../src/testing/fixtures.ts';
import { InputStream, stepWithRespawn } from '../test/determinism/harness.ts';
import { ITEM_STAGE, ITEM_TABLE, itemConfig } from '../test/scenarios/item-fixtures.ts';

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

const MOVING_ITEM_STAGE: StageDef = {
  ...ITEM_STAGE,
  name: 'bench-vivant',
  platforms: [
    ...ITEM_STAGE.platforms,
    {
      x1: fx(-15),
      x2: fx(15),
      y: fx(60),
      motion: { dx: fx(40), dy: fx(0), period: 240, phase: 0 },
    },
    { x1: fx(45), x2: fx(58), y: fx(15), motion: { dx: fx(0), dy: fx(30), period: 200, phase: 0 } },
  ],
};

const SCENARIOS: [name: string, config: SimConfig][] = [
  ['stage de test, 16 entités', testConfig(PLAYERS)],
  [
    'plateformes mobiles et objets, 16 entités',
    {
      ...itemConfig(PLAYERS, { ...ITEM_TABLE, minInterval: 30, maxInterval: 60, maxActive: 4 }),
      stage: MOVING_ITEM_STAGE,
    },
  ],
];

type Row = [label: string, value: number | null, limit: number, unit: string];

/** Coût moyen d'une opération, sur une boucle serrée (trop court pour être chronométré seul). */
function timeLoop(fn: () => void, iterations: number): number {
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  return (performance.now() - t0) / iterations;
}

/**
 * Joue `frames` frames. Toutes les boucles passent par cette fonction : échauffée une fois, elle
 * reste optimisée pour les mesures suivantes, y compris celle du tas.
 */
function play(sim: Sim, stream: InputStream, inputs: Uint32Array, frames: number): void {
  for (let f = 0; f < frames; f++) {
    stream.fill(inputs);
    topUpEntities(sim, f);
    stepWithRespawn(sim, inputs);
  }
}

function measure(config: SimConfig): Row[] {
  const sim = createSim(config);
  const stream = new InputStream(1);
  const inputs = new Uint32Array(PLAYERS);
  const snap = new Uint8Array(STATE_BYTES);

  play(sim, stream, inputs, WARMUP_FRAMES);
  for (let f = 0; f < 1000; f++) {
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

  const saveMs = timeLoop(() => saveState(sim, snap), 200_000);
  const loadMs = timeLoop(() => loadState(sim, snap), 200_000);

  // Allocations : le tas ne doit pas grandir pendant que la simulation tourne. Une passe non
  // mesurée d'abord : depuis que le benchmark enchaîne deux scénarios dans une fonction, le premier
  // passage traîne un surcoût unique de compilation (38 Ko au premier scénario, 544 octets au
  // second, 15 Ko pour l'ancien script à une seule boucle). Une allocation par frame resterait
  // visible dans la passe mesurée.
  const gc = (globalThis as { gc?: () => void }).gc;
  let heapGrowthBytes: number | null = null;
  if (gc) {
    play(sim, stream, inputs, HEAP_FRAMES);
    gc();
    const before = process.memoryUsage().heapUsed;
    play(sim, stream, inputs, HEAP_FRAMES);
    const after = process.memoryUsage().heapUsed;
    heapGrowthBytes = after - before;
  }

  return [
    ['step, moyenne', stepMeanMs, LIMITS.stepMeanMs, 'ms'],
    ['step, 99e centile', stepP99Ms, LIMITS.stepP99Ms, 'ms'],
    ['saveState', saveMs, LIMITS.snapshotMs, 'ms'],
    ['loadState', loadMs, LIMITS.snapshotMs, 'ms'],
    ['taille de l’état', STATE_BYTES, LIMITS.stateBytes, 'octets'],
    [`tas après ${HEAP_FRAMES} frames`, heapGrowthBytes, LIMITS.heapGrowthBytes, 'octets'],
  ];
}

let failed = false;
for (const [name, config] of SCENARIOS) {
  console.log(`sim-core, ${PLAYERS} joueurs, ${MEASURED_FRAMES} frames mesurées : ${name}\n`);
  for (const [label, value, limit, unit] of measure(config)) {
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
  console.log('');
}
process.exit(failed ? 1 : 0);
