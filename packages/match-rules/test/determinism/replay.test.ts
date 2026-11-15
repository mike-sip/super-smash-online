import { describe, expect, it } from 'vitest';
import golden from './golden.json' with { type: 'json' };
import { REFERENCE_CASES, runReference } from './harness.ts';

/**
 * Matchs de référence (critère de succès n° 3) : 8 joueurs, 36 000 frames, inputs aléatoires.
 * Checksum final et résultats comparés à la référence versionnée (golden.json).
 */
describe('matchs de référence', () => {
  it.each(REFERENCE_CASES.map((c, i) => ({ c, g: golden[i]! })))(
    'retrouve le match $c.name dans Node',
    ({ c, g }) => {
      expect(g.name).toBe(c.name);
      const outcome = runReference(c);
      expect({ name: c.name, ...outcome }).toEqual(g);
    },
  );

  it('chaque match de référence se termine', () => {
    for (const g of golden) expect(g.phase).toBe('over');
  });
});
