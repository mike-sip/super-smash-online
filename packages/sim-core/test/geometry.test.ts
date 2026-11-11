import { describe, expect, it } from 'vitest';
import { capsulesOverlap, segmentDistanceSq } from '../src/geometry.ts';

/** Cercle = capsule dont les deux extrémités coïncident. */
const circles = (x1: number, y1: number, r1: number, x2: number, y2: number, r2: number) =>
  capsulesOverlap(x1, y1, x1, y1, r1, x2, y2, x2, y2, r2);

describe('segmentDistanceSq', () => {
  it('mesure la distance entre deux points', () => {
    expect(segmentDistanceSq(0, 0, 0, 0, 3, 4, 3, 4)).toBe(25);
  });

  it('mesure la distance d’un point à un segment', () => {
    expect(segmentDistanceSq(5, 3, 5, 3, 0, 0, 10, 0)).toBe(9);
    // Au-delà de l'extrémité : distance au bout du segment.
    expect(segmentDistanceSq(13, 4, 13, 4, 0, 0, 10, 0)).toBe(25);
    expect(segmentDistanceSq(0, 0, 10, 0, 13, 4, 13, 4)).toBe(25);
  });

  it('vaut 0 pour deux segments qui se croisent', () => {
    expect(segmentDistanceSq(-5, 0, 5, 0, 0, -5, 0, 5)).toBe(0);
  });

  it('mesure l’écart entre deux segments parallèles', () => {
    expect(segmentDistanceSq(0, 0, 10, 0, 0, 4, 10, 4)).toBe(16);
    expect(segmentDistanceSq(0, 0, 10, 0, 2, 4, 8, 4)).toBe(16);
  });

  it('mesure l’écart entre deux segments alignés et disjoints', () => {
    expect(segmentDistanceSq(0, 0, 10, 0, 13, 0, 20, 0)).toBe(9);
  });

  it('est symétrique', () => {
    const a = segmentDistanceSq(1, 2, 7, 5, -3, 8, 4, 9);
    const b = segmentDistanceSq(-3, 8, 4, 9, 1, 2, 7, 5);
    expect(a).toBe(b);
  });
});

describe('capsulesOverlap', () => {
  it('détecte deux cercles qui se recouvrent, se touchent, ou non', () => {
    expect(circles(0, 0, 3, 4, 0, 2)).toBe(true);
    expect(circles(0, 0, 3, 5, 0, 2)).toBe(true);
    expect(circles(0, 0, 3, 6, 0, 2)).toBe(false);
  });

  it('prend en compte toute la longueur d’une capsule', () => {
    // Capsule horizontale de x = 4 à 10, rayon 2 ; cercle de rayon 3.
    const hit = (x: number, y: number) => capsulesOverlap(4, 6, 10, 6, 2, x, y, x, y, 3);
    expect(hit(7, 10)).toBe(true);
    expect(hit(14, 6)).toBe(true);
    expect(hit(16, 6)).toBe(false);
    expect(hit(7, 12)).toBe(false);
  });

  it('détecte deux capsules qui se croisent', () => {
    expect(capsulesOverlap(-5, 0, 5, 0, 1, 0, -5, 0, 5, 1)).toBe(true);
  });

  it('donne le même résultat une fois la scène retournée horizontalement', () => {
    for (const x of [3, 5.5, 8, 11, 14.9, 15, 15.1]) {
      const right = capsulesOverlap(4, 6, 10, 6, 2, x, 6, x, 9, 3);
      const left = capsulesOverlap(-4, 6, -10, 6, 2, -x, 6, -x, 9, 3);
      expect(left).toBe(right);
    }
  });
});
