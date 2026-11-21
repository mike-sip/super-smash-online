import { describe, expect, it } from 'vitest';
import { SOUND_COUNT } from '../src/audio/cues.ts';
import { createSynthBank } from '../src/audio/bank.ts';
import { ARENA_STYLE } from '../src/audio/music.ts';

/** Fréquence réduite : les tests restent rapides, la logique est la même. */
const SR = 11_025;

describe('banque synthétisée', () => {
  it('ne rend rien avant la fin du chargement', () => {
    const bank = createSynthBank({ sampleRate: SR });
    expect(bank.sound(0)).toBeNull();
    expect(bank.music('arena')).toBeNull();
    // Par défaut : les menus, l'arène, un thème par stage, puis les jingles de victoire.
    expect(bank.tracks).toEqual(
      expect.arrayContaining(['menu', 'arena', 'belvedere', 'victory-wind']),
    );
  });

  it('rend tous les sons et la musique une fois chargée', async () => {
    const bank = createSynthBank({ sampleRate: SR });
    await bank.load();
    for (let id = 0; id < SOUND_COUNT; id++) {
      const sound = bank.sound(id);
      expect(sound).not.toBeNull();
      expect(sound!.sampleRate).toBe(SR);
      expect(sound!.channels).toHaveLength(1);
      expect(sound!.channels[0]!.length).toBeGreaterThan(0);
    }
    expect(bank.sound(SOUND_COUNT)).toBeNull();
    expect(bank.sound(-1)).toBeNull();
    expect(bank.music('inconnue')).toBeNull();
    // Seul le thème des menus est rendu au chargement ; les autres le sont à la demande.
    expect(bank.music('menu')).not.toBeNull();
    expect(bank.music('arena')).toBeNull();
    await bank.ensure!('arena');

    const music = bank.music('arena')!;
    expect(music.channels).toHaveLength(2);
    expect(music.loopStart).toBe(0);
    expect(music.loopEnd).toBeCloseTo(music.channels[0]!.length / SR, 9);
    expect(music.loopEnd).toBeCloseTo(25.6, 3);
  }, 30_000);

  it('rend la main entre deux tranches de calcul', async () => {
    let yields = 0;
    const bank = createSynthBank({
      sampleRate: SR,
      sliceMs: 1,
      yieldToHost: () => {
        yields++;
        return Promise.resolve();
      },
    });
    await bank.load();
    expect(yields).toBeGreaterThan(5);
  });

  it('ne charge qu’une fois', async () => {
    const bank = createSynthBank({ sampleRate: SR });
    const first = bank.load();
    expect(bank.load()).toBe(first);
    await first;
  });

  it('accepte d’autres styles de musique', async () => {
    const bank = createSynthBank({
      sampleRate: SR,
      styles: [ARENA_STYLE, { ...ARENA_STYLE, name: 'autre', seed: 3, bpm: 120 }],
    });
    expect(bank.tracks).toEqual(['arena', 'autre']);
    await bank.load();
    expect(bank.music('autre')!.loopEnd).toBeCloseTo((16 * 4 * 60) / 120, 3);
  });
});
