/**
 * Recettes des effets sonores : une fonction par son, superposition de couches simples.
 *
 * Chaque recette est courte et paramétrée pour être retouchée vite après écoute. Les valeurs sont
 * en secondes et en hertz. Les sons sont normalisés à la même crête : leur volume relatif en jeu
 * est réglé par le mélangeur (`mixer.ts`), pas ici.
 */
import {
  SND_DOUBLE_JUMP,
  SND_ENTITY_BREAK,
  SND_ENTITY_SPAWN,
  SND_GRAB,
  SND_HIT_MEDIUM,
  SND_HIT_STRONG,
  SND_HIT_WEAK,
  SND_JUMP,
  SND_KO,
  SND_LAND,
  SND_LEDGE,
  SND_PARRY,
  SND_SHIELD,
  SND_SHIELD_BREAK,
} from './cues.ts';
import {
  FILTER_BAND,
  FILTER_HIGH,
  FILTER_LOW,
  SAMPLE_RATE,
  WAVE_SAW,
  WAVE_SINE,
  WAVE_SQUARE,
  WAVE_TRIANGLE,
  addNoise,
  addTone,
  createNoise,
  filter,
  mixInto,
  nextNoise,
  normalize,
  softClip,
  type NoiseParams,
  type ToneParams,
} from './synth.ts';

/** Crête commune de tous les effets. */
const PEAK = 0.9;
/** Fondu final, contre tout clic en fin de tampon. */
const TAIL_FADE = 0.01;

interface Builder {
  readonly out: Float32Array;
  readonly sr: number;
}

/** Couche percussive : attaque `attack`, amortie en `decay`, sans tenue. */
function perc(attack: number, decay: number, gain: number, start = 0) {
  return { start, attack, decay, sustain: 0, gate: attack + decay, gain };
}

function tone(b: Builder, p: ToneParams): void {
  addTone(b.out, p, b.sr);
}

/** Bruit filtré : `mode` et une coupure qui glisse de `from` à `to`. */
function noise(
  b: Builder,
  p: Omit<NoiseParams, 'seed'> & { seed?: number },
  mode: number,
  from: number,
  to = from,
  q = 0.707,
): void {
  const layer = new Float32Array(b.out.length);
  addNoise(layer, { seed: 1, ...p }, b.sr);
  filter(layer, mode, from, to, q, b.sr);
  mixInto(b.out, layer, 1);
}

function hitWeak(b: Builder): void {
  noise(b, perc(0.001, 0.05, 0.8), FILTER_BAND, 2600, 1200, 1.2);
  tone(b, { wave: WAVE_SINE, freq: 230, freqEnd: 90, sweep: 0.08, ...perc(0.001, 0.1, 0.9) });
}

function hitMedium(b: Builder): void {
  noise(b, perc(0.001, 0.09, 1), FILTER_BAND, 1900, 700, 1);
  tone(b, { wave: WAVE_SINE, freq: 170, freqEnd: 58, sweep: 0.14, ...perc(0.001, 0.2, 1) });
  tone(b, { wave: WAVE_TRIANGLE, freq: 340, freqEnd: 120, sweep: 0.06, ...perc(0.001, 0.06, 0.3) });
  softClip(b.out, 1.5);
}

function hitStrong(b: Builder): void {
  noise(b, perc(0.001, 0.22, 1.1), FILTER_LOW, 6000, 350);
  noise(b, { seed: 2, ...perc(0, 0.02, 0.6) }, FILTER_HIGH, 3000);
  tone(b, { wave: WAVE_SINE, freq: 120, freqEnd: 36, sweep: 0.3, ...perc(0.001, 0.45, 1.3) });
  tone(b, { wave: WAVE_SQUARE, freq: 90, freqEnd: 40, sweep: 0.12, ...perc(0.001, 0.14, 0.25) });
  softClip(b.out, 2.2);
}

function shield(b: Builder): void {
  // Partiels inharmoniques : un timbre de métal, pas une note.
  tone(b, { wave: WAVE_SINE, freq: 1150, ...perc(0.001, 0.18, 0.6) });
  tone(b, { wave: WAVE_SINE, freq: 1710, ...perc(0.001, 0.12, 0.4) });
  tone(b, { wave: WAVE_SINE, freq: 2430, ...perc(0.001, 0.08, 0.25) });
  noise(b, perc(0, 0.012, 0.4), FILTER_HIGH, 4000);
  tone(b, { wave: WAVE_SINE, freq: 260, freqEnd: 180, sweep: 0.05, ...perc(0.001, 0.05, 0.3) });
}

function parry(b: Builder): void {
  tone(b, { wave: WAVE_SINE, freq: 880, freqEnd: 1320, sweep: 0.05, ...perc(0.002, 0.5, 0.6) });
  tone(b, { wave: WAVE_SINE, freq: 1760, freqEnd: 2640, sweep: 0.05, ...perc(0.002, 0.35, 0.35) });
  tone(b, { wave: WAVE_TRIANGLE, freq: 2637, ...perc(0.03, 0.4, 0.2, 0.04) });
  noise(b, perc(0, 0.03, 0.25), FILTER_HIGH, 6000);
}

function shieldBreak(b: Builder): void {
  noise(b, perc(0, 0.5, 0.8), FILTER_HIGH, 2500, 5000);
  tone(b, { wave: WAVE_SINE, freq: 300, freqEnd: 55, sweep: 0.6, ...perc(0.002, 0.7, 0.8) });
  // Éclats : des tintements aigus semés sur les premières centaines de millisecondes.
  const shards = createNoise(5);
  for (let n = 0; n < 9; n++) {
    const freq = 2200 + (nextNoise(shards) + 1) * 1500;
    const start = n * 0.035 + (nextNoise(shards) + 1) * 0.01;
    tone(b, { wave: WAVE_SINE, freq, ...perc(0.001, 0.12, 0.22, start) });
  }
  softClip(b.out, 1.4);
}

function ko(b: Builder): void {
  tone(b, { wave: WAVE_SINE, freq: 92, freqEnd: 28, sweep: 0.8, ...perc(0.002, 1.1, 1.2) });
  noise(b, perc(0.01, 1, 0.9), FILTER_LOW, 3200, 140);
  noise(b, { seed: 3, ...perc(0, 0.03, 0.7) }, FILTER_HIGH, 2500);
  tone(b, { wave: WAVE_SINE, freq: 1568, ...perc(0.01, 0.6, 0.22, 0.05) });
  tone(b, { wave: WAVE_SINE, freq: 2093, ...perc(0.01, 0.5, 0.14, 0.12) });
  softClip(b.out, 1.8);
}

function grab(b: Builder): void {
  noise(b, perc(0.001, 0.04, 0.9), FILTER_BAND, 900, 900, 2);
  tone(b, { wave: WAVE_SINE, freq: 160, freqEnd: 110, sweep: 0.05, ...perc(0.001, 0.07, 0.6) });
}

function ledge(b: Builder): void {
  noise(b, perc(0, 0.008, 0.7), FILTER_HIGH, 2000);
  tone(b, { wave: WAVE_TRIANGLE, freq: 520, freqEnd: 470, sweep: 0.05, ...perc(0.001, 0.05, 0.5) });
}

function jump(b: Builder): void {
  tone(b, { wave: WAVE_TRIANGLE, freq: 280, freqEnd: 620, sweep: 0.09, ...perc(0.005, 0.12, 0.7) });
  noise(b, perc(0.002, 0.05, 0.15), FILTER_BAND, 1500, 1500, 1);
}

function doubleJump(b: Builder): void {
  tone(b, { wave: WAVE_TRIANGLE, freq: 420, freqEnd: 980, sweep: 0.1, ...perc(0.005, 0.16, 0.6) });
  tone(b, { wave: WAVE_SINE, freq: 840, freqEnd: 1960, sweep: 0.1, ...perc(0.005, 0.12, 0.2) });
  noise(b, perc(0.02, 0.12, 0.25), FILTER_HIGH, 3000, 6000);
}

function land(b: Builder): void {
  noise(b, perc(0.001, 0.05, 0.9), FILTER_LOW, 900, 200);
  tone(b, { wave: WAVE_SINE, freq: 130, freqEnd: 70, sweep: 0.05, ...perc(0.001, 0.06, 0.6) });
}

function entitySpawn(b: Builder): void {
  const layer = new Float32Array(b.out.length);
  addTone(
    layer,
    { wave: WAVE_SAW, freq: 1400, freqEnd: 380, sweep: 0.12, ...perc(0.002, 0.14, 0.35) },
    b.sr,
  );
  filter(layer, FILTER_LOW, 5000, 1500, 0.9, b.sr);
  mixInto(b.out, layer, 1);
  tone(b, { wave: WAVE_SINE, freq: 1400, freqEnd: 380, sweep: 0.12, ...perc(0.002, 0.14, 0.3) });
}

function entityBreak(b: Builder): void {
  noise(b, perc(0.001, 0.07, 0.8), FILTER_BAND, 1200, 700, 1);
  tone(b, { wave: WAVE_SINE, freq: 700, freqEnd: 180, sweep: 0.08, ...perc(0.001, 0.09, 0.5) });
}

/** Recette et durée de chaque son, dans l'ordre des identifiants `SND_*`. */
const RECIPES: Record<number, [seconds: number, build: (b: Builder) => void]> = {
  [SND_HIT_WEAK]: [0.14, hitWeak],
  [SND_HIT_MEDIUM]: [0.26, hitMedium],
  [SND_HIT_STRONG]: [0.52, hitStrong],
  [SND_SHIELD]: [0.22, shield],
  [SND_PARRY]: [0.6, parry],
  [SND_SHIELD_BREAK]: [0.9, shieldBreak],
  [SND_KO]: [1.3, ko],
  [SND_GRAB]: [0.12, grab],
  [SND_LEDGE]: [0.09, ledge],
  [SND_JUMP]: [0.14, jump],
  [SND_DOUBLE_JUMP]: [0.19, doubleJump],
  [SND_LAND]: [0.1, land],
  [SND_ENTITY_SPAWN]: [0.16, entitySpawn],
  [SND_ENTITY_BREAK]: [0.14, entityBreak],
};

/** Calcule les échantillons (mono) du son `id`. */
export function renderSound(id: number, sampleRate = SAMPLE_RATE): Float32Array {
  const recipe = RECIPES[id];
  if (recipe === undefined) throw new Error(`Son inconnu : ${id}`);
  const [seconds, build] = recipe;
  const out = new Float32Array(Math.ceil(seconds * sampleRate));
  build({ out, sr: sampleRate });
  normalize(out, PEAK);
  const fade = Math.min(out.length, Math.ceil(TAIL_FADE * sampleRate));
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] = out[out.length - 1 - i]! * (i / fade);
  return out;
}
