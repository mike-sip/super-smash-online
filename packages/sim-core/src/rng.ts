/**
 * Générateur xorshift32 dont l'unique mot d'état vit dans l'état de simulation :
 * un rollback rejoue donc exactement les mêmes tirages.
 */
import { G_RNG, type SimState } from './state.ts';

export function rngSeed(s: SimState, seed: number): void {
  // xorshift reste bloqué à 0 : une graine nulle est remplacée par une constante.
  s.g[G_RNG] = seed | 0 || 0x9e3779b9 | 0;
}

/** Entier non signé sur 32 bits. */
export function rngNext(s: SimState): number {
  let x = s.g[G_RNG]!;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.g[G_RNG] = x;
  return x >>> 0;
}

/** Entier uniforme dans [0, n), pour n < 2^21. */
export function rngRange(s: SimState, n: number): number {
  return Math.floor((rngNext(s) * n) / 0x100000000);
}
