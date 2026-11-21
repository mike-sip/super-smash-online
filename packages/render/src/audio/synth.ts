/**
 * Primitives de synthèse, hors temps réel : oscillateurs, bruit, enveloppes, filtres.
 *
 * Tout écrit dans des `Float32Array` fournis par l'appelant, en ajoutant à ce qui s'y trouve
 * (les couches d'un son se superposent). Logique pure et reproductible : même appel, mêmes
 * échantillons, dans Node comme dans le navigateur. Ce code tourne au chargement, jamais par frame.
 */

/** Fréquence d'échantillonnage de la synthèse ; le navigateur rééchantillonne au besoin. */
export const SAMPLE_RATE = 44_100;

export const WAVE_SINE = 0;
export const WAVE_TRIANGLE = 1;
export const WAVE_SQUARE = 2;
export const WAVE_SAW = 3;

export const FILTER_LOW = 0;
export const FILTER_BAND = 1;
export const FILTER_HIGH = 2;

const TAU = Math.PI * 2;

/**
 * Enveloppe à l'instant `t` (secondes) : montée linéaire en `attack`, chute vers `sustain` en
 * `decay`, tenue jusqu'à `gate`, extinction en `release`. Les chutes sont courbes (rapides au
 * début), comme un son réel qui s'amortit. Toujours entre 0 et 1, et continue.
 */
export function envelope(
  t: number,
  attack: number,
  decay: number,
  sustain: number,
  release: number,
  gate: number,
): number {
  if (t < 0) return 0;
  if (t >= gate) {
    if (release <= 0) return 0;
    const u = (t - gate) / release;
    if (u >= 1) return 0;
    const from = envelope(gate, attack, decay, sustain, 0, Infinity);
    return from * (1 - u) * (1 - u);
  }
  if (t < attack) return t / attack;
  const d = t - attack;
  if (d < decay) {
    const v = 1 - d / decay;
    return sustain + (1 - sustain) * v * v;
  }
  return sustain;
}

/** Paramètres communs d'une couche : début et enveloppe, en secondes ; gain de crête. */
export interface LayerParams {
  /** Début dans le tampon, en secondes ; 0 par défaut. */
  readonly start?: number;
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  /** Extinction après `gate` ; 0 par défaut. */
  readonly release?: number;
  /** Instant où commence l'extinction, compté depuis le début de la couche. */
  readonly gate: number;
  readonly gain: number;
  /** Position stéréo de -1 (gauche) à 1 (droite) ; ne sert que si un tampon droit est fourni. */
  readonly pan?: number;
}

export interface ToneParams extends LayerParams {
  readonly wave: number;
  readonly freq: number;
  /** Fréquence atteinte au bout de `sweep` secondes, par glissement exponentiel. */
  readonly freqEnd?: number;
  readonly sweep?: number;
}

export interface NoiseParams extends LayerParams {
  readonly seed: number;
}

/** Correction des discontinuités des ondes carrée et en dent de scie (moins de repliement). */
function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

function oscillator(wave: number, phase: number, dt: number): number {
  switch (wave) {
    case WAVE_SINE:
      return Math.sin(TAU * phase);
    case WAVE_TRIANGLE:
      return 1 - 4 * Math.abs(phase - 0.5);
    case WAVE_SQUARE: {
      const shifted = phase + 0.5 >= 1 ? phase - 0.5 : phase + 0.5;
      return (phase < 0.5 ? 1 : -1) + polyBlep(phase, dt) - polyBlep(shifted, dt);
    }
    case WAVE_SAW:
      return 2 * phase - 1 - polyBlep(phase, dt);
    default:
      throw new Error(`Forme d'onde inconnue : ${wave}`);
  }
}

/** Bornes, en échantillons, d'une couche dans un tampon de `length` échantillons. */
function span(p: LayerParams, length: number, sampleRate: number): [from: number, to: number] {
  const from = Math.round((p.start ?? 0) * sampleRate);
  const to = Math.min(length, from + Math.ceil((p.gate + (p.release ?? 0)) * sampleRate));
  return [Math.max(0, from), to];
}

/** Gains gauche et droite d'une position stéréo, à puissance constante. */
function panGains(pan: number | undefined): [left: number, right: number] {
  const angle = ((Math.max(-1, Math.min(1, pan ?? 0)) + 1) * Math.PI) / 4;
  return [Math.cos(angle), Math.sin(angle)];
}

/**
 * Ajoute un son tenu à `out` (et à `right` pour la stéréo, `out` étant alors le canal gauche).
 */
export function addTone(
  out: Float32Array,
  p: ToneParams,
  sampleRate = SAMPLE_RATE,
  right?: Float32Array,
): void {
  const [from, to] = span(p, out.length, sampleRate);
  const release = p.release ?? 0;
  const sweepSamples = p.freqEnd === undefined ? 0 : Math.max(1, (p.sweep ?? 0) * sampleRate);
  const ratio = sweepSamples > 0 ? Math.pow(p.freqEnd! / p.freq, 1 / sweepSamples) : 1;
  const [gl, gr] = right === undefined ? [1, 0] : panGains(p.pan);
  let freq = p.freq;
  let phase = 0;
  for (let i = from; i < to; i++) {
    const n = i - from;
    const dt = freq / sampleRate;
    const value =
      oscillator(p.wave, phase, dt) *
      envelope(n / sampleRate, p.attack, p.decay, p.sustain, release, p.gate) *
      p.gain;
    out[i] = out[i]! + value * gl;
    if (right !== undefined) right[i] = right[i]! + value * gr;
    phase += dt;
    if (phase >= 1) phase -= 1;
    if (n < sweepSamples) freq *= ratio;
  }
}

/** Générateur de bruit blanc à graine (congruence linéaire) : reproductible partout. */
export interface Noise {
  state: number;
}

export function createNoise(seed: number): Noise {
  return { state: seed >>> 0 || 1 };
}

/** Valeur suivante, dans [-1, 1). */
export function nextNoise(noise: Noise): number {
  noise.state = (Math.imul(noise.state, 1664525) + 1013904223) >>> 0;
  return noise.state / 2147483648 - 1;
}

/** Ajoute du bruit blanc enveloppé à `out` (et à `right` pour la stéréo). */
export function addNoise(
  out: Float32Array,
  p: NoiseParams,
  sampleRate = SAMPLE_RATE,
  right?: Float32Array,
): void {
  const [from, to] = span(p, out.length, sampleRate);
  const release = p.release ?? 0;
  const noise = createNoise(p.seed);
  const [gl, gr] = right === undefined ? [1, 0] : panGains(p.pan);
  for (let i = from; i < to; i++) {
    const t = (i - from) / sampleRate;
    const value =
      nextNoise(noise) * envelope(t, p.attack, p.decay, p.sustain, release, p.gate) * p.gain;
    out[i] = out[i]! + value * gl;
    if (right !== undefined) right[i] = right[i]! + value * gr;
  }
}

/** Échantillons entre deux recalculs du filtre pendant un balayage. */
const FILTER_BLOCK = 16;

/** Échantillons de fin de boucle passés dans le filtre avant le début, pour un raccord sans saut. */
const LOOP_WARMUP = 8192;

/**
 * Filtre `buf` sur place (filtre à variable d'état, 12 dB par octave), entre les échantillons
 * `from` et `to`. La fréquence de coupure glisse exponentiellement de `cutoffStart` à
 * `cutoffEnd` ; `q` règle la résonance (0,707 : aucune).
 *
 * `loop` : le tampon est une boucle. Le filtre parcourt d'abord la fin du tampon sans l'écrire,
 * pour aborder le début avec l'état qu'il aurait en sortant de la fin.
 */
export function filter(
  buf: Float32Array,
  mode: number,
  cutoffStart: number,
  cutoffEnd: number,
  q: number,
  sampleRate = SAMPLE_RATE,
  from = 0,
  to = buf.length,
  loop = false,
): void {
  const k = 1 / q;
  const nyquistSafe = sampleRate * 0.45;
  const count = Math.max(1, to - from);
  const ratio = Math.pow(cutoffEnd / cutoffStart, 1 / count);
  let cutoff = cutoffStart;
  let ic1 = 0;
  let ic2 = 0;
  let a1 = 0;
  let a2 = 0;
  let a3 = 0;
  const coefficients = (fc: number): void => {
    const g = Math.tan((Math.PI * Math.min(nyquistSafe, fc)) / sampleRate);
    a1 = 1 / (1 + g * (g + k));
    a2 = g * a1;
    a3 = g * a2;
  };
  if (loop) {
    coefficients(cutoffEnd);
    for (let i = Math.max(from, to - LOOP_WARMUP); i < to; i++) {
      const v3 = buf[i]! - ic2;
      const v1 = a1 * ic1 + a2 * v3;
      const v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1;
      ic2 = 2 * v2 - ic2;
    }
  }
  for (let i = from; i < to; i++) {
    if ((i - from) % FILTER_BLOCK === 0) coefficients(cutoff);
    cutoff *= ratio;
    const v0 = buf[i]!;
    const v3 = v0 - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    buf[i] = mode === FILTER_LOW ? v2 : mode === FILTER_BAND ? v1 : v0 - k * v1 - v2;
  }
}

/** Saturation douce sur place : arrondit les crêtes, épaissit le son, ne dépasse jamais 1. */
export function softClip(buf: Float32Array, drive: number): void {
  const norm = Math.tanh(drive);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = Math.max(-1, Math.min(1, Math.tanh(buf[i]! * drive) / norm));
  }
}

/** Crête absolue. */
export function peak(buf: Float32Array): number {
  let max = 0;
  for (let i = 0; i < buf.length; i++) {
    const value = Math.abs(buf[i]!);
    if (value > max) max = value;
  }
  return max;
}

/** Niveau efficace (racine de la moyenne des carrés). */
export function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
  return Math.sqrt(sum / Math.max(1, buf.length));
}

/** Met la crête à `target` ; un tampon silencieux reste silencieux. */
export function normalize(buf: Float32Array, target: number): void {
  const max = peak(buf);
  if (max === 0) return;
  const scale = target / max;
  for (let i = 0; i < buf.length; i++) buf[i] = buf[i]! * scale;
}

/** Ajoute `src` multiplié par `gain` à `out`, à partir de l'échantillon `offset`. */
export function mixInto(out: Float32Array, src: Float32Array, gain: number, offset = 0): void {
  const end = Math.min(out.length, offset + src.length);
  for (let i = Math.max(0, offset); i < end; i++) out[i] = out[i]! + src[i - offset]! * gain;
}
