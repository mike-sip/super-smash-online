/**
 * Arithmétique à virgule fixe Q20.12 : 1 unité de jeu = 4096.
 *
 * Pourquoi : `+ - * /` et `Math.trunc` sur des doubles sont spécifiés par IEEE 754 et donc
 * identiques dans tous les moteurs JavaScript, contrairement à `Math.sin` et consorts.
 *
 * Bornes : l'état est stocké en Int32, soit ±524 288 unités. `fxMul` et `fxDiv` sont exacts
 * tant que les opérandes restent dans ±2^26 (±16 384 unités) ; au-delà le résultat est
 * arrondi, mais reste identique d'une machine à l'autre.
 */
import { SIN_TABLE } from './trig-table.ts';

declare const fxBrand: unique symbol;

/** Nombre à virgule fixe. Les champs de données l'exigent pour refuser les flottants bruts. */
export type Fx = number & { readonly [fxBrand]: true };

export const FX_SHIFT = 12;
export const FX_ONE = 4096 as Fx;

/** Convertit un littéral (données, tests). À ne pas appeler dans `step`. */
export const fx = (n: number): Fx => (Math.round(n * FX_ONE) + 0) as Fx;

/** Pour le rendu uniquement : le résultat ne doit jamais revenir dans la simulation. */
export const fxToFloat = (a: number): number => a / FX_ONE;

// Le `+ 0` final transforme un éventuel -0 en 0, pour que les checksums ne dépendent pas du signe du zéro.

export const fxMul = (a: number, b: number): Fx => (Math.trunc((a * b) / FX_ONE) + 0) as Fx;

export const fxDiv = (a: number, b: number): Fx =>
  (b === 0 ? 0 : Math.trunc((a * FX_ONE) / b) + 0) as Fx;

/** Racine carrée arrondie par défaut. `Math.sqrt` ne sert que d'estimation, corrigée en entiers. */
export function fxSqrt(a: number): Fx {
  if (a <= 0) return 0 as Fx;
  const n = a * FX_ONE;
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r as Fx;
}

/** Sinus d'un angle en degrés entiers, quel que soit son signe ou sa taille. */
export function fxSin(deg: number): Fx {
  const d = ((deg % 360) + 360) % 360;
  if (d <= 90) return SIN_TABLE[d] as Fx;
  if (d <= 180) return SIN_TABLE[180 - d] as Fx;
  if (d <= 270) return -SIN_TABLE[d - 180]! as Fx;
  return -SIN_TABLE[360 - d]! as Fx;
}

export const fxCos = (deg: number): Fx => fxSin(deg + 90);
