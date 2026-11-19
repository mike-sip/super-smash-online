import { A_HITSTUN, A_IDLE, createSim, step } from '@game/sim-core';
import { testConfig } from '@game/sim-core/testing';
import type { SkinnedMesh } from 'three';
import { describe, expect, it } from 'vitest';
import {
  distinctPalettes,
  figurineSculpt,
  paletteOf,
  type FigurineStyle,
} from '../src/fighters/body.ts';
import { expressionOf, createExpression } from '../src/fighters/face.ts';
import { createFigurines } from '../src/fighters/figurine.ts';
import { dimsOf } from '../src/fighters/mannequin.ts';
import { presetOf } from '../src/quality.ts';
import { createRendererWith } from '../src/renderer.ts';
import { fakeBackend } from './helpers.ts';

const STYLE: FigurineStyle = {
  primary: 0x5aa9e6,
  secondary: 0xf1f5f9,
  build: {
    torsoWidth: 1,
    limbThickness: 1,
    headSize: 1,
    legLength: 1,
    armLength: 1,
    shoulderWidth: 1,
  },
  parts: [
    {
      anchor: 'torso',
      x: 0,
      y: 0.3,
      z: 0.2,
      width: 0.1,
      height: 0.05,
      depth: 0.1,
      angle: 0,
      color: 0x334155,
      mirror: true,
    },
  ],
};

describe('corps des figurines', () => {
  it('garde les pièces du mannequin tant qu’un personnage n’a pas de volumes propres', () => {
    const d = dimsOf(STYLE);
    const base = figurineSculpt(d, undefined).length;
    expect(figurineSculpt(d, STYLE).length).toBe(base + 1);
    const own: FigurineStyle = {
      ...STYLE,
      sculpt: [
        {
          bone: 'head',
          shape: 'ellipsoid',
          zone: 'hair',
          center: [0, 0.2, 0],
          size: [0.1, 0.1, 0.1],
        },
      ],
    };
    expect(figurineSculpt(d, own).length).toBe(base + 1);
    expect(figurineSculpt(d, own).at(-1)!.zone).toBe('hair');
  });

  it('palette : couleurs du style, couleur du joueur, couleurs fixes des pièces', () => {
    const palette = paletteOf(STYLE, 1);
    expect(palette[0]).toBe(0x5aa9e6);
    expect(palette[7]).toBe(0x3e7bfa);
    expect(palette[4]).toBe(0x334155);
    expect(paletteOf({ ...STYLE, palette: { skin: 0x123456 } }, 0)[2]).toBe(0x123456);
  });
});

describe('expressions', () => {
  it('touché : bouche ouverte ; au repos : clignement de temps en temps', () => {
    const e = createExpression();
    expect(expressionOf(A_HITSTUN, 0, 0, 10, 0, e).mouth).toBeGreaterThan(0.5);
    let blinks = 0;
    for (let clock = 0; clock < 400; clock++) {
      if (expressionOf(A_IDLE, 0, 0, clock, 0, e).eyes < 0.2) blinks++;
    }
    expect(blinks).toBeGreaterThan(0);
    expect(blinks).toBeLessThan(20);
  });
});

describe('figurines dans le renderer', () => {
  it('construit un corps lisse et skinné par joueur, et le pose', () => {
    const config = testConfig(2);
    const sim = createSim(config);
    const started = performance.now();
    const backend = fakeBackend();
    const renderer = createRendererWith(
      config,
      backend,
      undefined,
      undefined,
      createFigurines((p) => (p === 0 ? STYLE : undefined)),
      { quality: 'ultra' },
    );
    const built = performance.now() - started;
    console.log(`Deux figurines construites en ${built.toFixed(0)} ms`);
    const inputs = new Uint32Array(2);
    for (let f = 0; f < 5; f++) {
      step(sim, inputs);
      renderer.capture(sim);
    }
    renderer.draw(0.5);
    expect(renderer.quality).toBe('ultra');
    const body = backend.scene!.getObjectByName('figurine-0') as SkinnedMesh;
    expect(body.visible).toBe(true);
    expect(backend.scene!.getObjectByName('fighter-0')!.visible).toBe(true);
    renderer.dispose();
  });

  it('budget de triangles et contour selon la qualité', () => {
    const config = testConfig(1);
    const factory = createFigurines(() => STYLE);
    const visuals = factory(config);
    const body = visuals.root.getObjectByName('figurine-0') as SkinnedMesh;
    const triangles = body.geometry.index!.count / 3;
    console.log(`Figurine : ${triangles} triangles`);
    expect(triangles).toBeGreaterThan(3000);
    expect(triangles).toBeLessThan(14000);
    expect(body.skeleton.bones.length).toBe(21);
    const outline = visuals.root.getObjectByName('outline-0')!;
    visuals.setQuality!(presetOf('low'));
    expect(outline.visible).toBe(false);
    visuals.setQuality!(presetOf('ultra'));
    expect(outline.visible).toBe(true);
    visuals.dispose();
  });
});

describe('couleurs alternatives', () => {
  it('chaque joueur sur le même personnage reçoit une couleur différente', () => {
    expect(distinctPalettes(['sorel', 'sorel', 'nacre', 'sorel'])).toEqual([0, 1, 0, 2]);
    expect(distinctPalettes(['sorel', 'sorel'], [3, 3])).toEqual([3, 4]);
    expect(distinctPalettes(['ferroc', 'nacre'], [5, 5])).toEqual([5, 5]);
  });

  it('une couleur alternative remplace une partie des teintes de base', () => {
    const style: FigurineStyle = {
      ...STYLE,
      palettes: [{}, { primary: 0x111111, hair: 0x222222 }],
    };
    expect(paletteOf(style, 0, 0)[0]).toBe(0x5aa9e6);
    expect(paletteOf(style, 0, 1)[0]).toBe(0x111111);
    expect(paletteOf(style, 0, 1)[3]).toBe(0x222222);
    expect(paletteOf(style, 0, 1)[1]).toBe(STYLE.secondary);
  });
});
