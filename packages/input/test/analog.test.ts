import { describe, expect, it } from 'vitest';
import { STICK_MAX } from '@game/sim-core';
import { dominant, isPressed, shapeStick, type StickValue } from '../src/analog.ts';

const DEADZONE = 0.15;
// Seuils de `sim-core` : attaque dirigée, course, dash et smash.
const TILT = 40;
const RUN = 64;
const SMASH = 96;

function shape(x: number, y: number, deadzone = DEADZONE): StickValue {
  const out = { x: 0, y: 0 };
  shapeStick(x, y, deadzone, out);
  return out;
}

describe('shapeStick', () => {
  it('donne 0 au repos, dérive comprise jusqu’à la zone morte', () => {
    expect(shape(0, 0)).toEqual({ x: 0, y: 0 });
    for (let angle = 0; angle < Math.PI * 2; angle += 0.2) {
      const drift = shape(Math.cos(angle) * 0.149, Math.sin(angle) * 0.149);
      expect(drift).toEqual({ x: 0, y: 0 });
    }
  });

  it('donne 127 stick à fond sur chaque axe', () => {
    expect(shape(1, 0)).toEqual({ x: STICK_MAX, y: 0 });
    expect(shape(-1, 0)).toEqual({ x: -STICK_MAX, y: 0 });
    expect(shape(0, 1)).toEqual({ x: 0, y: STICK_MAX });
    expect(shape(0, -1)).toEqual({ x: 0, y: -STICK_MAX });
  });

  it('atteint 127 même si le stick s’arrête un peu avant la butée', () => {
    expect(shape(0.96, 0).x).toBe(STICK_MAX);
    expect(shape(0, -0.96).y).toBe(-STICK_MAX);
  });

  it('donne 127 sur les deux axes stick à fond en diagonale, sur un stick rond', () => {
    const d = Math.SQRT1_2;
    expect(shape(d, d)).toEqual({ x: STICK_MAX, y: STICK_MAX });
    expect(shape(-d, d)).toEqual({ x: -STICK_MAX, y: STICK_MAX });
    expect(shape(d, -d)).toEqual({ x: STICK_MAX, y: -STICK_MAX });
    expect(shape(-d, -d)).toEqual({ x: -STICK_MAX, y: -STICK_MAX });
  });

  it('reste dans les bornes sur un stick carré, qui dépasse 1 en diagonale', () => {
    expect(shape(1, 1)).toEqual({ x: STICK_MAX, y: STICK_MAX });
    expect(shape(-1, 1)).toEqual({ x: -STICK_MAX, y: STICK_MAX });
  });

  it('permet dash et smash dans les huit directions', () => {
    for (let step = 0; step < 8; step++) {
      const angle = (step * Math.PI) / 4;
      const out = shape(Math.cos(angle), Math.sin(angle));
      const strongest = Math.max(Math.abs(out.x), Math.abs(out.y));
      expect(strongest).toBeGreaterThanOrEqual(SMASH);
      // En diagonale, les deux axes passent le seuil.
      if (step % 2 === 1) {
        expect(Math.abs(out.x)).toBeGreaterThanOrEqual(SMASH);
        expect(Math.abs(out.y)).toBeGreaterThanOrEqual(SMASH);
      }
    }
  });

  it('sort de la zone morte sans à-coup', () => {
    expect(Math.abs(shape(0.16, 0).x)).toBeLessThanOrEqual(3);
    expect(Math.abs(shape(0.2, 0).x)).toBeLessThan(TILT);
  });

  it('croît avec l’inclinaison, sans jamais reculer', () => {
    for (const angle of [0, 0.3, Math.PI / 4, 1.2, Math.PI / 2]) {
      let before = 0;
      for (let reach = 0; reach <= 1.0001; reach += 0.01) {
        const out = shape(Math.cos(angle) * reach, Math.sin(angle) * reach);
        const size = Math.hypot(out.x, out.y);
        expect(size).toBeGreaterThanOrEqual(before - 1e-9);
        before = size;
      }
    }
  });

  it('est symétrique : le même geste de l’autre côté donne l’opposé', () => {
    for (let x = -1; x <= 1; x += 0.07) {
      for (let y = -1; y <= 1; y += 0.07) {
        const a = shape(x, y);
        const b = shape(-x, -y);
        expect(b.x).toBe(a.x === 0 ? 0 : -a.x);
        expect(b.y).toBe(a.y === 0 ? 0 : -a.y);
      }
    }
  });

  it('ne produit que des entiers de -127 à 127', () => {
    for (let x = -1.2; x <= 1.2; x += 0.11) {
      for (let y = -1.2; y <= 1.2; y += 0.11) {
        const out = shape(x, y);
        for (const value of [out.x, out.y]) {
          expect(Number.isInteger(value)).toBe(true);
          expect(Math.abs(value)).toBeLessThanOrEqual(STICK_MAX);
        }
      }
    }
  });

  it('laisse marcher à mi-course et courir au-delà', () => {
    const half = shape(0.5, 0).x;
    expect(half).toBeGreaterThanOrEqual(TILT);
    expect(half).toBeLessThan(RUN);
    expect(shape(0.75, 0).x).toBeGreaterThanOrEqual(RUN);
  });

  it('ne déforme presque pas un geste proche d’un axe', () => {
    // Stick poussé à droite avec 5° d'écart : l'axe vertical reste sous la zone neutre de sim-core.
    const out = shape(Math.cos(0.087), Math.sin(0.087));
    expect(out.x).toBe(STICK_MAX);
    expect(Math.abs(out.y)).toBeLessThan(20);
  });

  it('respecte la zone morte demandée et traite les valeurs aberrantes comme le repos', () => {
    expect(shape(0.3, 0, 0.4)).toEqual({ x: 0, y: 0 });
    expect(shape(0.3, 0, 0).x).toBeGreaterThan(30);
    expect(shape(Number.NaN, 0.5)).toEqual({ x: 0, y: 0 });
  });
});

describe('dominant', () => {
  it('garde la plus forte des quatre directions du stick droit, au-dessus du seuil', () => {
    expect(dominant(0.9, 0.6, 0, 0, 0.5)).toBe(0);
    expect(dominant(0.6, 0.9, 0, 0, 0.5)).toBe(1);
    expect(dominant(0, 0, 0.7, 0.2, 0.5)).toBe(2);
    expect(dominant(0, 0.55, 0, 0.8, 0.5)).toBe(3);
  });

  it('ne donne rien sous le seuil', () => {
    expect(dominant(0.49, 0.3, 0.2, 0.1, 0.5)).toBe(-1);
    expect(dominant(0, 0, 0, 0, 0.5)).toBe(-1);
  });

  it('départage une égalité toujours de la même façon', () => {
    expect(dominant(0.8, 0.8, 0.8, 0.8, 0.5)).toBe(0);
  });
});

describe('isPressed', () => {
  it('ramène une valeur analogique à un bouton par un seuil', () => {
    expect(isPressed(0.5, 0.5)).toBe(true);
    expect(isPressed(1, 0.5)).toBe(true);
    expect(isPressed(0.49, 0.5)).toBe(false);
    expect(isPressed(0, 0.5)).toBe(false);
  });
});
