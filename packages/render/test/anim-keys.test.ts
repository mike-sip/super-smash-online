/** Animation par clés des outils d'export (tools/anim/keys.ts). */
import { describe, expect, it } from 'vitest';
import {
  REST,
  compile,
  ease,
  resolveAt,
  sample,
  type Channels,
  type Timing,
} from '../tools/anim/keys.ts';

const TIMING: Timing = { start: 6, end: 9, total: 30, charge: 4 };

describe('instants des clés', () => {
  it('lit les frames et les repères de la frame data', () => {
    expect(resolveAt(12, TIMING)).toBe(12);
    expect(resolveAt('s', TIMING)).toBe(6);
    expect(resolveAt('e+3', TIMING)).toBe(12);
    expect(resolveAt('s-2', TIMING)).toBe(4);
    expect(resolveAt('t*0.5', TIMING)).toBe(15);
    expect(resolveAt('c', TIMING)).toBe(4);
    expect(() => resolveAt('x+1', TIMING)).toThrow(/illisible/);
  });
});

describe('courbes', () => {
  it('partent de 0 et arrivent à 1', () => {
    for (const kind of ['linear', 'in', 'out', 'inOut', 'snap', 'settle', 'back'] as const) {
      expect(ease(kind, 0)).toBeCloseTo(0, 9);
      expect(ease(kind, 1)).toBeCloseTo(1, 9);
    }
  });

  it('« snap » part plus vite que « in », « back » dépasse avant de revenir', () => {
    expect(ease('snap', 0.2)).toBeGreaterThan(ease('in', 0.2));
    expect(Math.max(...[0.6, 0.7, 0.8, 0.9].map((t) => ease('back', t)))).toBeGreaterThan(1);
    expect(ease('step', 0.99)).toBe(0);
  });
});

describe('pistes', () => {
  it('une clé hérite des canaux de la précédente', () => {
    const track = compile(
      {
        name: 'test',
        keys: [
          { at: 0, pose: { armF: 1 } },
          { at: 's', pose: { legF: 0.5 } },
        ],
      },
      REST,
      TIMING,
    );
    expect(track.poses[1]!.armF).toBe(1);
    expect(track.poses[1]!.legF).toBe(0.5);
    expect(track.length).toBe(30);
  });

  it('la frame active tombe exactement sur la pose de frappe', () => {
    const track = compile(
      {
        name: 'coup',
        keys: [
          { at: 's*0.5', pose: { armF: -0.5 } },
          { at: 's', pose: { armF: 1.6 }, ease: 'snap' },
          { at: 't', pose: { armF: 0 } },
        ],
      },
      REST,
      TIMING,
    );
    const out = { ...REST } as Channels;
    expect(sample(track, 6, out).armF).toBeCloseTo(1.6, 9);
    expect(sample(track, 3, out).armF).toBeCloseTo(-0.5, 9);
    expect(sample(track, 30, out).armF).toBeCloseTo(0, 9);
  });

  it('garde les clés dans l’ordre et dans la durée quand la frame data est serrée', () => {
    const track = compile(
      {
        name: 'serré',
        keys: [
          { at: 'e+30', pose: { armF: 1 } },
          { at: 't', pose: { armF: 0 } },
        ],
      },
      REST,
      TIMING,
    );
    expect(track.frames).toEqual([30, 30]);
  });

  it('une boucle se referme sur sa première clé', () => {
    const track = compile(
      {
        name: 'boucle',
        loop: 40,
        keys: [
          { at: 0, pose: { torso: 0 } },
          { at: 20, pose: { torso: 0.4 } },
        ],
      },
      REST,
      TIMING,
    );
    const out = { ...REST } as Channels;
    expect(sample(track, 40, out).torso).toBeCloseTo(0, 9);
    expect(sample(track, 20, out).torso).toBeCloseTo(0.4, 9);
  });
});
