import { describe, expect, it } from 'vitest';
import { rankUnits, splitShare } from '../src/outcome.ts';

describe('splitShare', () => {
  it('partage à parts égales, le reste au plus petit index', () => {
    // 15 entre les joueurs 1, 2 et 3.
    expect([1, 2, 3].map((p) => splitShare(15, 0b1110, p))).toEqual([5, 5, 5]);
    // 10 entre 3 : 4 au plus petit index, 3 aux autres.
    expect([1, 2, 3].map((p) => splitShare(10, 0b1110, p))).toEqual([4, 3, 3]);
    expect(splitShare(7, 0b1, 0)).toBe(7);
    expect(splitShare(7, 0b1110, 0)).toBe(0);
  });
});

describe('rankUnits', () => {
  const ranks = (keyA: number[], keyB: number[], inRound = keyA.map(() => 1)) => {
    const out = new Int32Array(keyA.length);
    rankUnits(
      Int32Array.from(keyA),
      Int32Array.from(keyB),
      Int32Array.from(inRound),
      keyA.length,
      out,
    );
    return Array.from(out);
  };

  it('classe par clé décroissante, en rang de compétition (ex æquo partagés, place suivante sautée)', () => {
    expect(ranks([3, 1, 2], [0, 0, 0])).toEqual([1, 3, 2]);
    expect(ranks([2, 2, 1, 2], [0, 0, 0, 0])).toEqual([1, 1, 4, 1]);
  });

  it('départage par la seconde clé', () => {
    expect(ranks([2, 2, 1], [-30, -10, 0])).toEqual([2, 1, 3]);
    expect(ranks([2, 2], [-10, -10])).toEqual([1, 1]);
  });

  it('ignore les unités hors du tour, qui gardent 0', () => {
    expect(ranks([1, 5, 2], [0, 0, 0], [1, 0, 1])).toEqual([2, 0, 1]);
  });
});
