import { describe, expect, it } from 'vitest';
import { SND_HIT_WEAK, SND_JUMP, SND_KO, SOUND_COUNT } from '../src/audio/cues.ts';
import {
  MAX_SAME_SOUND_PER_FRAME,
  PAN_WIDTH,
  SOUND_LEVELS,
  SOUND_PRIORITIES,
  allowSound,
  createJitter,
  createThrottle,
  createVoicePool,
  nextJitter,
  panFor,
  pickVoice,
  resetThrottle,
  takeVoice,
  volumeGain,
} from '../src/audio/mixer.ts';

describe('courbe de volume', () => {
  it('va de 0 à 1, croît, et le milieu est nettement moins fort que le maximum', () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(1)).toBe(1);
    expect(volumeGain(0.5)).toBeGreaterThan(0.2);
    expect(volumeGain(0.5)).toBeLessThan(0.35);
    let prev = -1;
    for (let level = 0; level <= 1; level += 0.05) {
      expect(volumeGain(level)).toBeGreaterThan(prev);
      prev = volumeGain(level);
    }
  });

  it('borne les valeurs hors limites', () => {
    expect(volumeGain(-1)).toBe(0);
    expect(volumeGain(3)).toBe(1);
    expect(volumeGain(Number.NaN)).toBe(0);
  });
});

describe('panoramique', () => {
  it('suit la position horizontale, sans aller aux extrêmes', () => {
    expect(panFor(0, 100)).toBe(0);
    expect(panFor(50, 100)).toBeCloseTo(PAN_WIDTH / 2, 9);
    expect(panFor(-100, 100)).toBeCloseTo(-PAN_WIDTH, 9);
    expect(panFor(-500, 100)).toBeCloseTo(-PAN_WIDTH, 9);
    expect(PAN_WIDTH).toBeLessThan(1);
  });
});

describe('tables des sons', () => {
  it('donnent un niveau et une priorité à chaque son', () => {
    expect(SOUND_LEVELS).toHaveLength(SOUND_COUNT);
    expect(SOUND_PRIORITIES).toHaveLength(SOUND_COUNT);
    for (const level of SOUND_LEVELS) expect(level).toBeGreaterThan(0);
    // Un KO passe avant un coup, un coup avant un saut.
    expect(SOUND_PRIORITIES[SND_KO]).toBeGreaterThan(SOUND_PRIORITIES[SND_HIT_WEAK]!);
    expect(SOUND_PRIORITIES[SND_HIT_WEAK]).toBeGreaterThan(SOUND_PRIORITIES[SND_JUMP]!);
  });
});

describe('réserve de voix', () => {
  it('prend une voix libre, puis la plus ancienne de priorité égale ou inférieure', () => {
    const pool = createVoicePool(2);
    expect(pickVoice(pool, 1, 0)).toBe(0);
    takeVoice(pool, 0, 1, 0, 1);
    expect(pickVoice(pool, 1, 0.1)).toBe(1);
    takeVoice(pool, 1, 1, 0.1, 1);
    // Pleine : la plus ancienne est reprise.
    expect(pickVoice(pool, 1, 0.2)).toBe(0);
    // Un son moins prioritaire que tous ceux qui jouent est abandonné.
    expect(pickVoice(pool, 0, 0.2)).toBe(-1);
    // Une voix dont le son est fini est libre, quelle que soit sa priorité.
    expect(pickVoice(pool, 0, 1.05)).toBe(0);
  });

  it('préfère reprendre une voix de priorité inférieure', () => {
    const pool = createVoicePool(2);
    takeVoice(pool, 0, 5, 0, 10);
    takeVoice(pool, 1, 1, 1, 10);
    expect(pickVoice(pool, 5, 2)).toBe(1);
  });
});

describe('plafond par frame', () => {
  it('laisse partir le même son au plus deux fois par frame', () => {
    const throttle = createThrottle();
    for (let n = 0; n < MAX_SAME_SOUND_PER_FRAME; n++) expect(allowSound(throttle, 3)).toBe(true);
    expect(allowSound(throttle, 3)).toBe(false);
    expect(allowSound(throttle, 4)).toBe(true);
    resetThrottle(throttle);
    expect(allowSound(throttle, 3)).toBe(true);
  });
});

describe('variation de hauteur', () => {
  it('reste dans ±4 % et varie', () => {
    const jitter = createJitter(1);
    const seen = new Set<number>();
    for (let n = 0; n < 100; n++) {
      const rate = nextJitter(jitter);
      expect(rate).toBeGreaterThanOrEqual(0.96);
      expect(rate).toBeLessThanOrEqual(1.04);
      seen.add(rate);
    }
    expect(seen.size).toBeGreaterThan(50);
  });
});
