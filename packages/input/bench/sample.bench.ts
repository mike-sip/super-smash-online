/**
 * Benchmark bloquant : sort en erreur si `sample` dépasse le critère de succès n° 6 de
 * SPEC-input.md (moins de 0,05 ms pour tous les joueurs locaux, aucune allocation).
 * Lancer avec `pnpm --filter @game/input bench`.
 *
 * Quatre joueurs locaux : le clavier et trois manettes simulées dont les sticks, les gâchettes et
 * les boutons bougent à chaque appel, pour parcourir les mêmes chemins qu'une vraie partie.
 *
 * Méthode, apprise à nos dépens : une boucle écrite au niveau du module est recompilée par V8
 * pendant qu'elle tourne, et le code compilé compte dans le tas. La boucle mesurée est donc une
 * fonction déjà chauffée, et la mesure elle-même est répétée jusqu'à ce que son propre bruit
 * (premier appel de `process.memoryUsage`, etc.) disparaisse, puis soustraite à vide.
 */
import { createInput, gamepadId, KEYBOARD_ID, MAX_LOCAL_PLAYERS } from '../src/index.ts';
import { fakePad, fakeWindow } from '../test/helpers.ts';

const PLAYERS = MAX_LOCAL_PLAYERS;
const PADS = PLAYERS - 1;
const CALLS = 10_000;
/** Laisse le moteur compiler `sample` et la boucle à leur dernier palier avant de mesurer. */
const WARMUP_BURSTS = 400;
const WARMUP_CALLS = 1_000;
/** Répétitions : la meilleure mesure de temps écarte les pauses de la machine. */
const RUNS = 20;

const LIMITS = {
  sampleMeanMs: 0.05,
  /**
   * « Aucune allocation ». Une seule allocation de 16 octets par appel ferait 160 Ko sur 10 000
   * appels ; une toutes les seize, 10 Ko. Le seuil de 1 Ko absorbe le bruit de la mesure (une
   * centaine d'octets) sans laisser passer une allocation qui se répète.
   */
  heapGrowthBytes: 1024,
};

const fake = fakeWindow();
for (let i = 0; i < PADS; i++) fake.pads.push(fakePad({ index: i, id: `Manette ${i}` }));
const input = createInput({ target: fake.window, players: PLAYERS });
const out = new Uint32Array(PLAYERS);

// Une première lecture fait connaître les manettes, qui peuvent alors être attribuées.
input.sample(out);
input.assign(0, KEYBOARD_ID);
for (let i = 0; i < PADS; i++) input.assign(i + 1, gamepadId(i));
for (let p = 1; p < PLAYERS; p++) input.setTapJump(p, p % 2 === 1);

// Course du stick précalculée : affecter un élément d'un tableau de doubles n'alloue rien.
const STEPS = 256;
const course = new Float64Array(STEPS);
for (let k = 0; k < STEPS; k++) course[k] = Math.sin((k / STEPS) * 2 * Math.PI);

/** Fait bouger les manettes : sticks qui tournent, boutons et gâchette qui s'alternent. */
function wiggle(call: number): void {
  for (let i = 0; i < PADS; i++) {
    const pad = fake.pads[i]!;
    const k = (call + i * 37) & (STEPS - 1);
    pad.axes[0] = course[k]!;
    pad.axes[1] = course[(k + STEPS / 4) & (STEPS - 1)]!;
    pad.axes[2] = course[(k * 3) & (STEPS - 1)]!;
    const phase = (call >> 3) + i;
    const jump = pad.buttons[0]!;
    jump.pressed = (phase & 1) === 0;
    jump.value = jump.pressed ? 1 : 0;
    const trigger = pad.buttons[7]!;
    trigger.value = (phase & 2) === 0 ? 1 : 0;
    trigger.pressed = trigger.value === 1;
  }
}

/** Boucle mesurée : manettes en mouvement, puis lecture, `calls` fois. */
function burst(calls: number): void {
  for (let c = 0; c < calls; c++) {
    wiggle(c);
    input.sample(out);
  }
}

// Échauffement. Le joueur au clavier marche à droite et saute entre deux salves : les événements
// clavier allouent (dans Node comme dans le navigateur), ils restent donc hors des mesures.
fake.keyDown('ArrowRight');
for (let b = 0; b < WARMUP_BURSTS; b++) {
  if (b % 2 === 0) fake.keyDown('Space');
  else fake.keyUp('Space');
  burst(WARMUP_CALLS);
}
let reached = 0;
for (let p = 0; p < PLAYERS; p++) if (out[p] !== 0) reached++;

// Temps : un appel est trop court pour être chronométré seul. Les manettes simulées sont mises en
// mouvement dans la même boucle : leur coût est compté avec celui de `sample`, ce qui ne peut que
// surestimer ce dernier.
let best = Infinity;
for (let r = 0; r < RUNS; r++) {
  const t0 = performance.now();
  burst(CALLS);
  best = Math.min(best, performance.now() - t0);
}
const sampleMeanMs = best / CALLS;

// Allocations : croissance du tas pendant 10 000 lectures, moins celle d'une mesure à vide.
const gc = (globalThis as { gc?: () => void }).gc;
let heapGrowthBytes: number | null = null;
if (gc) {
  const grow = (calls: number): number => {
    gc();
    const before = process.memoryUsage().heapUsed;
    burst(calls);
    return process.memoryUsage().heapUsed - before;
  };
  for (let r = 0; r < RUNS; r++) {
    const growth = Math.max(0, grow(CALLS) - grow(0));
    heapGrowthBytes = heapGrowthBytes === null ? growth : Math.min(heapGrowthBytes, growth);
  }
}
input.dispose();

const rows: [label: string, value: number | null, limit: number, unit: string][] = [
  ['sample, moyenne', sampleMeanMs, LIMITS.sampleMeanMs, 'ms'],
  [`tas après ${CALLS} appels`, heapGrowthBytes, LIMITS.heapGrowthBytes, 'octets'],
];

let failed = reached !== PLAYERS;
console.log(`input, ${PLAYERS} joueurs locaux (clavier et ${PADS} manettes simulées)\n`);
if (failed) console.log(`ÉCHEC  ${reached} joueurs lus sur ${PLAYERS} : la mesure ne vaut rien`);
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
