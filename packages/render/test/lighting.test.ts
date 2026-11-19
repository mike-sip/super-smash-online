import { MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { createLighting, fitShadow, type ShadowFit } from '../src/lighting.ts';
import { presetOf } from '../src/quality.ts';

const TAN = Math.tan((35 * Math.PI) / 360);
const THEME = { sky: 0xffffff, ground: 0x333333, ambient: 1.5, sun: 0xffeedd, sunIntensity: 2 };

describe('carte d’ombre calée sur la caméra', () => {
  const fit = (cx: number, cy: number, distance: number, size = 2048): ShadowFit => {
    const out = { centerX: 0, centerY: 0, half: 0 };
    fitShadow({ centerX: cx, centerY: cy, distance }, TAN, 16 / 9, size, out);
    return out;
  };

  it('couvre tout le champ visible', () => {
    const out = fit(10, 20, 200);
    const halfWidth = 200 * TAN * (16 / 9);
    expect(out.half).toBeGreaterThanOrEqual(halfWidth);
  });

  it('reste dans des bornes raisonnables', () => {
    expect(fit(0, 0, 1).half).toBeGreaterThanOrEqual(60);
    expect(fit(0, 0, 100_000).half).toBeLessThanOrEqual(420);
  });

  it('aligne son centre sur la grille des texels (pas de scintillement)', () => {
    const out = fit(13.37, -4.2, 180);
    const texel = (2 * out.half) / 2048;
    expect(Math.abs(out.centerX / texel - Math.round(out.centerX / texel))).toBeLessThan(1e-6);
    expect(Math.abs(out.centerY / texel - Math.round(out.centerY / texel))).toBeLessThan(1e-6);
  });

  it('ne change de taille que par paliers pendant un zoom', () => {
    const sizes = new Set<number>();
    for (let d = 150; d < 160; d += 0.1) sizes.add(fit(0, 0, d).half);
    expect(sizes.size).toBeLessThanOrEqual(2);
  });
});

describe('lumières', () => {
  it('les ombres portées suivent le préréglage', () => {
    const lighting = createLighting(THEME);
    lighting.configure(presetOf('low'));
    expect(lighting.sun.castShadow).toBe(false);
    lighting.configure(presetOf('ultra'));
    expect(lighting.sun.castShadow).toBe(true);
    expect(lighting.sun.shadow.mapSize.x).toBe(presetOf('ultra').shadowMapSize);
  });

  it('la lumière de contour s’ajoute au shader des matières physiques', () => {
    const lighting = createLighting(THEME);
    const material = new MeshStandardMaterial();
    lighting.addRim(material);
    const shader = {
      uniforms: {},
      fragmentShader: '#include <common>\nvoid main(){\n#include <emissivemap_fragment>\n}',
    };
    material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.fragmentShader).toContain('rimColor');
    expect(shader.uniforms).toHaveProperty('rimStrength');
  });
});
