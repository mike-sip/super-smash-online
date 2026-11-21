/**
 * Musique de combat générée : composition à graine, puis rendu d'une boucle stéréo sans couture.
 *
 * La composition travaille en degrés de gamme : toute note mélodique tombe donc dans la gamme du
 * morceau. Les progressions d'accords utilisées sont des enchaînements génériques ; la mélodie est
 * tirée au hasard sous contraintes (notes de l'accord sur les temps forts, mouvements conjoints
 * ailleurs) et répétée en motifs. Aucune œuvre existante ne sert de modèle.
 *
 * Le rendu est découpé en petites tâches pour que la banque puisse rendre la main au navigateur
 * entre deux. Logique pure : même style, mêmes échantillons.
 */
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
  softClip,
} from './synth.ts';

export const INS_KICK = 0;
export const INS_SNARE = 1;
export const INS_HAT = 2;
export const INS_BASS = 3;
export const INS_PAD = 4;
export const INS_LEAD = 5;
export const INS_ARP = 6;
const INSTRUMENTS = 7;

/** Instruments à hauteur définie ; les autres sont des percussions (hauteur 0). */
export const MELODIC: readonly number[] = [INS_BASS, INS_PAD, INS_LEAD, INS_ARP];

export const NATURAL_MINOR: readonly number[] = [0, 2, 3, 5, 7, 8, 10];
export const DORIAN: readonly number[] = [0, 2, 3, 5, 7, 9, 10];
export const MAJOR: readonly number[] = [0, 2, 4, 5, 7, 9, 11];
export const MIXOLYDIAN: readonly number[] = [0, 2, 4, 5, 7, 9, 10];
export const LYDIAN: readonly number[] = [0, 2, 4, 6, 7, 9, 11];
export const PHRYGIAN: readonly number[] = [0, 1, 3, 5, 7, 8, 10];

export const BARS = 16;
export const BEATS_PER_BAR = 4;
export const STEPS_PER_BEAT = 4;
export const STEPS_PER_BAR = BEATS_PER_BAR * STEPS_PER_BEAT;

export interface TrackStyle {
  /** Identifiant de la musique dans la banque. */
  readonly name: string;
  readonly seed: number;
  /** Battements par minute. */
  readonly bpm: number;
  /** Tonique, en numéro de note MIDI (45 : la grave). */
  readonly root: number;
  /** Intervalles de la gamme, en demi-tons depuis la tonique ; sept degrés. */
  readonly scale: readonly number[];
  /** Degré fondamental de l'accord de chaque mesure, repris en boucle. */
  readonly progression: readonly number[];
  /**
   * Batterie (SPEC-finition.md, phase 5) : `drive` (grosse caisse à chaque temps, par défaut),
   * `half` (demi-temps, plus posé), `sparse` (quelques frappes, pour les ambiances).
   */
  readonly drums?: 'drive' | 'half' | 'sparse';
  /** Arpège : à partir du deuxième tiers (par défaut), tout le long, ou jamais. */
  readonly arp?: 'late' | 'always' | 'never';
  /** Forme d'onde de la mélodie (`WAVE_*`) ; carrée par défaut. */
  readonly leadWave?: number;
}

/** Musique du stage de test : électro arcade, 150 bpm, la mineur, i – VI – III – VII. */
export const ARENA_STYLE: TrackStyle = {
  name: 'arena',
  seed: 20261113,
  bpm: 150,
  root: 45,
  scale: NATURAL_MINOR,
  progression: [0, 5, 2, 6],
};

export interface Note {
  readonly instrument: number;
  /** Début et durée, en doubles croches depuis le début de la boucle. */
  readonly start: number;
  readonly length: number;
  /** Note MIDI ; 0 pour une percussion. */
  readonly pitch: number;
  /** De 0 à 1. */
  readonly velocity: number;
  /** Position stéréo, de -1 à 1. */
  readonly pan: number;
}

export interface Composition {
  readonly style: TrackStyle;
  readonly bars: number;
  /** Degré fondamental de l'accord de chaque mesure. */
  readonly chords: readonly number[];
  readonly notes: readonly Note[];
  /** Faux pour un jingle joué une fois : pas de repli de la fin sur le début. */
  readonly loop?: boolean;
}

/** Durée de la boucle, en secondes. */
export function loopSeconds(composition: Composition): number {
  return (composition.bars * BEATS_PER_BAR * 60) / composition.style.bpm;
}

/** Note MIDI du degré `degree` (0 : tonique ; 7 : tonique une octave plus haut), dans `octave`. */
export function degreeToPitch(style: TrackStyle, degree: number, octave: number): number {
  const scale = style.scale;
  const o = Math.floor(degree / scale.length);
  const d = degree - o * scale.length;
  return style.root + 12 * (octave + o) + scale[d]!;
}

export const midiToFrequency = (pitch: number): number => 440 * Math.pow(2, (pitch - 69) / 12);

/** Tirages reproductibles dans [0, 1). */
function random(seed: number): () => number {
  const noise = createNoise(seed);
  return () => (nextNoise(noise) + 1) / 2;
}

interface Phrase {
  /** Débuts et durées, en doubles croches depuis le début de la phrase (deux mesures). */
  readonly starts: number[];
  readonly lengths: number[];
  /** Degré de chaque note, relatif au degré de l'accord de sa mesure. */
  readonly degrees: number[];
}

/** Rythme et contour d'une phrase de deux mesures, sur les accords `chords`. */
function phrase(rnd: () => number, chords: readonly number[]): Phrase {
  const span = STEPS_PER_BAR * 2;
  const onsets: number[] = [0];
  for (let s = 1; s < span - 2; s++) {
    const p = s % 4 === 0 ? 0.6 : s % 2 === 0 ? 0.4 : 0.1;
    if (rnd() < p) onsets.push(s);
  }
  const starts: number[] = [];
  const lengths: number[] = [];
  const degrees: number[] = [];
  // Degré courant, absolu : la mélodie évolue autour de la tonique supérieure.
  let degree = 7;
  for (let n = 0; n < onsets.length; n++) {
    const s = onsets[n]!;
    const next = onsets[n + 1] ?? span;
    const chord = chords[Math.floor(s / STEPS_PER_BAR)]!;
    if (s % 8 === 0) {
      // Temps fort : la note de l'accord la plus proche.
      let best = degree;
      let distance = Infinity;
      for (let octave = 0; octave <= 14; octave += 7) {
        for (const tone of [0, 2, 4]) {
          const candidate = chord + tone + octave;
          const d = Math.abs(candidate - degree) + (rnd() < 0.3 ? 1 : 0);
          if (d < distance && candidate >= 4 && candidate <= 13) {
            distance = d;
            best = candidate;
          }
        }
      }
      degree = best;
    } else {
      const move = rnd() < 0.7 ? (rnd() < 0.5 ? -1 : 1) : rnd() < 0.5 ? -2 : 2;
      degree = Math.max(4, Math.min(13, degree + move));
    }
    starts.push(s);
    lengths.push(Math.min(6, next - s, rnd() < 0.15 ? 1 : 8));
    degrees.push(degree - chord);
  }
  return { starts, lengths, degrees };
}

/**
 * Compose la boucle de `style` : quatre parties de quatre mesures.
 * A : batterie, basse, nappe. B : thème. C : variation du thème et réponse, arpège.
 * D : pont allégé, roulement de caisse claire qui relance la boucle.
 */
export function compose(style: TrackStyle): Composition {
  const rnd = random(style.seed);
  const chords = Array.from(
    { length: BARS },
    (_, bar) => style.progression[bar % style.progression.length]!,
  );
  const notes: Note[] = [];
  const add = (
    instrument: number,
    start: number,
    length: number,
    pitch: number,
    velocity: number,
    pan = 0,
  ): void => {
    notes.push({ instrument, start, length, pitch, velocity, pan });
  };

  for (let bar = 0; bar < BARS; bar++) {
    const at = bar * STEPS_PER_BAR;
    const section = Math.floor(bar / 4);
    const chord = chords[bar]!;
    const last = bar === BARS - 1;

    // Batterie.
    const feel = style.drums ?? 'drive';
    for (let s = 0; s < STEPS_PER_BAR; s++) {
      const beat = s % STEPS_PER_BEAT === 0;
      const pulse =
        feel === 'half'
          ? s === 0 || s === 10
          : feel === 'sparse'
            ? s === 0 || (s === 11 && bar % 2 === 1)
            : beat;
      const kick = section === 3 ? (bar === 14 ? s % 8 === 0 : bar === 15 ? beat : false) : pulse;
      if (kick) add(INS_KICK, at + s, 2, 0, feel === 'sparse' ? 0.75 : 1);
      const backbeat =
        feel === 'half'
          ? s === 8
          : feel === 'sparse'
            ? s === 8 && bar % 2 === 1
            : s === 4 || s === 12;
      if (section < 3 && backbeat) add(INS_SNARE, at + s, 2, 0, feel === 'sparse' ? 0.5 : 0.9);
      if (section === 2 && s === 14 && bar % 2 === 1) add(INS_SNARE, at + s, 1, 0, 0.35);
      if (last && s >= 8) add(INS_SNARE, at + s, 1, 0, 0.3 + (0.6 * (s - 8)) / 7);
      const offbeat = s % 4 === 2;
      if (section === 2 ? true : section === 3 ? offbeat && bar >= 13 : offbeat || s % 2 === 0) {
        const accent = offbeat ? 0.8 : 0.4;
        add(INS_HAT, at + s, offbeat && section !== 2 ? 2 : 1, 0, accent, 0.3);
      }
    }

    // Basse : croches à contretemps sur la fondamentale ; notes longues dans le pont.
    const bass = degreeToPitch(style, chord, -1);
    if (section === 3 && bar < 15) {
      add(INS_BASS, at, STEPS_PER_BAR, bass, 0.7);
    } else {
      for (const s of [0, 2, 6, 8, 10, 14]) {
        add(
          INS_BASS,
          at + s,
          s === 0 || s === 8 ? 2 : 1,
          bass + (s === 14 ? 12 : 0),
          s % 4 === 2 ? 1 : 0.75,
        );
      }
    }

    // Nappe : l'accord tenu toute la mesure, deux voix légèrement écartées.
    for (const tone of [0, 2, 4]) {
      const pitch = degreeToPitch(style, chord + tone, 1);
      add(INS_PAD, at, STEPS_PER_BAR, pitch, section === 3 ? 0.8 : 0.55, -0.5 + tone * 0.25);
    }

    // Arpège : doubles croches sur les notes de l'accord, montant puis descendant.
    const arp = style.arp ?? 'late';
    if (arp === 'always' || (arp === 'late' && section >= 2)) {
      const shape = [0, 2, 4, 7, 9, 7, 4, 2];
      for (let s = 0; s < STEPS_PER_BAR; s++) {
        const pitch = degreeToPitch(style, chord + shape[s % shape.length]!, 2);
        add(INS_ARP, at + s, 1, pitch, s % 4 === 0 ? 0.8 : 0.5, s % 2 === 0 ? -0.45 : 0.45);
      }
    }
  }

  // Mélodie : un thème de deux mesures, répété sur les accords suivants, puis varié.
  const theme = phrase(rnd, [chords[4]!, chords[5]!]);
  const answer = phrase(rnd, [chords[10]!, chords[11]!]);
  const placePhrase = (p: Phrase, firstBar: number, vary: boolean, resolve: boolean): void => {
    for (let n = 0; n < p.starts.length; n++) {
      const start = firstBar * STEPS_PER_BAR + p.starts[n]!;
      const chord = chords[Math.floor(start / STEPS_PER_BAR)]!;
      let degree = p.degrees[n]! + chord;
      if (vary && n % 3 === 2) degree += 1;
      const isLast = n === p.starts.length - 1;
      if (resolve && isLast) degree = 7;
      const length = isLast && (vary || resolve) ? Math.max(p.lengths[n]!, 4) : p.lengths[n]!;
      add(INS_LEAD, start, length, degreeToPitch(style, degree, 1), n === 0 ? 1 : 0.8, 0.15);
    }
  };
  placePhrase(theme, 4, false, false);
  placePhrase(theme, 6, false, false);
  placePhrase(theme, 8, true, false);
  placePhrase(answer, 10, false, true);

  notes.sort((a, b) => a.start - b.start || a.instrument - b.instrument);
  return { style, bars: BARS, chords, notes };
}

/** Résultat du rendu : deux canaux de même longueur, la boucle entière. */
export interface MusicBuffers {
  readonly left: Float32Array;
  readonly right: Float32Array;
}

/** Rendu découpé en tâches : `step` en exécute une, `done` dit s'il en reste. */
export interface MusicRender {
  readonly done: boolean;
  /** Exécute la tâche suivante ; renvoie `done`. */
  step(): boolean;
  /** Le résultat ; seulement une fois `done`. */
  result(): MusicBuffers;
}

/** Marge au-delà de la boucle pour les queues de notes, repliées ensuite sur le début. */
const TAIL_SECONDS = 2;
const MIX_PEAK = 0.85;

/** Gain de chaque instrument dans le mélange. */
const LEVELS: readonly number[] = [0.95, 0.5, 0.16, 0.5, 0.11, 0.24, 0.14];

/** Prépare le rendu de `composition` ; rien n'est calculé avant les appels à `step`. */
export function createMusicRender(composition: Composition, sampleRate = SAMPLE_RATE): MusicRender {
  const stepSeconds = 60 / composition.style.bpm / STEPS_PER_BEAT;
  const loop = composition.loop !== false;
  const loopLength = Math.round(loopSeconds(composition) * sampleRate);
  const padded = loopLength + Math.ceil(TAIL_SECONDS * sampleRate);
  // Un jingle garde sa queue (pas de repli sur le début) : il dure toute la longueur rembourrée.
  const length = loop ? loopLength : padded;
  // Un tampon par instrument (deux pour ceux qui sont en stéréo), filtré une seule fois.
  const left: Float32Array[] = [];
  const right: Float32Array[] = [];
  for (let i = 0; i < INSTRUMENTS; i++) {
    left.push(new Float32Array(padded));
    right.push(new Float32Array(padded));
  }
  const outL = new Float32Array(length);
  const outR = new Float32Array(length);

  const jobs: (() => void)[] = [];
  for (const note of composition.notes) {
    jobs.push(() => renderNote(note));
  }
  for (let i = 0; i < INSTRUMENTS; i++) {
    jobs.push(() => {
      if (!loop) return;
      fold(left[i]!, length);
      fold(right[i]!, length);
    });
    jobs.push(() => shape(i));
    jobs.push(() => {
      mixInto(outL, left[i]!.subarray(0, length), LEVELS[i]!);
      mixInto(outR, right[i]!.subarray(0, length), LEVELS[i]!);
      left[i] = new Float32Array(0);
      right[i] = new Float32Array(0);
    });
  }
  jobs.push(() => {
    softClip(outL, 1.1);
    softClip(outR, 1.1);
    const scale = MIX_PEAK / Math.max(1e-9, peakOf(outL, outR));
    for (let i = 0; i < length; i++) {
      outL[i] = outL[i]! * scale;
      outR[i] = outR[i]! * scale;
    }
  });

  function renderNote(note: Note): void {
    // Le bruit d’une percussion ne dépend que de sa place dans la mesure : la même frappe sonne
    // pareil à chaque mesure, comme un échantillon de batterie, et la boucle se répète à l’identique.
    const seed = note.instrument * STEPS_PER_BAR + (note.start % STEPS_PER_BAR) + 1;
    const l = left[note.instrument]!;
    const r = right[note.instrument]!;
    const start = note.start * stepSeconds;
    const gate = note.length * stepSeconds;
    const v = note.velocity;
    const freq = midiToFrequency(note.pitch);
    const pan = note.pan;
    switch (note.instrument) {
      case INS_KICK:
        addTone(
          l,
          {
            wave: WAVE_SINE,
            freq: 150,
            freqEnd: 45,
            sweep: 0.08,
            start,
            attack: 0.001,
            decay: 0.28,
            sustain: 0,
            gate: 0.281,
            gain: v,
          },
          sampleRate,
          r,
        );
        addNoise(
          l,
          { seed, start, attack: 0, decay: 0.006, sustain: 0, gate: 0.006, gain: 0.3 * v },
          sampleRate,
          r,
        );
        return;
      case INS_SNARE:
        addNoise(
          l,
          { seed, start, attack: 0.001, decay: 0.16, sustain: 0, gate: 0.161, gain: v },
          sampleRate,
          r,
        );
        addTone(
          l,
          {
            wave: WAVE_TRIANGLE,
            freq: 190,
            freqEnd: 160,
            sweep: 0.05,
            start,
            attack: 0.001,
            decay: 0.08,
            sustain: 0,
            gate: 0.081,
            gain: 0.5 * v,
          },
          sampleRate,
          r,
        );
        return;
      case INS_HAT: {
        const decay = note.length > 1 ? 0.11 : 0.035;
        addNoise(
          l,
          { seed, start, attack: 0, decay, sustain: 0, gate: decay, gain: v, pan },
          sampleRate,
          r,
        );
        return;
      }
      case INS_BASS:
        addTone(
          l,
          {
            wave: WAVE_SAW,
            freq,
            start,
            attack: 0.003,
            decay: 0.15,
            sustain: 0.35,
            release: 0.03,
            gate: gate * 0.9,
            gain: v,
          },
          sampleRate,
          r,
        );
        addTone(
          l,
          {
            wave: WAVE_SINE,
            freq: freq / 2,
            start,
            attack: 0.003,
            decay: 0.2,
            sustain: 0.5,
            release: 0.03,
            gate: gate * 0.9,
            gain: 0.6 * v,
          },
          sampleRate,
          r,
        );
        return;
      case INS_PAD:
        // Deux voix désaccordées de quelques cents, écartées en stéréo.
        for (const [detune, side] of [
          [0.996, -1],
          [1.004, 1],
        ] as const) {
          addTone(
            l,
            {
              wave: WAVE_SAW,
              freq: freq * detune,
              start,
              attack: 0.25,
              decay: 0.4,
              sustain: 0.7,
              release: 0.35,
              gate,
              gain: v,
              pan: Math.max(-1, Math.min(1, pan + 0.35 * side)),
            },
            sampleRate,
            r,
          );
        }
        return;
      case INS_LEAD:
        addTone(
          l,
          {
            wave: composition.style.leadWave ?? WAVE_SQUARE,
            freq,
            start,
            attack: 0.008,
            decay: 0.12,
            sustain: 0.55,
            release: 0.07,
            gate: gate * 0.92,
            gain: v,
            pan,
          },
          sampleRate,
          r,
        );
        addTone(
          l,
          {
            wave: WAVE_TRIANGLE,
            freq: freq * 2,
            start,
            attack: 0.008,
            decay: 0.1,
            sustain: 0.3,
            release: 0.07,
            gate: gate * 0.92,
            gain: 0.35 * v,
            pan,
          },
          sampleRate,
          r,
        );
        return;
      case INS_ARP:
        addTone(
          l,
          {
            wave: WAVE_TRIANGLE,
            freq,
            start,
            attack: 0.002,
            decay: 0.12,
            sustain: 0,
            gate: 0.122,
            gain: v,
            pan,
          },
          sampleRate,
          r,
        );
        return;
      default:
        throw new Error(`Instrument inconnu : ${note.instrument}`);
    }
  }

  /** Filtres et effets propres à chaque instrument, sur la boucle repliée. */
  function shape(instrument: number): void {
    const l = left[instrument]!.subarray(0, length);
    const r = right[instrument]!.subarray(0, length);
    const both = (mode: number, cutoff: number, q: number): void => {
      filter(l, mode, cutoff, cutoff, q, sampleRate, 0, length, true);
      filter(r, mode, cutoff, cutoff, q, sampleRate, 0, length, true);
    };
    switch (instrument) {
      case INS_SNARE:
        both(FILTER_BAND, 1800, 0.8);
        return;
      case INS_HAT:
        both(FILTER_HIGH, 7000, 0.707);
        return;
      case INS_BASS:
        both(FILTER_LOW, 900, 1.2);
        return;
      case INS_PAD:
        both(FILTER_LOW, 1800, 0.707);
        return;
      case INS_LEAD:
        both(FILTER_LOW, 4200, 0.9);
        echo(l, r, 3 * stepSeconds, 0.28, 2);
        return;
      case INS_ARP:
        both(FILTER_LOW, 3500, 0.707);
        echo(l, r, 3 * stepSeconds, 0.35, 3);
        return;
      default:
    }
  }

  /** Écho circulaire : les répétitions qui dépassent la fin de la boucle reviennent au début. */
  function echo(l: Float32Array, r: Float32Array, seconds: number, gain: number, repeats: number) {
    const delay = Math.round(seconds * sampleRate);
    const dryL = Float32Array.from(l);
    const dryR = Float32Array.from(r);
    for (let n = 1; n <= repeats; n++) {
      const g = Math.pow(gain, n);
      // Les répétitions alternent de côté, pour élargir l'image.
      const [srcL, srcR] = n % 2 === 1 ? [dryR, dryL] : [dryL, dryR];
      for (let i = 0; i < length; i++) {
        const j = (i + n * delay) % length;
        l[j] = l[j]! + srcL[i]! * g;
        r[j] = r[j]! + srcR[i]! * g;
      }
    }
  }

  let next = 0;
  const render: MusicRender = {
    get done() {
      return next >= jobs.length;
    },
    step() {
      if (next < jobs.length) jobs[next++]!();
      return render.done;
    },
    result() {
      if (!render.done) throw new Error('Rendu de la musique inachevé.');
      return { left: outL, right: outR };
    },
  };
  return render;
}

/** Replie sur le début ce qui dépasse la boucle. */
function fold(buf: Float32Array, length: number): void {
  for (let i = length; i < buf.length; i++) {
    const j = i % length;
    buf[j] = buf[j]! + buf[i]!;
  }
}

function peakOf(a: Float32Array, b: Float32Array): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const v = Math.max(Math.abs(a[i]!), Math.abs(b[i]!));
    if (v > max) max = v;
  }
  return max;
}

/** Rendu complet, d'un trait : pour les tests et les outils. */
export function renderMusic(composition: Composition, sampleRate = SAMPLE_RATE): MusicBuffers {
  const render = createMusicRender(composition, sampleRate);
  while (!render.done) render.step();
  return render.result();
}

// --- Thèmes et jingles (SPEC-finition.md, phase 5) -------------------------------------------

/** Menus : posé, ré dorien, demi-temps, arpège tout du long, mélodie douce. */
export const MENU_STYLE: TrackStyle = {
  name: 'menu',
  seed: 20261120,
  bpm: 100,
  root: 50,
  scale: DORIAN,
  progression: [0, 3, 5, 4],
  drums: 'half',
  arp: 'always',
  leadWave: WAVE_TRIANGLE,
};

/** Belvédère des Brumes : aventure lumineuse, do majeur, I – V – vi – IV. */
export const BELVEDERE_STYLE: TrackStyle = {
  name: 'belvedere',
  seed: 20261121,
  bpm: 138,
  root: 48,
  scale: MAJOR,
  progression: [0, 4, 5, 3],
};

/** Récif Nocturne : nuit et lagon, la dorien, peu de batterie, arpège qui ruisselle. */
export const RECIF_STYLE: TrackStyle = {
  name: 'recif',
  seed: 20261122,
  bpm: 108,
  root: 45,
  scale: DORIAN,
  progression: [0, 6, 5, 6],
  drums: 'sparse',
  arp: 'always',
  leadWave: WAVE_TRIANGLE,
};

/** Canal des Lanternes : crépuscule, sol mixolydien, demi-temps chaloupé. */
export const CANAL_STYLE: TrackStyle = {
  name: 'canal',
  seed: 20261123,
  bpm: 122,
  root: 43,
  scale: MIXOLYDIAN,
  progression: [0, 6, 3, 0],
  drums: 'half',
};

/** Bassin des Geysers : volcanique, mi phrygien, rapide et appuyé. */
export const GEYSERS_STYLE: TrackStyle = {
  name: 'geysers',
  seed: 20261124,
  bpm: 158,
  root: 40,
  scale: PHRYGIAN,
  progression: [0, 1, 0, 6],
  leadWave: WAVE_SAW,
};

/** Toutes les musiques en boucle : les menus, l'arène d'essai, un thème par stage. */
export const TRACK_STYLES: readonly TrackStyle[] = [
  MENU_STYLE,
  ARENA_STYLE,
  BELVEDERE_STYLE,
  RECIF_STYLE,
  CANAL_STYLE,
  GEYSERS_STYLE,
];

/** Jingle de victoire de chaque thème d'effets (donc de chaque personnage). */
export const JINGLE_STYLES: readonly TrackStyle[] = [
  { name: 'victory-wind', seed: 31, bpm: 140, root: 60, scale: MAJOR, progression: [0, 4] },
  {
    name: 'victory-feather',
    seed: 32,
    bpm: 160,
    root: 62,
    scale: LYDIAN,
    progression: [0, 1],
    leadWave: WAVE_TRIANGLE,
  },
  {
    name: 'victory-ember',
    seed: 33,
    bpm: 118,
    root: 52,
    scale: NATURAL_MINOR,
    progression: [0, 5],
    leadWave: WAVE_SAW,
  },
  {
    name: 'victory-pearl',
    seed: 34,
    bpm: 110,
    root: 57,
    scale: DORIAN,
    progression: [0, 3],
    leadWave: WAVE_TRIANGLE,
  },
];

/**
 * Jingle de victoire : deux mesures jouées une fois. Une frappe de batterie, l'accord tenu, et la
 * mélodie qui monte l'accord jusqu'à la tonique aiguë, tenue jusqu'au bout.
 */
export function composeJingle(style: TrackStyle): Composition {
  const notes: Note[] = [];
  const add = (
    instrument: number,
    start: number,
    length: number,
    pitch: number,
    velocity: number,
    pan = 0,
  ): void => {
    notes.push({ instrument, start, length, pitch, velocity, pan });
  };
  const first = style.progression[0] ?? 0;
  const second = style.progression[1] ?? 4;
  add(INS_KICK, 0, 2, 0, 1);
  add(INS_SNARE, 0, 2, 0, 0.8);
  add(INS_KICK, STEPS_PER_BAR, 2, 0, 1);
  add(INS_SNARE, STEPS_PER_BAR, 4, 0, 1);
  for (const tone of [0, 2, 4]) {
    const pan = -0.4 + tone * 0.2;
    add(INS_PAD, 0, STEPS_PER_BAR, degreeToPitch(style, second + tone, 1), 0.6, pan);
    add(INS_PAD, STEPS_PER_BAR, STEPS_PER_BAR * 2, degreeToPitch(style, first + tone, 1), 0.7, pan);
  }
  add(INS_BASS, 0, STEPS_PER_BAR, degreeToPitch(style, second, -1), 0.8);
  add(INS_BASS, STEPS_PER_BAR, STEPS_PER_BAR * 2, degreeToPitch(style, first, -1), 0.9);
  // Montée de croches sur l'accord, puis la tonique aiguë tenue.
  [0, 2, 4, 7, 9, 11].forEach((degree, n) => {
    add(INS_LEAD, n * 2, 2, degreeToPitch(style, second + degree, 1), 0.8 + n * 0.03, 0.1);
  });
  add(INS_LEAD, STEPS_PER_BAR, STEPS_PER_BAR + 8, degreeToPitch(style, first + 7, 1), 1, 0.1);
  add(INS_HAT, STEPS_PER_BAR, 2, 0, 0.9, 0.3);
  notes.sort((a, b) => a.start - b.start || a.instrument - b.instrument);
  return { style, bars: 2, chords: [second, first], notes, loop: false };
}
