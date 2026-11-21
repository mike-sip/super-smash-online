import { describe, expect, it } from 'vitest';
import { fx } from '../src/fixed.ts';
import { hitlagFrames, hitstunFrames, knockback } from '../src/systems/knockback.ts';

const kb = (percent: number, damage: number, weight: number, base: number, growth: number) =>
  knockback(fx(percent), fx(damage), fx(weight), fx(base), fx(growth));

describe('formule d’éjection', () => {
  it('donne les valeurs de référence', () => {
    // percent/10 + percent×damage/20 = 10 + 50 = 60 ; +18 = 78 ; ×1 + 20 = 98
    expect(kb(100, 10, 100, 20, 1)).toBe(fx(98));
    // 0 % : seul le plancher compte → 18 × 0,5 + 10 = 19
    expect(kb(0, 10, 100, 10, 0.5)).toBe(fx(19));
    // Poids 300 : facteur 200/400 = 0,5 → 60 × 0,5 + 18 = 48 ; + 20 = 68
    expect(kb(100, 10, 300, 20, 1)).toBe(fx(68));
  });

  it('vaut toujours l’éjection de base quand la croissance est nulle', () => {
    for (const percent of [0, 50, 150, 300]) {
      expect(kb(percent, 12, 100, 30, 0)).toBe(fx(30));
    }
  });

  it('croît avec les dégâts accumulés de la victime', () => {
    let last = -1;
    for (let percent = 0; percent <= 300; percent += 10) {
      const value = kb(percent, 10, 100, 20, 1);
      expect(value).toBeGreaterThan(last);
      last = value;
    }
  });

  it('croît avec les dégâts du coup', () => {
    expect(kb(80, 16, 100, 20, 1)).toBeGreaterThan(kb(80, 8, 100, 20, 1));
  });

  it('décroît avec le poids de la victime', () => {
    expect(kb(80, 10, 130, 20, 1)).toBeLessThan(kb(80, 10, 100, 20, 1));
    expect(kb(80, 10, 70, 20, 1)).toBeGreaterThan(kb(80, 10, 100, 20, 1));
  });
});

describe('hitlag et hitstun', () => {
  it('donne un gel de 4 frames plus une par tranche de 3 % de dégâts, plafonné à 20', () => {
    expect(hitlagFrames(fx(0))).toBe(4);
    expect(hitlagFrames(fx(3))).toBe(5);
    expect(hitlagFrames(fx(16))).toBe(9);
    expect(hitlagFrames(fx(100))).toBe(20);
  });

  it('donne un hitstun proportionnel à l’éjection, d’au moins une frame', () => {
    expect(hitstunFrames(fx(98))).toBe(39);
    expect(hitstunFrames(fx(1))).toBe(1);
    expect(hitstunFrames(fx(200))).toBeGreaterThan(hitstunFrames(fx(100)));
  });
});
