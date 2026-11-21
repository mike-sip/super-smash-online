import { EV_HIT, EV_KO, M_JAB, M_NSPECIAL, createFighterView } from '@game/sim-core';
import { describe, expect, it } from 'vitest';
import { createGameAudioWith } from '../src/audio/audio.ts';
import type { MusicData, SoundBank } from '../src/audio/bank.ts';
import {
  SND_HIT_STRONG,
  SND_KO,
  SND_STAR,
  SND_THEME_EMBER,
  SND_WHOOSH,
  SOUND_COUNT,
  createCueQueue,
  pushEventCue,
} from '../src/audio/cues.ts';
import { SOUND_LEVELS, SOUND_PRIORITIES } from '../src/audio/mixer.ts';
import {
  JINGLE_STYLES,
  TRACK_STYLES,
  compose,
  composeJingle,
  createMusicRender,
  loopSeconds,
} from '../src/audio/music.ts';
import { ROOMS, impulseResponse } from '../src/audio/reverb.ts';
import { renderSound } from '../src/audio/sounds.ts';
import { FakeContext, asContext, fakeBank, settle } from './audio-fakes.ts';

describe('sons de la phase 5 (SPEC-finition.md)', () => {
  it('chaque son a une recette, un volume et une priorité', () => {
    for (let id = 0; id < SOUND_COUNT; id++) {
      expect(renderSound(id, 8000).length).toBeGreaterThan(0);
      expect(SOUND_LEVELS[id]).toBeGreaterThan(0);
      expect(SOUND_PRIORITIES[id]).toBeGreaterThanOrEqual(0);
    }
  });

  it('un coup fort ajoute un souffle ; un spécial, la touche du thème du lanceur', () => {
    const views = [createFighterView(), createFighterView()];
    views[1]!.hitlag = 16;
    views[0]!.move = M_NSPECIAL;
    const queue = createCueQueue();
    pushEventCue(queue, EV_HIT, 0, 1, views, 2, ['ember', 'wind']);
    expect([...queue.sound.subarray(0, queue.count)]).toEqual([
      SND_HIT_STRONG,
      SND_WHOOSH,
      SND_THEME_EMBER,
    ]);
    queue.count = 0;
    views[0]!.move = M_JAB;
    pushEventCue(queue, EV_HIT, 0, 1, views, 2, ['ember', 'wind']);
    expect([...queue.sound.subarray(0, queue.count)]).toEqual([SND_HIT_STRONG, SND_WHOOSH]);
  });

  it('un KO par le haut sonne comme une étoile', () => {
    const views = [createFighterView()];
    const queue = createCueQueue();
    views[0]!.y = 200;
    pushEventCue(queue, EV_KO, 0, -1, views, 1, [], 150);
    views[0]!.y = 0;
    pushEventCue(queue, EV_KO, 0, -1, views, 1, [], 150);
    expect([...queue.sound.subarray(0, queue.count)]).toEqual([SND_STAR, SND_KO]);
  });
});

describe('musiques et jingles', () => {
  it('chaque thème est distinct et boucle sur seize mesures', () => {
    const names = new Set(TRACK_STYLES.map((t) => t.name));
    expect(names.size).toBe(TRACK_STYLES.length);
    expect(names).toContain('menu');
    for (const stage of ['belvedere', 'recif', 'canal', 'geysers']) expect(names).toContain(stage);
    const first = compose(TRACK_STYLES[2]!)
      .notes.slice(0, 40)
      .map((n) => n.pitch);
    const second = compose(TRACK_STYLES[3]!)
      .notes.slice(0, 40)
      .map((n) => n.pitch);
    expect(first).not.toEqual(second);
  });

  it('les batteries « demi-temps » et « clairsemée » frappent moins que « drive »', () => {
    const kicks = (drums: 'drive' | 'half' | 'sparse'): number =>
      compose({ ...TRACK_STYLES[1]!, drums }).notes.filter((n) => n.instrument === 0).length;
    expect(kicks('half')).toBeLessThan(kicks('drive'));
    expect(kicks('sparse')).toBeLessThan(kicks('half'));
  });

  it('un jingle se joue une fois : sa queue n’est pas repliée, il dure plus que ses mesures', () => {
    const jingle = composeJingle(JINGLE_STYLES[0]!);
    expect(jingle.loop).toBe(false);
    const sr = 8000;
    const render = createMusicRender(jingle, sr);
    while (!render.step());
    const { left } = render.result();
    expect(left.length / sr).toBeGreaterThan(loopSeconds(jingle));
  });
});

describe('réverbération', () => {
  it('chaque stage a sa salle, une queue qui décroît, à énergie égale', () => {
    for (const stage of ['belvedere', 'recif', 'canal', 'geysers']) {
      const room = ROOMS[stage]!;
      const [left, right] = impulseResponse(room, 8000);
      expect(left.length).toBe(Math.round(room.seconds * 8000));
      const energy = (a: Float32Array, from: number, to: number): number => {
        let e = 0;
        for (let i = from; i < to; i++) e += a[i]! * a[i]!;
        return e;
      };
      expect(energy(left, 0, left.length)).toBeCloseTo(1, 3);
      expect(energy(left, 0, 2000)).toBeGreaterThan(energy(left, left.length - 2000, left.length));
      expect(left).not.toEqual(right);
    }
  });
});

describe('moteur : tension, salle, jingles, musiques à la demande', () => {
  function setup(bank: SoundBank = fakeBank()) {
    const fake = new FakeContext();
    const audio = createGameAudioWith(() => asContext(fake), { bank });
    return { fake, audio };
  }

  it('la tension monte la musique d’un demi-ton et l’éclaircit ; un nouveau morceau repart à zéro', async () => {
    const { fake, audio } = setup();
    audio.unlock();
    await settle();
    audio.playMusic('arena');
    const [music] = fake.music();
    audio.setIntensity(1);
    expect(music!.playbackRate.value).toBeCloseTo(1.0595, 4);
    expect(fake.filters[0]!.frequency.value).toBeGreaterThan(15000);
    audio.setIntensity(0);
    expect(music!.playbackRate.value).toBe(1);
  });

  it('la salle du stage règle la réverbération ; sans salle, plus de réverbération', async () => {
    const { fake, audio } = setup();
    audio.unlock();
    await settle();
    audio.setRoom('canal');
    expect(fake.convolvers[0]!.buffer).not.toBeNull();
    const wet = fake.gains[fake.gains.length - 1]!;
    expect(wet.gain.value).toBeCloseTo(ROOMS.canal!.wet, 6);
    audio.setRoom(null);
    expect(wet.gain.value).toBe(0);
  });

  it('attend qu’une musique soit rendue avant de la jouer, et joue un jingle une fois', async () => {
    const ready = new Set<string>();
    const data: MusicData = {
      sampleRate: 1000,
      channels: [new Float32Array(500), new Float32Array(500)],
      loopStart: 0,
      loopEnd: 0.5,
    };
    const base = fakeBank();
    const bank: SoundBank = {
      ...base,
      music: (track) => (ready.has(track) ? data : null),
      ensure: (track) => {
        ready.add(track);
        return Promise.resolve();
      },
    };
    const { fake, audio } = setup(bank);
    audio.unlock();
    await settle();
    audio.playMusic('geysers');
    expect(fake.music()).toHaveLength(0);
    await settle();
    expect(fake.music()).toHaveLength(1);
    audio.playJingle('victory-wind');
    await settle();
    const jingle = fake.sources.filter((s) => !s.loop && s.startedAt !== null);
    expect(jingle.length).toBeGreaterThan(0);
  });
});
