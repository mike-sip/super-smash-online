import { A_ATTACK, A_GRABBING, A_HITSTUN, A_IDLE, A_ITEM_SWING } from '@game/sim-core';
import { describe, expect, it } from 'vitest';
import {
  FOOT_BOOST,
  HAND_BOOST,
  HEAD_BOOST,
  figurineDims,
  figurineSculpt,
} from '../src/fighters/body.ts';
import {
  F_BROW,
  F_IRIS,
  F_WHITE,
  createExpression,
  createFace,
  expressionOf,
  faceLayout,
} from '../src/fighters/face.ts';
import { gazeOf, handCurl } from '../src/fighters/figurine.ts';
import { DEFAULT_MATERIALS, zoneMaterials } from '../src/fighters/materials.ts';
import { dimsOf } from '../src/fighters/mannequin.ts';
import { mergeMeshes, meshRegions } from '../src/fighters/mesher.ts';
import { BONES, ZONES, compileSculpt } from '../src/fighters/sdf.ts';
import { createRig } from '../src/fighters/skeleton.ts';

describe('personnages v2 (SPEC-finition.md, phase 2)', () => {
  it('agrandit tête, mains et pieds autour de leur jointure, sans toucher au reste', () => {
    const d = dimsOf(undefined);
    const plain = figurineSculpt(d, undefined);
    const head = plain.find((p) => p.bone === 'head' && p.zone === 'skin')!;
    const thigh = plain.find((p) => p.bone === 'thighF')!;
    // Le crâne du mannequin est centré à ~1 rayon au-dessus du cou : agrandi de HEAD_BOOST.
    expect(head.center![1]).toBeCloseTo(d.headRadius * 1.02 * HEAD_BOOST, 6);
    expect(head.size![0]).toBeCloseTo(d.headRadius * 0.98 * HEAD_BOOST, 6);
    expect(thigh.radius).toBeCloseTo(d.legThickness * 0.62, 9);
    expect(figurineDims(d).headRadius).toBeCloseTo(d.headRadius * HEAD_BOOST, 9);
    expect(figurineDims(d).normalize).toBe(d.normalize);
    expect(HAND_BOOST).toBeGreaterThan(1);
    expect(FOOT_BOOST).toBeGreaterThan(1);
  });

  it('donne des doigts et un pouce à chaque main, portés par leurs os', () => {
    const parts = figurineSculpt(dimsOf(undefined), undefined);
    expect(parts.filter((p) => p.bone === 'fingersF')).toHaveLength(4);
    expect(parts.filter((p) => p.bone === 'thumbF')).toHaveLength(1);
    expect(parts.every((p) => p.bone !== 'fingersF' || p.mirror === true)).toBe(true);
  });

  it('maille tête et mains à part, plus finement, et fusionne le tout', () => {
    const d = figurineDims(dimsOf(undefined));
    const rig = createRig(d);
    const prims = compileSculpt(figurineSculpt(dimsOf(undefined), undefined), rig.bind);
    const hands = ['handF', 'handB', 'fingersF', 'fingersB', 'thumbF', 'thumbB'].map((b) =>
      BONES.indexOf(b as (typeof BONES)[number]),
    );
    const merged = meshRegions(prims, [{ bones: hands, cell: 1 / 120, falloff: 0.006 }], 1 / 50);
    const body = meshRegions(
      prims.filter((p) => !hands.includes(p.bone)),
      [],
      1 / 50,
    );
    expect(merged.zones.length).toBeGreaterThan(body.zones.length);
    // Indices décalés : aucun ne déborde des sommets.
    let max = 0;
    for (const i of merged.index) max = Math.max(max, i);
    expect(max).toBeLessThan(merged.zones.length);
    // Les sommets des mains ne suivent que les os de la main.
    const handVertices = merged.zones.length - body.zones.length;
    for (let v = body.zones.length; v < body.zones.length + handVertices; v++) {
      for (let s = 0; s < 4; s++) {
        if (merged.skinWeight[v * 4 + s]! > 0) {
          expect(hands).toContain(merged.skinIndex[v * 4 + s]);
        }
      }
    }
    expect(mergeMeshes([body])).toBe(body);
  });

  it('ferme les mains en poing pour frapper, les ouvre quand on est touché', () => {
    expect(handCurl(A_ATTACK)).toBe(1);
    expect(handCurl(A_GRABBING)).toBeGreaterThan(0.5);
    expect(handCurl(A_ITEM_SWING)).toBeGreaterThan(0.5);
    expect(handCurl(A_HITSTUN)).toBeLessThan(0.2);
    const idle = handCurl(A_IDLE);
    expect(idle).toBeGreaterThan(0.2);
    expect(idle).toBeLessThan(0.8);
  });

  it('regarde l’adversaire le plus proche : en haut s’il est devant et plus haut', () => {
    const xs = [0, 30, -200];
    const ys = [0, 40, 0];
    const ahead = gazeOf(0, 0, 0, 1, xs, ys);
    expect(ahead.y).toBeGreaterThan(0);
    expect(ahead.z).toBe(0);
    const behind = gazeOf(0, 0, 0, -1, xs, ys);
    expect(behind.z).not.toBe(0);
    expect(gazeOf(0, 0, 0, 1, [0, Number.NaN], [0, 0])).toEqual({ y: 0, z: 0 });
  });

  it('fronce les sourcils à l’attaque, les relève quand on est touché', () => {
    const e = createExpression();
    expressionOf(A_ATTACK, 0, 0, 1, 0, e);
    expect(e.brow).toBeLessThan(0);
    expressionOf(A_HITSTUN, 0, 0, 1, 0, e);
    expect(e.brow).toBeGreaterThan(0);
    const face = faceLayout(e, 0.05, 0, createFace());
    // Les deux sourcils s'inclinent en sens opposés ; l'iris suit le regard.
    expect(Math.sign(face[F_BROW]!.roll)).toBe(-Math.sign(face[F_BROW + 1]!.roll));
    expect(face[F_IRIS]!.y).toBeGreaterThan(face[F_WHITE]!.y);
  });

  it('donne une matière à chaque zone, que le personnage peut changer', () => {
    const base = zoneMaterials();
    expect(base.params).toHaveLength(ZONES.length);
    expect(DEFAULT_MATERIALS.accent).toBe('metal');
    const metal = ZONES.indexOf('accent');
    expect(base.params[metal]![1]).toBeGreaterThan(0.5);
    const silk = zoneMaterials({ accent: 'silk' });
    expect(silk.params[metal]![1]).toBe(0);
    expect(base.skin[ZONES.indexOf('skin')]).toBe(1);
  });
});
