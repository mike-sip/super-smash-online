import { describe, expect, it } from 'vitest';
import {
  BTN_ATTACK,
  STATE_BYTES,
  checksum,
  createSim,
  encodeInput,
  fx,
  loadState,
  saveState,
  spawnEntity,
  step,
} from '@game/sim-core';
import { E_BALL, testConfig } from '@game/sim-core/testing';
import { VOICES, createGameAudioWith, type GameAudio } from '../src/audio/audio.ts';
import { SND_HIT_WEAK, SND_KO, SND_PARRY } from '../src/audio/cues.ts';
import { asContext, FakeContext, fakeBank, fakeLength, settle } from './audio-fakes.ts';

/** Moteur sur faux contexte ; `contexts` compte les contextes créés. */
function engine(missing: readonly number[] = []) {
  const fake = new FakeContext();
  let contexts = 0;
  const bank = fakeBank(missing);
  const audio = createGameAudioWith(
    () => {
      contexts++;
      return asContext(fake);
    },
    { bank },
  );
  return { fake, audio, bank, contexts: () => contexts };
}

async function unlocked(missing: readonly number[] = []) {
  const t = engine(missing);
  t.audio.unlock();
  await settle();
  return t;
}

/** Le joueur 0 frappe le joueur 1 (jab) ; renvoie de quoi rejouer la séquence. */
function fight(audio: GameAudio) {
  const sim = createSim(testConfig(2));
  sim.state.posX[1] = fx(-27);
  const inputs = new Uint32Array(2);
  audio.capture(sim);
  const saved = new Uint8Array(STATE_BYTES);
  saveState(sim, saved);
  const play = (frames: number): void => {
    for (let f = 0; f < frames; f++) {
      inputs[0] = f === 0 ? encodeInput(0, 0, BTN_ATTACK) : 0;
      step(sim, inputs);
      audio.capture(sim);
    }
  };
  return { sim, saved, play };
}

const lengthOf = (source: { buffer: { length: number } | null }): number =>
  source.buffer?.length ?? -1;

describe('déverrouillage', () => {
  it('ne crée aucun contexte et ne joue rien avant unlock', async () => {
    const t = engine();
    await settle();
    expect(t.audio.state).toBe('locked');
    fight(t.audio).play(30);
    expect(t.contexts()).toBe(0);
    expect(t.audio.soundsPlayed).toBe(0);
  });

  it('crée le contexte une fois, au premier unlock', async () => {
    const t = await unlocked();
    t.audio.unlock();
    expect(t.contexts()).toBe(1);
    expect(t.audio.state).toBe('running');
    expect(t.bank.loads).toBe(1);
  });

  it('reste verrouillé si le navigateur refuse, et rejoue unlock plus tard', async () => {
    const t = engine();
    t.fake.allowResume = false;
    t.audio.unlock();
    await settle();
    expect(t.audio.state).toBe('locked');
    fight(t.audio).play(30);
    expect(t.fake.effects()).toHaveLength(0);
    t.fake.allowResume = true;
    t.audio.unlock();
    await settle();
    expect(t.audio.state).toBe('running');
  });

  it('ne fait pas ressortir les sons d’avant le déverrouillage', async () => {
    const t = engine();
    const f = fight(t.audio);
    f.play(30);
    t.audio.unlock();
    await settle();
    // Après le déverrouillage, la simulation continue sans que personne n'agisse.
    const inputs = new Uint32Array(2);
    for (let n = 0; n < 2; n++) {
      step(f.sim, inputs);
      t.audio.capture(f.sim);
    }
    expect(t.fake.effects()).toHaveLength(0);
  });
});

describe('effets', () => {
  it('joue un son par coup, avec le tampon de la banque', async () => {
    const t = await unlocked();
    fight(t.audio).play(30);
    const hits = t.fake.effects().filter((s) => lengthOf(s) === fakeLength(SND_HIT_WEAK));
    expect(hits).toHaveLength(1);
    expect(t.audio.soundsPlayed).toBe(t.fake.effects().length);
  });

  it('ne rejoue aucun son après un rollback', async () => {
    const t = await unlocked();
    const f = fight(t.audio);
    f.play(30);
    const heard = t.fake.effects().length;
    expect(heard).toBeGreaterThan(0);
    loadState(f.sim, f.saved);
    f.play(30);
    expect(t.fake.effects()).toHaveLength(heard);
  });

  it('se tait pour un son absent de la banque', async () => {
    const t = await unlocked([SND_HIT_WEAK]);
    fight(t.audio).play(30);
    expect(t.fake.effects().filter((s) => lengthOf(s) === fakeLength(SND_HIT_WEAK))).toEqual([]);
  });

  it('plafonne les départs d’un même son par frame', async () => {
    const t = await unlocked();
    const sim = createSim(testConfig(2));
    t.audio.capture(sim);
    for (let n = 0; n < 16; n++) spawnEntity(sim, E_BALL, -1, fx(n * 4 - 30), fx(80), 0, 0);
    step(sim, new Uint32Array(2));
    t.audio.capture(sim);
    expect(t.fake.effects()).toHaveLength(2);
  });

  it('ne dépasse jamais la réserve de voix', async () => {
    const t = await unlocked();
    for (let n = 0; n < 100; n++) t.audio.play(SND_KO);
    const playing = t.fake.effects().filter((s) => !s.stopped);
    expect(playing.length).toBeLessThanOrEqual(VOICES);
    // Bus, voix, deux pistes de musique, jingles, retour de réverbération (SPEC-finition.md, phase 5).
    expect(t.fake.gains.length).toBe(4 + VOICES + 2 + 2);
    expect(t.fake.panners).toHaveLength(VOICES);
  });

  it('joue un son à la demande, au centre (planche d’écoute)', async () => {
    const t = await unlocked();
    t.audio.play(SND_PARRY);
    const [source] = t.fake.effects();
    expect(lengthOf(source!)).toBe(fakeLength(SND_PARRY));
    const pan = t.fake.panners.find((p) => p.pan.value !== 0);
    expect(pan).toBeUndefined();
  });

  it('ne modifie pas la simulation', async () => {
    const t = await unlocked();
    const f = fight(t.audio);
    f.play(3);
    const before = checksum(f.sim);
    t.audio.capture(f.sim);
    expect(checksum(f.sim)).toBe(before);
  });
});

describe('réglages', () => {
  it('applique coupure et volumes aux bus', async () => {
    const t = await unlocked();
    t.audio.setSettings({ enabled: true, effects: 0.5, music: 1 });
    expect(t.fake.master.gain.value).toBe(1);
    expect(t.fake.effectsBus.gain.value).toBeCloseTo(0.25, 9);
    expect(t.fake.musicBus.gain.value).toBe(1);
    t.audio.setSettings({ enabled: false, effects: 0.5, music: 1 });
    expect(t.fake.master.gain.value).toBe(0);
    expect(t.audio.settings.enabled).toBe(false);
  });

  it('ne lance aucun son quand le son est coupé', async () => {
    const t = await unlocked();
    t.audio.setSettings({ enabled: false, effects: 1, music: 1 });
    fight(t.audio).play(30);
    expect(t.fake.effects()).toHaveLength(0);
  });

  it('applique au déverrouillage les réglages reçus avant', async () => {
    const t = engine();
    t.audio.setSettings({ enabled: true, effects: 0, music: 0.5 });
    t.audio.unlock();
    await settle();
    expect(t.fake.effectsBus.gain.value).toBe(0);
    expect(t.fake.musicBus.gain.value).toBeCloseTo(0.25, 9);
  });
});

describe('musique', () => {
  it('démarre en boucle sur les bornes de la banque, même demandée avant le déverrouillage', async () => {
    const t = engine();
    t.audio.playMusic('arena');
    t.audio.unlock();
    await settle();
    const [music] = t.fake.music();
    expect(music).toBeDefined();
    expect([music!.loopStart, music!.loopEnd, music!.startedAt]).toEqual([0, 2, 0]);
    // Redemander le même morceau ne le relance pas.
    t.audio.playMusic('arena');
    expect(t.fake.music()).toHaveLength(1);
  });

  it('s’arrête, et ignore un morceau inconnu', async () => {
    const t = await unlocked();
    t.audio.playMusic('arena');
    t.audio.playMusic(null);
    expect(t.fake.music()[0]!.stopped).toBe(true);
    t.audio.playMusic('inconnue');
    expect(t.fake.music()).toHaveLength(1);
  });

  it('s’efface en pause et revient à la reprise', async () => {
    const t = await unlocked();
    t.audio.playMusic('arena');
    t.audio.setPaused(true);
    expect(t.fake.pause.gain.value).toBe(0);
    t.audio.setPaused(false);
    expect(t.fake.pause.gain.value).toBe(1);
  });
});

describe('fermeture', () => {
  it('ferme le contexte et ne joue plus rien', async () => {
    const t = await unlocked();
    t.audio.dispose();
    await settle();
    expect(t.audio.state).toBe('closed');
    expect(t.fake.state).toBe('closed');
    fight(t.audio).play(30);
    t.audio.play(SND_KO);
    expect(t.fake.effects()).toHaveLength(0);
  });
});
