/**
 * Banc bloquant : sort en erreur si le critère de succès n° 4 de SPEC-netcode.md n'est pas tenu.
 * Lancer avec `pnpm --filter @game/netcode bench`.
 *
 * Pire cas du rollback, répété à chaque frame : 8 joueurs, 16 entités actives, fenêtre de
 * prédiction pleine (15 frames), et une confirmation qui contredit la prédiction à la plus
 * ancienne frame incertaine. Chaque frame coûte donc une restauration, 15 frames re-simulées
 * (avec leurs sauvegardes) et une frame nouvelle. Une vraie partie fait bien moins.
 *
 * Méthode reprise de `packages/input/bench/sample.bench.ts` : la boucle mesurée est une fonction
 * déjà chauffée, et la croissance du tas est mesurée plusieurs fois puis corrigée d'une mesure à
 * vide, pour ne pas compter le code compilé par V8 pendant la mesure.
 */
import {
  MAX_ENTITIES,
  createEntityView,
  createSim,
  frame,
  fx,
  readEntity,
  spawnEntity,
  type Sim,
} from '@game/sim-core';
import { E_BALL, testConfig } from '@game/sim-core/testing';
import { DEFAULT_INPUT_DELAY, DEFAULT_MAX_PREDICTION } from '../src/constants.ts';
import { simGame, stepWithRespawn } from '../src/game.ts';
import { createRollback } from '../src/rollback.ts';

const PLAYERS = 8;
const ENTITIES = 16;
const P = DEFAULT_MAX_PREDICTION;
const WARMUP_FRAMES = 20_000;
const MEASURED_FRAMES = 20_000;
const HEAP_FRAMES = 10_000;
const RUNS = 5;

const LIMITS = {
  frameMeanMs: 1,
  frameP99Ms: 2,
  /** Une seule allocation de 16 octets par frame ferait 160 Ko sur 10 000 frames. */
  heapGrowthBytes: 32 * 1024,
};

const FALL_HEIGHT = fx(50);
const DRIFT = fx(0.3);
const entity = createEntityView();

/**
 * Avance d'une frame en maintenant `ENTITIES` balles en vie. Tout est lu dans l'état de la
 * simulation (entités vivantes, numéro de frame) : la règle reste juste après un rollback.
 */
function advance(sim: Sim, inputs: Uint32Array): void {
  let alive = 0;
  for (let e = 0; e < MAX_ENTITIES; e++) if (readEntity(sim, e, entity)) alive++;
  const f = frame(sim);
  for (let k = alive; k < ENTITIES; k++) {
    const x = ((f * 7 + k * 13) % 100) - 50;
    spawnEntity(sim, E_BALL, -1, x * 4096, FALL_HEIGHT, k % 2 === 0 ? DRIFT : -DRIFT, 0);
  }
  stepWithRespawn(sim, inputs);
}

const sim = createSim(testConfig(PLAYERS, 1));
const rollback = createRollback({
  game: simGame(sim, advance),
  localSlots: [0],
  inputDelay: DEFAULT_INPUT_DELAY,
  maxPrediction: P,
  checksumInterval: 15,
  onChecksum: () => {},
});
const local = new Uint32Array(1);
const one = new Uint32Array(1);
let seed = 0x1234_5678;
function random(): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
}

// Fenêtre pleine dès le départ.
while (rollback.advance(local)) local[0] = random();

/**
 * Une frame du pire cas : confirmation de la plus ancienne frame incertaine pour tous les
 * joueurs, avec pour l'un d'eux une valeur différente de la prédiction ; correction ; frame
 * nouvelle.
 */
function worstFrame(): void {
  const c = rollback.confirmedFrame();
  for (let p = 0; p < PLAYERS; p++) {
    one[0] = p === 1 ? random() : p === 0 ? local[0]! : 0;
    rollback.confirm(p, c, one, 0, 1);
  }
  // La correction a pu être faite dès la confirmation (empreinte due) : sinon, maintenant.
  rollback.reconcile();
  local[0] = random();
  rollback.advance(local);
}

function burst(frames: number): void {
  for (let i = 0; i < frames; i++) worstFrame();
}

burst(WARMUP_FRAMES);
const resimulatedBefore = rollback.stats.resimulated;

const samples = new Float64Array(MEASURED_FRAMES);
for (let i = 0; i < MEASURED_FRAMES; i++) {
  const t0 = performance.now();
  worstFrame();
  samples[i] = performance.now() - t0;
}
const meanDepth = (rollback.stats.resimulated - resimulatedBefore) / MEASURED_FRAMES;
let total = 0;
for (let i = 0; i < MEASURED_FRAMES; i++) total += samples[i]!;
samples.sort();
const frameMeanMs = total / MEASURED_FRAMES;
const frameP99Ms = samples[Math.floor(MEASURED_FRAMES * 0.99)]!;

const gc = (globalThis as { gc?: () => void }).gc;
let heapGrowthBytes: number | null = null;
if (gc) {
  const grow = (frames: number): number => {
    gc();
    const before = process.memoryUsage().heapUsed;
    burst(frames);
    return process.memoryUsage().heapUsed - before;
  };
  for (let r = 0; r < RUNS; r++) {
    const growth = Math.max(0, grow(HEAP_FRAMES) - grow(0));
    heapGrowthBytes = heapGrowthBytes === null ? growth : Math.min(heapGrowthBytes, growth);
  }
}

const rows: [label: string, value: number | null, limit: number, unit: string][] = [
  ['frame, moyenne', frameMeanMs, LIMITS.frameMeanMs, 'ms'],
  ['frame, 99e centile', frameP99Ms, LIMITS.frameP99Ms, 'ms'],
  [`tas après ${HEAP_FRAMES} frames`, heapGrowthBytes, LIMITS.heapGrowthBytes, 'octets'],
];

// La mesure ne vaut que si chaque frame a bien re-simulé toute la fenêtre.
let failed = Math.abs(meanDepth - P) > 1e-9;
console.log(
  `netcode, rollback de ${P} frames + 1 nouvelle, ${PLAYERS} joueurs, ${ENTITIES} entités\n`,
);
if (failed)
  console.log(`ÉCHEC  profondeur moyenne ${meanDepth} au lieu de ${P} : la mesure ne vaut rien`);
else console.log(`ok     profondeur de chaque rollback   ${meanDepth} frames`);
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
