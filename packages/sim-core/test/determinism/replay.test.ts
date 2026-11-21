import { describe, expect, it } from 'vitest';
import { testConfig } from '../../src/testing/fixtures.ts';
import { QUICK_CASES, REFERENCE_CASES, caseConfig, runCase } from './cases.ts';
import golden from './golden.json' with { type: 'json' };
import { playChecksum } from './harness.ts';

describe('checksums de référence', () => {
  it('couvre exactement les séquences de référence', () => {
    expect(
      golden.map(({ players, seed, inputSeed, frames }) => ({ players, seed, inputSeed, frames })),
    ).toEqual(REFERENCE_CASES);
  });

  // Si ce test échoue après un changement de comportement voulu, relancer `golden:update` et
  // commiter le nouveau golden.json seul, avec l'explication. Sinon, c'est une régression.
  it.each(golden)('retrouve le checksum de la graine $seed dans Node', (g) => {
    const stats = runCase(g);
    expect(stats.checksum).toBe(g.checksum);
    expect(stats.hits).toBe(g.hits);
    expect(stats.kos).toBe(g.kos);
  });

  it('exerce réellement le combat : des coups portent et des joueurs sont éjectés', () => {
    for (const g of golden) {
      expect(g.hits).toBeGreaterThan(200);
      expect(g.kos).toBeGreaterThan(20);
    }
  });
});

describe('déterminisme par double exécution', () => {
  it.each(QUICK_CASES)('rejoue à l’identique $frames frames à $players joueurs', (c) => {
    expect(runCase(c).checksum).toBe(runCase(c).checksum);
  });

  it('distingue deux séquences d’inputs différentes', () => {
    const config = testConfig(8);
    expect(playChecksum(config, 1, 600)).not.toBe(playChecksum(config, 2, 600));
  });

  it('ne dépend pas d’un état caché entre deux simulations', () => {
    const config = caseConfig(QUICK_CASES[2]!);
    const alone = playChecksum(config, 5, 600);
    playChecksum(testConfig(2), 77, 600);
    expect(playChecksum(config, 5, 600)).toBe(alone);
  });
});
