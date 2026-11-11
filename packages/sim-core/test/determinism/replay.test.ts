import { describe, expect, it } from 'vitest';
import { testConfig } from '../../src/testing/fixtures.ts';
import { CASES, caseConfig, runCase } from './cases.ts';
import { play, playChecksum } from './harness.ts';

/**
 * Déterminisme par double exécution. Les checksums de référence versionnés et la matrice
 * navigateurs arrivent en phase E (T17), quand la disposition mémoire sera stable.
 */
describe('déterminisme', () => {
  it.each(CASES)('rejoue à l’identique $frames frames à $players joueurs', (c) => {
    expect(runCase(c).checksum).toBe(runCase(c).checksum);
  });

  it('distingue deux séquences d’inputs différentes', () => {
    const config = testConfig(8);
    expect(playChecksum(config, 1, 600)).not.toBe(playChecksum(config, 2, 600));
  });

  it('ne dépend pas d’un état caché entre deux simulations', () => {
    const config = caseConfig(CASES[2]!);
    const alone = playChecksum(config, 5, 600);
    playChecksum(testConfig(2), 77, 600);
    expect(playChecksum(config, 5, 600)).toBe(alone);
  });

  it('exerce réellement le combat : des coups portent et des joueurs sont éjectés', () => {
    const stats = play(caseConfig(CASES[3]!), CASES[3]!.inputSeed, CASES[3]!.frames);
    expect(stats.hits).toBeGreaterThan(50);
    expect(stats.kos).toBeGreaterThan(5);
  });
});
