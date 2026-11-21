import { describe, expect, it } from 'vitest';
import {
  createParticleLayer,
  createParticlePool,
  createSpec,
  emit,
  hash01,
  liveParticles,
  particleAt,
} from '../src/vfx/particles.ts';

describe('réserve de particules', () => {
  it('une particule vit de sa naissance à la fin de sa durée', () => {
    const pool = createParticlePool(8);
    emit(pool, { ...createSpec(), life: 10 }, 100);
    expect(liveParticles(pool, 99)).toBe(0);
    expect(liveParticles(pool, 100)).toBe(1);
    expect(liveParticles(pool, 109.9)).toBe(1);
    expect(liveParticles(pool, 110)).toBe(0);
  });

  it('suit sa vitesse, freinée et tirée vers le bas', () => {
    const pool = createParticlePool(4);
    const at = { x: 0, y: 0 };
    emit(pool, { ...createSpec(), x: 5, y: 0, vx: 2, life: 30 }, 0);
    particleAt(pool, 0, 10, at);
    expect(at.x).toBeCloseTo(25, 6);

    emit(pool, { ...createSpec(), vx: 2, drag: 0.2, life: 100 }, 0);
    particleAt(pool, 1, 90, at);
    // Freinée, elle tend vers vx / drag = 10.
    expect(at.x).toBeLessThan(10);
    expect(at.x).toBeGreaterThan(9.9);

    emit(pool, { ...createSpec(), gravity: 0.1, life: 100 }, 0);
    particleAt(pool, 2, 10, at);
    expect(at.y).toBeCloseTo(-5, 6);
  });

  it('tourne en rond quand elle est pleine, sans allouer', () => {
    const pool = createParticlePool(3);
    const spec = createSpec();
    for (let i = 0; i < 5; i++) emit(pool, { ...spec, x: i, life: 50 }, 0);
    expect(pool.next).toBe(2);
    expect(pool.start[0]).toBe(3);
    expect(liveParticles(pool, 1)).toBe(3);
  });

  it('retient les emplacements à envoyer à la carte graphique', () => {
    const layer = createParticleLayer(16, false);
    const spec = createSpec();
    emit(layer.pool, spec, 0);
    emit(layer.pool, spec, 0);
    expect([layer.pool.dirtyMin, layer.pool.dirtyMax]).toEqual([0, 1]);
    layer.update(1);
    expect(layer.pool.dirtyMax).toBeLessThan(layer.pool.dirtyMin);
    layer.dispose();
  });

  it('une réserve vide (qualité basse) ignore les émissions', () => {
    const pool = createParticlePool(0);
    expect(() => emit(pool, createSpec(), 0)).not.toThrow();
    expect(pool.emitted).toBe(0);
  });
});

describe('hasard reproductible', () => {
  it('même graine, même valeur, dans [0, 1)', () => {
    expect(hash01(12, 3)).toBe(hash01(12, 3));
    expect(hash01(12, 3)).not.toBe(hash01(12, 4));
    let sum = 0;
    for (let i = 0; i < 1000; i++) {
      const v = hash01(i, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 1000).toBeGreaterThan(0.45);
    expect(sum / 1000).toBeLessThan(0.55);
  });
});
