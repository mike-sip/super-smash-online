import { describe, expect, it } from 'vitest';
import type { PlatformMotionDef } from '../src/defs.ts';
import { fx } from '../src/fixed.ts';
import { motionOffset } from '../src/systems/stage-motion.ts';

const out = { x: 0, y: 0 };
const at = (m: PlatformMotionDef, frame: number): { x: number; y: number } => {
  motionOffset(m, frame, out);
  return { x: out.x, y: out.y };
};

describe('trajectoire d’une plateforme mobile', () => {
  const m: PlatformMotionDef = { dx: fx(120), dy: fx(-30), period: 480, phase: 0 };

  it('part de sa position, atteint le décalage complet à mi-période, puis revient', () => {
    expect(at(m, 0)).toEqual({ x: 0, y: 0 });
    expect(at(m, 240)).toEqual({ x: m.dx, y: m.dy });
    expect(at(m, 480)).toEqual({ x: 0, y: 0 });
    expect(at(m, 480 * 7 + 240)).toEqual({ x: m.dx, y: m.dy });
  });

  it('est symétrique à l’aller et au retour', () => {
    for (let t = 0; t <= 240; t += 7) expect(at(m, t)).toEqual(at(m, 480 - t));
  });

  it('avance sans à-coup : monotone à l’aller, pas maximal borné, départ adouci', () => {
    // La pente maximale d'un départ adouci (3u² − 2u³) vaut 1,5 fois la pente moyenne ; u est
    // arrondi à l'entier, d'où une marge de quelques pour cent.
    const maxStep = Math.ceil((1.5 * 1.03 * m.dx) / 240) + 2;
    let prev = at(m, 0).x;
    for (let t = 1; t <= 240; t++) {
      const x = at(m, t).x;
      expect(x).toBeGreaterThanOrEqual(prev);
      expect(x - prev).toBeLessThanOrEqual(maxStep);
      prev = x;
    }
    // Les premiers pas sont nettement plus courts que le pas moyen.
    expect(at(m, 1).x).toBeLessThan(m.dx / 240 / 4);
  });

  it('applique la phase', () => {
    const shifted: PlatformMotionDef = { ...m, phase: 100 };
    for (const t of [0, 13, 380, 1000]) expect(at(shifted, t)).toEqual(at(m, t + 100));
  });

  it('ne renvoie que des entiers, pour toutes les frames d’une période impaire', () => {
    const odd: PlatformMotionDef = { dx: fx(33.3), dy: fx(17.7), period: 361, phase: 5 };
    for (let t = 0; t < 800; t++) {
      const p = at(odd, t);
      expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(Math.abs(odd.dx));
    }
  });
});
