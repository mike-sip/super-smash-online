import { fx, type StageDef } from '@game/sim-core';
import { TEST_STAGE } from '@game/sim-core/testing';
import { describe, expect, it } from 'vitest';
import { validateStage } from '../src/validate.ts';

/** Stage minimal valide pour 2 joueurs, que chaque test abîme d'une seule façon. */
function base(overrides: Partial<StageDef> = {}): StageDef {
  return {
    name: 'base',
    spawns: [
      { x: fx(-20), y: fx(0) },
      { x: fx(20), y: fx(0) },
    ],
    solids: [{ x1: fx(-50), y1: fx(-20), x2: fx(50), y2: fx(0) }],
    platforms: [{ x1: fx(-15), x2: fx(15), y: fx(25) }],
    blast: { left: fx(-150), right: fx(150), top: fx(120), bottom: fx(-80) },
    ...overrides,
  };
}

describe('validateStage', () => {
  it('accepte un stage correct et le stage de test de sim-core', () => {
    expect(validateStage(base(), 2)).toEqual([]);
    for (let players = 2; players <= 8; players++) {
      expect(validateStage(TEST_STAGE, players)).toEqual([]);
    }
  });

  it('signale des points d’apparition en nombre insuffisant', () => {
    const errors = validateStage(base(), 3);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/apparition/);
  });

  it('signale un point d’apparition dans le vide ou à côté d’une surface', () => {
    const floating = base({
      spawns: [
        { x: fx(-20), y: fx(3) },
        { x: fx(20), y: fx(0) },
      ],
    });
    expect(validateStage(floating, 2)[0]).toMatch(/J1.*surface/);
    const outside = base({
      spawns: [
        { x: fx(-20), y: fx(0) },
        { x: fx(60), y: fx(0) },
      ],
    });
    expect(validateStage(outside, 2)[0]).toMatch(/J2.*surface/);
  });

  it('signale deux points d’apparition trop proches', () => {
    const close = base({
      spawns: [
        { x: fx(-2), y: fx(0) },
        { x: fx(2), y: fx(0) },
      ],
    });
    expect(validateStage(close, 2)[0]).toMatch(/J1 et J2/);
  });

  it('signale une géométrie qui sort des zones limites', () => {
    const wide = base({ solids: [{ x1: fx(-160), y1: fx(-20), x2: fx(50), y2: fx(0) }] });
    expect(validateStage(wide, 2).some((e) => /zones limites/.test(e))).toBe(true);
    const high = base({ platforms: [{ x1: fx(-15), x2: fx(15), y: fx(130) }] });
    expect(validateStage(high, 2).some((e) => /zones limites/.test(e))).toBe(true);
  });

  it('signale une plateforme inaccessible', () => {
    const tooHigh = base({ platforms: [{ x1: fx(-15), x2: fx(15), y: fx(60) }] });
    expect(validateStage(tooHigh, 2)[0]).toMatch(/plateforme 1.*inaccessible/);
    // Une plateforme intermédiaire la rend accessible.
    const ladder = base({
      platforms: [
        { x1: fx(-15), x2: fx(15), y: fx(60) },
        { x1: fx(-30), x2: fx(-10), y: fx(30) },
      ],
    });
    expect(validateStage(ladder, 2)).toEqual([]);
    // Loin de tout, à l'horizontale.
    const aside = base({ platforms: [{ x1: fx(100), x2: fx(120), y: fx(20) }] });
    expect(validateStage(aside, 2)[0]).toMatch(/inaccessible/);
  });

  it('signale une plateforme mobile qui traverse un bloc plein ou sort des zones limites', () => {
    const through = base({
      platforms: [
        {
          x1: fx(-15),
          x2: fx(15),
          y: fx(25),
          motion: { dx: fx(0), dy: fx(-35), period: 120, phase: 0 },
        },
      ],
    });
    expect(validateStage(through, 2)[0]).toMatch(/plateforme 1.*bloc plein 1/);
    const away = base({
      platforms: [
        {
          x1: fx(-15),
          x2: fx(15),
          y: fx(25),
          motion: { dx: fx(160), dy: fx(0), period: 120, phase: 0 },
        },
      ],
    });
    expect(validateStage(away, 2).some((e) => /plateforme 1 sort des zones limites/.test(e))).toBe(
      true,
    );
    const fine = base({
      platforms: [
        {
          x1: fx(-15),
          x2: fx(15),
          y: fx(25),
          motion: { dx: fx(30), dy: fx(10), period: 120, phase: 0 },
        },
      ],
    });
    expect(validateStage(fine, 2)).toEqual([]);
  });

  it('refuse un point d’apparition sur une plateforme mobile', () => {
    const stage = base({
      spawns: [
        { x: fx(0), y: fx(25) },
        { x: fx(20), y: fx(0) },
      ],
      platforms: [
        {
          x1: fx(-15),
          x2: fx(15),
          y: fx(25),
          motion: { dx: fx(30), dy: fx(0), period: 120, phase: 0 },
        },
      ],
    });
    expect(validateStage(stage, 2)[0]).toMatch(/J1.*surface fixe/);
  });

  it('signale une zone d’apparition d’objets au-dessus du vide', () => {
    const ok = base({ itemSpawns: [{ x1: fx(-40), x2: fx(40), y: fx(70) }] });
    expect(validateStage(ok, 2)).toEqual([]);
    const off = base({ itemSpawns: [{ x1: fx(60), x2: fx(90), y: fx(70) }] });
    expect(validateStage(off, 2)[0]).toMatch(/zone d.objets 1/);
  });
});
