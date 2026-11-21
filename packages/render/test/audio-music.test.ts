import { describe, expect, it } from 'vitest';
import {
  ARENA_STYLE,
  BARS,
  INS_BASS,
  INS_KICK,
  INS_LEAD,
  INS_PAD,
  MELODIC,
  STEPS_PER_BAR,
  compose,
  createMusicRender,
  degreeToPitch,
  loopSeconds,
  midiToFrequency,
  renderMusic,
  type Composition,
} from '../src/audio/music.ts';
import { SAMPLE_RATE } from '../src/audio/synth.ts';

/** Fréquence réduite pour garder les tests rapides ; la logique ne dépend pas de la valeur. */
const SR = 22_050;

const pitchClass = (pitch: number, root: number): number => (((pitch - root) % 12) + 12) % 12;

describe('composition', () => {
  const song = compose(ARENA_STYLE);

  it('convertit degrés et notes', () => {
    expect(degreeToPitch(ARENA_STYLE, 0, 0)).toBe(45);
    expect(degreeToPitch(ARENA_STYLE, 7, 0)).toBe(57);
    expect(degreeToPitch(ARENA_STYLE, 2, 1)).toBe(60);
    expect(degreeToPitch(ARENA_STYLE, -1, 0)).toBe(43);
    expect(midiToFrequency(69)).toBe(440);
    expect(midiToFrequency(57)).toBeCloseTo(220, 9);
  });

  it('dure seize mesures au tempo du style', () => {
    expect(song.bars).toBe(BARS);
    expect(loopSeconds(song)).toBeCloseTo((16 * 4 * 60) / 150, 9);
    for (const note of song.notes) {
      expect(note.start).toBeGreaterThanOrEqual(0);
      expect(note.start).toBeLessThan(BARS * STEPS_PER_BAR);
      expect(note.length).toBeGreaterThan(0);
      expect(note.velocity).toBeGreaterThan(0);
      expect(note.velocity).toBeLessThanOrEqual(1);
      expect(Math.abs(note.pan)).toBeLessThanOrEqual(1);
    }
  });

  it('ne joue que des notes de la gamme', () => {
    const allowed = new Set(ARENA_STYLE.scale);
    const melodic = song.notes.filter((n) => MELODIC.includes(n.instrument));
    expect(melodic.length).toBeGreaterThan(100);
    for (const note of melodic) expect(allowed.has(pitchClass(note.pitch, 45))).toBe(true);
  });

  it('pose la basse sur la fondamentale de l’accord de chaque mesure', () => {
    for (const note of song.notes.filter((n) => n.instrument === INS_BASS)) {
      const chord = song.chords[Math.floor(note.start / STEPS_PER_BAR)]!;
      expect(pitchClass(note.pitch, 45)).toBe(ARENA_STYLE.scale[chord]);
    }
  });

  it('a un thème répété : mesures 4-5 et 6-7 au même rythme', () => {
    const lead = (bar: number) =>
      song.notes
        .filter((n) => n.instrument === INS_LEAD)
        .filter((n) => Math.floor(n.start / (2 * STEPS_PER_BAR)) === bar / 2)
        .map((n) => n.start - bar * STEPS_PER_BAR);
    expect(lead(4).length).toBeGreaterThan(3);
    expect(lead(6)).toEqual(lead(4));
    // Pas de mélodie dans l'introduction ni dans le pont.
    expect(lead(0)).toEqual([]);
    expect(lead(12)).toEqual([]);
  });

  it('a une pulsation de grosse caisse hors du pont', () => {
    const kicks = song.notes.filter((n) => n.instrument === INS_KICK && n.start < 12 * 16);
    expect(kicks).toHaveLength(12 * 4);
  });

  it('est reproductible, et une autre graine donne une autre mélodie', () => {
    expect(compose(ARENA_STYLE)).toEqual(song);
    const other = compose({ ...ARENA_STYLE, seed: 7 });
    const melody = (c: Composition) =>
      c.notes.filter((n) => n.instrument === INS_LEAD).map((n) => `${n.start}:${n.pitch}`);
    expect(melody(other)).not.toEqual(melody(song));
  });
});

describe('rendu de la boucle', () => {
  const song = compose(ARENA_STYLE);
  const started = performance.now();
  const { left, right } = renderMusic(song, SR);
  const ms = performance.now() - started;

  it('a la longueur exacte de la boucle', () => {
    expect(left.length).toBe(Math.round(loopSeconds(song) * SR));
    expect(right.length).toBe(left.length);
  });

  it('est fini, sans saturation, et pas silencieux', () => {
    for (const channel of [left, right]) {
      // Un seul `expect` par mesure : un par échantillon prenait plusieurs secondes.
      let max = 0;
      let finite = true;
      for (const v of channel) {
        if (!Number.isFinite(v)) finite = false;
        max = Math.max(max, Math.abs(v));
      }
      expect(finite).toBe(true);
      expect(max).toBeLessThan(1);
      expect(max).toBeGreaterThan(0.5);
    }
  });

  /**
   * Une nappe (son lisse, filtré, sans écho) qui commence sur la dernière double croche et dure
   * trois doubles croches de plus que la boucle : sa suite doit se retrouver au début.
   */
  function crossing(): { left: Float32Array; right: Float32Array } {
    const tail: Composition = {
      style: ARENA_STYLE,
      bars: 1,
      chords: [0],
      notes: [{ instrument: INS_PAD, start: 15, length: 4, pitch: 57, velocity: 1, pan: 0 }],
    };
    return renderMusic(tail, SR);
  }

  it('replie sur le début ce qui dépasse la fin', () => {
    const out = crossing();
    let early = 0;
    for (let i = 0; i < SR / 50; i++) early = Math.max(early, Math.abs(out.left[i]!));
    expect(early).toBeGreaterThan(0.3);
  });

  it('se raccorde sans couture : le début de la boucle est ce qu’on entendrait en la rejouant', () => {
    // Référence : deux boucles à la suite, rendues d'un trait. Leur seconde moitié commence avec
    // tout l'historique de la première (queues de notes, état des filtres, échos) : c'est ce
    // qu'on entend au raccord quand la boucle se répète. La boucle seule doit commencer pareil.
    const low = 11_025;
    const once = renderMusic(song, low);
    const steps = song.bars * STEPS_PER_BAR;
    const twice = renderMusic(
      {
        ...song,
        bars: song.bars * 2,
        chords: [...song.chords, ...song.chords],
        notes: [...song.notes, ...song.notes.map((n) => ({ ...n, start: n.start + steps }))],
      },
      low,
    );
    const n = once.left.length;
    expect(twice.left.length).toBe(2 * n);
    let worst = 0;
    for (let i = 0; i < low / 4; i++) {
      worst = Math.max(worst, Math.abs(once.left[i]! - twice.left[n + i]!));
      worst = Math.max(worst, Math.abs(once.right[i]! - twice.right[n + i]!));
    }
    expect(worst).toBeLessThan(2e-3);
  });

  it('est reproductible', () => {
    const again = renderMusic(song, SR);
    expect(again.left).toEqual(left);
  });

  it('se découpe en tâches et refuse de rendre un résultat inachevé', () => {
    const render = createMusicRender(song, SR);
    expect(render.done).toBe(false);
    expect(() => render.result()).toThrow();
    let tasks = 0;
    while (!render.step()) tasks++;
    expect(tasks).toBeGreaterThan(100);
    expect(render.result().left).toEqual(left);
  });

  it('rapporte sa durée de calcul', () => {
    const projected = (ms * SAMPLE_RATE) / SR;
    process.stdout.write(
      `\nRendu de la musique : ${ms.toFixed(0)} ms à ${SR} Hz (~${projected.toFixed(0)} ms à ${SAMPLE_RATE} Hz)\n`,
    );
    expect(ms).toBeLessThan(5000);
  });
});
