import { describe, expect, it } from 'vitest';
import { testConfig } from '../../src/testing/fixtures.ts';
import { playChecksum } from './harness.ts';

/**
 * Déterminisme par double exécution. Les checksums de référence versionnés et la matrice
 * navigateurs arrivent en phase E (T17), quand la disposition mémoire sera stable.
 */
describe('déterminisme', () => {
  it.each([2, 4, 8])('rejoue à l’identique 3 600 frames à %i joueurs', (players) => {
    const config = testConfig(players, 99);
    expect(playChecksum(config, 2024, 3600)).toBe(playChecksum(config, 2024, 3600));
  });

  it('distingue deux séquences d’inputs différentes', () => {
    const config = testConfig(8);
    expect(playChecksum(config, 1, 600)).not.toBe(playChecksum(config, 2, 600));
  });

  it('ne dépend pas d’un état caché entre deux simulations', () => {
    const config = testConfig(8);
    const alone = playChecksum(config, 5, 600);
    playChecksum(testConfig(2), 77, 600);
    expect(playChecksum(config, 5, 600)).toBe(alone);
  });
});
