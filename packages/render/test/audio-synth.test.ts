import { describe, expect, it } from 'vitest';
import { SND_HIT_STRONG, SND_HIT_WEAK, SOUND_COUNT, SOUND_NAMES } from '../src/audio/cues.ts';
import { renderSound } from '../src/audio/sounds.ts';
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
  envelope,
  filter,
  nextNoise,
  normalize,
  peak,
  rms,
  softClip,
} from '../src/audio/synth.ts';

const SR = SAMPLE_RATE;

/** Passages par zéro vers le haut : une sinusoïde de f Hz en fait f par seconde. */
function upCrossings(buf: Float32Array): number {
  let count = 0;
  for (let i = 1; i < buf.length; i++) if (buf[i - 1]! < 0 && buf[i]! >= 0) count++;
  return count;
}

function sine(freq: number, seconds = 1): Float32Array {
  const out = new Float32Array(SR * seconds);
  addTone(out, { wave: WAVE_SINE, freq, attack: 0, decay: 0, sustain: 1, gate: seconds, gain: 1 });
  return out;
}

/** Part de l'énergie sous ~200 Hz : plus elle est grande, plus le son est grave. */
function lowShare(buf: Float32Array): number {
  const low = Float32Array.from(buf);
  filter(low, FILTER_LOW, 200, 200, 0.707);
  return rms(low) / Math.max(1e-9, rms(buf));
}

describe('oscillateurs', () => {
  it('produisent la fréquence demandée, pour chaque forme d’onde', () => {
    for (const wave of [WAVE_SINE, WAVE_TRIANGLE, WAVE_SQUARE, WAVE_SAW]) {
      const out = new Float32Array(SR);
      addTone(out, { wave, freq: 441, attack: 0, decay: 0, sustain: 1, gate: 1, gain: 0.5 });
      expect(Math.abs(upCrossings(out) - 441)).toBeLessThanOrEqual(2);
      expect(peak(out)).toBeLessThanOrEqual(0.5 * 1.1);
      expect(peak(out)).toBeGreaterThan(0.4);
    }
  });

  it('glissent d’une fréquence à l’autre', () => {
    const out = new Float32Array(SR);
    addTone(out, {
      wave: WAVE_SINE,
      freq: 200,
      freqEnd: 800,
      sweep: 0.5,
      attack: 0,
      decay: 0,
      sustain: 1,
      gate: 1,
      gain: 1,
    });
    // Seconde moitié : 800 Hz tenus.
    expect(Math.abs(upCrossings(out.subarray(SR / 2)) - 400)).toBeLessThanOrEqual(2);
    expect(upCrossings(out.subarray(0, SR / 10))).toBeLessThan(30);
  });

  it('commencent à l’instant demandé et s’ajoutent à ce qui est déjà là', () => {
    const out = new Float32Array(SR / 10).fill(0.25);
    addTone(out, {
      wave: WAVE_SINE,
      freq: 100,
      start: 0.05,
      attack: 0,
      decay: 0,
      sustain: 1,
      gate: 1,
      gain: 0.5,
    });
    expect(out[100]).toBe(0.25);
    expect(peak(out)).toBeGreaterThan(0.7);
  });
});

describe('enveloppe', () => {
  // Attaque 0,1 s, chute 0,2 s vers 0,5, tenue jusqu'à 0,5 s, relâche 0,1 s.
  const env = (t: number): number => envelope(t, 0.1, 0.2, 0.5, 0.1, 0.5);

  it('monte, chute, tient puis s’éteint', () => {
    expect(env(0)).toBe(0);
    expect(env(0.05)).toBeCloseTo(0.5, 6);
    expect(env(0.1)).toBeCloseTo(1, 6);
    expect(env(0.2)).toBeLessThan(1);
    expect(env(0.2)).toBeGreaterThan(0.5);
    expect(env(0.4)).toBeCloseTo(0.5, 6);
    expect(env(0.55)).toBeLessThan(0.5);
    expect(env(0.6)).toBeCloseTo(0, 9);
    expect(env(2)).toBe(0);
  });

  it('est continue', () => {
    let prev = env(0);
    for (let t = 0.001; t < 0.7; t += 0.001) {
      const value = env(t);
      expect(Math.abs(value - prev)).toBeLessThan(0.05);
      prev = value;
    }
  });

  it('frappe sans attaque', () => {
    expect(envelope(0, 0, 0.1, 0, 0, 0.1)).toBe(1);
  });
});

describe('bruit', () => {
  it('est reproductible, centré et borné', () => {
    const a = createNoise(7);
    const b = createNoise(7);
    let sum = 0;
    for (let i = 0; i < 10_000; i++) {
      const value = nextNoise(a);
      expect(value).toBe(nextNoise(b));
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThan(1);
      sum += value;
    }
    expect(Math.abs(sum / 10_000)).toBeLessThan(0.05);
    expect(nextNoise(createNoise(8))).not.toBe(nextNoise(createNoise(7)));
  });

  it('suit son enveloppe', () => {
    const out = new Float32Array(SR / 2);
    addNoise(out, { seed: 1, attack: 0, decay: 0.1, sustain: 0, gate: 0.1, gain: 1 });
    expect(rms(out.subarray(0, SR / 50))).toBeGreaterThan(0.2);
    expect(peak(out.subarray(SR / 5))).toBe(0);
  });
});

describe('filtres', () => {
  it('le passe-bas laisse les graves et coupe les aigus', () => {
    const low = sine(100);
    const high = sine(8000);
    filter(low, FILTER_LOW, 500, 500, 0.707);
    filter(high, FILTER_LOW, 500, 500, 0.707);
    expect(rms(low.subarray(SR / 2))).toBeGreaterThan(0.6);
    expect(rms(high.subarray(SR / 2))).toBeLessThan(0.03);
  });

  it('le passe-haut fait l’inverse', () => {
    const low = sine(100);
    const high = sine(8000);
    filter(low, FILTER_HIGH, 2000, 2000, 0.707);
    filter(high, FILTER_HIGH, 2000, 2000, 0.707);
    expect(rms(low.subarray(SR / 2))).toBeLessThan(0.03);
    expect(rms(high.subarray(SR / 2))).toBeGreaterThan(0.6);
  });

  it('le passe-bande garde le milieu', () => {
    const [low, mid, high] = [sine(100), sine(1000), sine(10000)];
    for (const buf of [low, mid, high]) filter(buf, FILTER_BAND, 1000, 1000, 2);
    const midLevel = rms(mid.subarray(SR / 2));
    expect(midLevel).toBeGreaterThan(0.5);
    expect(rms(low.subarray(SR / 2))).toBeLessThan(midLevel / 5);
    expect(rms(high.subarray(SR / 2))).toBeLessThan(midLevel / 5);
  });

  it('balaie sa fréquence de coupure', () => {
    const buf = sine(3000);
    filter(buf, FILTER_LOW, 20000, 300, 0.707);
    expect(rms(buf.subarray(0, SR / 20))).toBeGreaterThan(0.5);
    expect(rms(buf.subarray(SR - SR / 20))).toBeLessThan(0.05);
  });
});

describe('mise en forme', () => {
  it('normalise à la crête demandée', () => {
    const buf = sine(440);
    normalize(buf, 0.5);
    expect(peak(buf)).toBeCloseTo(0.5, 5);
    const silent = new Float32Array(10);
    normalize(silent, 0.5);
    expect(peak(silent)).toBe(0);
  });

  it('sature en douceur, sans dépasser 1', () => {
    const buf = Float32Array.from([0, 0.1, 2, -5]);
    softClip(buf, 2);
    expect(buf[0]).toBe(0);
    expect(buf[1]).toBeGreaterThan(0.1);
    expect(buf[2]).toBeLessThanOrEqual(1);
    expect(buf[3]).toBeGreaterThanOrEqual(-1);
  });
});

describe('sons du jeu', () => {
  const rendered = Array.from({ length: SOUND_COUNT }, (_, id) => renderSound(id));

  it('sont tous non vides, finis, sans saturation, de durée bornée', () => {
    rendered.forEach((buf, id) => {
      const name = SOUND_NAMES[id];
      expect(buf.length / SR, name).toBeGreaterThanOrEqual(0.04);
      expect(buf.length / SR, name).toBeLessThanOrEqual(1.5);
      expect(buf.every(Number.isFinite), name).toBe(true);
      expect(peak(buf), name).toBeGreaterThanOrEqual(0.5);
      expect(peak(buf), name).toBeLessThanOrEqual(1);
      // Pas de clic à la fin : le son s'est éteint.
      expect(peak(buf.subarray(buf.length - 32)), name).toBeLessThan(0.02);
    });
  });

  it('sont identiques d’un calcul à l’autre', () => {
    for (let id = 0; id < SOUND_COUNT; id++) expect(renderSound(id)).toEqual(rendered[id]);
  });

  it('sont deux à deux différents', () => {
    for (let a = 0; a < SOUND_COUNT; a++) {
      for (let b = a + 1; b < SOUND_COUNT; b++) {
        const x = rendered[a]!;
        const y = rendered[b]!;
        const n = Math.min(x.length, y.length);
        let dot = 0;
        for (let i = 0; i < n; i++) dot += x[i]! * y[i]!;
        const correlation = dot / (rms(x) * rms(y) * Math.sqrt(x.length * y.length));
        expect(Math.abs(correlation), `${SOUND_NAMES[a]} / ${SOUND_NAMES[b]}`).toBeLessThan(0.9);
      }
    }
  });

  it('font sonner un coup fort plus long et plus grave qu’un coup faible', () => {
    const weak = rendered[SND_HIT_WEAK]!;
    const strong = rendered[SND_HIT_STRONG]!;
    expect(strong.length).toBeGreaterThan(weak.length * 2);
    expect(lowShare(strong)).toBeGreaterThan(lowShare(weak));
  });

  it('rejettent un identifiant inconnu', () => {
    expect(() => renderSound(SOUND_COUNT)).toThrow();
  });

  it('se calculent vite', () => {
    const started = performance.now();
    for (let id = 0; id < SOUND_COUNT; id++) renderSound(id);
    const ms = performance.now() - started;
    process.stdout.write(`\nSynthèse des ${SOUND_COUNT} effets : ${ms.toFixed(1)} ms\n`);
    expect(ms).toBeLessThan(500);
  });
});
