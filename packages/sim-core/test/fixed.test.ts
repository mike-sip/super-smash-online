import { describe, expect, it } from 'vitest';
import { FX_ONE, fx, fxCos, fxDiv, fxMul, fxSin, fxSqrt, fxToFloat } from '../src/fixed.ts';

describe('fx', () => {
  it('convertit un littéral en Q20.12', () => {
    expect(fx(1)).toBe(4096);
    expect(fx(0.5)).toBe(2048);
    expect(fx(-2.25)).toBe(-9216);
    expect(FX_ONE).toBe(4096);
  });

  it('revient en flottant pour le rendu', () => {
    expect(fxToFloat(fx(1.5))).toBe(1.5);
  });
});

describe('fxMul', () => {
  it('multiplie', () => {
    expect(fxMul(fx(2), fx(3))).toBe(fx(6));
    expect(fxMul(fx(0.5), fx(0.5))).toBe(fx(0.25));
    expect(fxMul(fx(-1.5), fx(2))).toBe(fx(-3));
  });

  it('arrondit vers zéro, symétriquement', () => {
    expect(fxMul(1, 1)).toBe(0);
    expect(fxMul(-1, 1)).toBe(0);
    expect(fxMul(4097, 4097)).toBe(4098);
    expect(fxMul(-4097, 4097)).toBe(-4098);
  });

  it('ne renvoie jamais -0', () => {
    expect(Object.is(fxMul(-1, 1), 0)).toBe(true);
  });

  it('reste exact tant que le résultat tient sur 32 bits', () => {
    const big = 2 ** 26 - 1;
    const other = 100_000;
    expect(fxMul(big, other)).toBe(Number((BigInt(big) * BigInt(other)) / 4096n));
    expect(fxMul(-big, other)).toBe(-Number((BigInt(big) * BigInt(other)) / 4096n));
  });

  it('renvoie toujours un entier 32 bits', () => {
    const r = fxMul(2 ** 30, 2 ** 30);
    expect(r).toBe(r | 0);
  });
});

describe('fxDiv', () => {
  it('divise', () => {
    expect(fxDiv(fx(6), fx(3))).toBe(fx(2));
    expect(fxDiv(fx(1), fx(4))).toBe(fx(0.25));
    expect(fxDiv(fx(-1), fx(4))).toBe(fx(-0.25));
  });

  it('arrondit vers zéro', () => {
    expect(fxDiv(fx(1), fx(3))).toBe(1365);
    expect(fxDiv(fx(-1), fx(3))).toBe(-1365);
  });

  it('renvoie 0 pour une division par zéro', () => {
    expect(fxDiv(fx(5), 0)).toBe(0);
  });
});

describe('fxSqrt', () => {
  it('calcule la racine', () => {
    expect(fxSqrt(fx(4))).toBe(fx(2));
    expect(fxSqrt(fx(0.25))).toBe(fx(0.5));
    expect(fxSqrt(0)).toBe(0);
  });

  it('arrondit par défaut', () => {
    // sqrt(2) = 1,41421356… → 5792,6 en Q12
    expect(fxSqrt(fx(2))).toBe(5792);
  });

  it('renvoie 0 pour un négatif', () => {
    expect(fxSqrt(fx(-4))).toBe(0);
  });

  it('est la racine entière exacte sur toute la plage', () => {
    for (const a of [1, 2, 3, 4095, 4096, 4097, 123456789, 2 ** 31 - 1]) {
      const r = BigInt(fxSqrt(a));
      const n = BigInt(a) * 4096n;
      expect(r * r <= n && (r + 1n) * (r + 1n) > n).toBe(true);
    }
  });
});

describe('fxSin / fxCos', () => {
  it('donne les valeurs cardinales exactes', () => {
    expect(fxSin(0)).toBe(0);
    expect(fxSin(90)).toBe(FX_ONE);
    expect(fxSin(180)).toBe(0);
    expect(fxSin(270)).toBe(-FX_ONE);
    expect(fxCos(0)).toBe(FX_ONE);
    expect(fxCos(90)).toBe(0);
    expect(fxCos(180)).toBe(-FX_ONE);
    expect(fxCos(270)).toBe(0);
  });

  it('donne sin(30°) = 0,5', () => {
    expect(fxSin(30)).toBe(fx(0.5));
    expect(fxCos(60)).toBe(fx(0.5));
  });

  it('normalise les angles hors de [0, 360)', () => {
    expect(fxSin(450)).toBe(fxSin(90));
    expect(fxSin(-90)).toBe(-FX_ONE);
    expect(fxCos(-360)).toBe(FX_ONE);
    expect(fxSin(-30)).toBe(-fxSin(30));
  });

  it('respecte les symétries sur tout le cercle', () => {
    for (let d = 0; d < 360; d++) {
      expect(fxSin(d + 180)).toBe(-fxSin(d) + 0);
      expect(fxCos(d)).toBe(fxSin(d + 90));
    }
  });

  it('reste à moins de 1/4096 de la valeur réelle', () => {
    for (let d = 0; d < 360; d++) {
      expect(Math.abs(fxToFloat(fxSin(d)) - Math.sin((d * Math.PI) / 180))).toBeLessThan(1 / 4096);
    }
  });
});
