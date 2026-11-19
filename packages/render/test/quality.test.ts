import { describe, expect, it } from 'vitest';
import {
  QUALITIES,
  createAutoTuner,
  guessQuality,
  lowerQuality,
  pixelRatioFor,
  presetOf,
} from '../src/quality.ts';

describe('préréglages de qualité', () => {
  it('vont du moins cher au plus cher', () => {
    const presets = QUALITIES.map(presetOf);
    for (let i = 1; i < presets.length; i++) {
      const a = presets[i - 1]!;
      const b = presets[i]!;
      expect(b.shadowMapSize).toBeGreaterThanOrEqual(a.shadowMapSize);
      expect(b.maxPixelRatio * b.resolutionScale).toBeGreaterThanOrEqual(
        a.maxPixelRatio * a.resolutionScale,
      );
      expect(Number(b.bloom)).toBeGreaterThanOrEqual(Number(a.bloom));
      expect(Number(b.grading)).toBeGreaterThanOrEqual(Number(a.grading));
    }
  });

  it('Bas se passe de post-traitement et d’ombres portées', () => {
    const low = presetOf('low');
    expect(low.post).toBe(false);
    expect(low.bloom).toBe(false);
    expect(low.shadowMapSize).toBe(0);
    expect(low.resolutionScale).toBeLessThan(1);
  });

  it('Ultra a tout', () => {
    const ultra = presetOf('ultra');
    expect(ultra.post && ultra.bloom && ultra.grading && ultra.softShadows).toBe(true);
    expect(ultra.shadowMapSize).toBeGreaterThanOrEqual(2048);
  });

  it('le bloom suppose le post-traitement', () => {
    for (const q of QUALITIES) {
      const p = presetOf(q);
      if (p.bloom || p.grading || p.msaa > 0) expect(p.post).toBe(true);
    }
  });
});

describe('densité de pixels', () => {
  it('plafonne la densité de l’écran puis applique l’échelle', () => {
    expect(pixelRatioFor(presetOf('low'), 2)).toBeCloseTo(0.75);
    expect(pixelRatioFor(presetOf('ultra'), 3)).toBe(2);
    expect(pixelRatioFor(presetOf('ultra'), 1)).toBe(1);
    expect(pixelRatioFor(presetOf('medium'), 2)).toBe(presetOf('medium').maxPixelRatio);
  });
});

describe('détection de la carte graphique', () => {
  it.each([
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ultra'],
    ['ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ultra'],
    ['ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)', 'high'],
    ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'high'],
    ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'medium'],
    ['ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'medium'],
    ['Apple M2', 'medium'],
    ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'low'],
    ['ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'low'],
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 'low'],
    ['llvmpipe (LLVM 15.0.7, 256 bits)', 'low'],
    ['Mali-G78', 'low'],
    ['', 'high'],
    ['WebKit WebGL', 'high'],
  ] as const)('%s → %s', (gpu, expected) => {
    expect(guessQuality(gpu)).toBe(expected);
  });
});

describe('ajustement automatique', () => {
  const run = (start: Parameters<typeof createAutoTuner>[0], intervals: number[]) => {
    const tuner = createAutoTuner(start);
    const changes: string[] = [];
    for (const ms of intervals) {
      const q = tuner.sample(ms);
      if (q !== null) changes.push(q);
    }
    return { changes, tuner };
  };

  it('garde le niveau quand les images arrivent à temps', () => {
    const { changes, tuner } = run('ultra', new Array(600).fill(16.7));
    expect(changes).toEqual([]);
    expect(tuner.quality).toBe('ultra');
  });

  it('ignore les premières images (compilation des shaders)', () => {
    const intervals = [...new Array(30).fill(80), ...new Array(300).fill(16.7)];
    expect(run('high', intervals).changes).toEqual([]);
  });

  it('baisse d’un cran quand trop d’images sont en retard', () => {
    const { changes } = run('ultra', new Array(150).fill(24));
    expect(changes[0]).toBe('high');
  });

  it('peut baisser plusieurs fois, jamais sous Bas', () => {
    const { changes, tuner } = run('medium', new Array(2000).fill(40));
    expect(changes).toEqual(['low']);
    expect(tuner.quality).toBe('low');
  });

  it('se fige après la période d’évaluation : jamais de changement en plein match', () => {
    const late = [...new Array(400).fill(16.7), ...new Array(2000).fill(40)];
    const { changes, tuner } = run('ultra', late);
    expect(changes).toEqual([]);
    expect(tuner.done).toBe(true);
  });

  it('un écran à 120 Hz qui tombe à 60 images ne compte pas comme un retard', () => {
    const mixed = Array.from({ length: 300 }, (_, i) => (i % 2 === 0 ? 8.3 : 16.7));
    expect(run('ultra', mixed).changes).toEqual([]);
  });

  it('lowerQuality descend d’un cran et s’arrête à Bas', () => {
    expect(lowerQuality('ultra')).toBe('high');
    expect(lowerQuality('low')).toBe('low');
  });
});
