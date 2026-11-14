/** Mannequins stylés : couleurs, proportions et pièces ajoutées, toujours en deux objets. */
import { describe, expect, it } from 'vitest';
import { createSim, step } from '@game/sim-core';
import { testConfig } from '@game/sim-core/testing';
import { Color, InstancedMesh, Matrix4, Vector3 } from 'three';
import {
  MAX_PARTS,
  createStyledMannequins,
  type MannequinStyle,
} from '../src/fighters/mannequin.ts';
import { PLAYER_COLORS } from '../src/fighters/visual.ts';
import { createRendererWith } from '../src/renderer.ts';
import { fakeBackend } from './helpers.ts';

const BUILD = {
  torsoWidth: 1,
  limbThickness: 1,
  headSize: 1,
  legLength: 1,
  armLength: 1,
  shoulderWidth: 1,
};

const STYLE: MannequinStyle = {
  primary: 0x112233,
  secondary: 0x445566,
  build: BUILD,
  parts: [
    {
      anchor: 'head',
      x: 0,
      y: 0.03,
      z: 0,
      width: 0.2,
      height: 0.05,
      depth: 0.2,
      angle: 0,
      color: 'player',
    },
    {
      anchor: 'torso',
      x: 0,
      y: 0.3,
      z: 0.15,
      width: 0.1,
      height: 0.06,
      depth: 0.08,
      angle: 0,
      color: 0xabcdef,
      mirror: true,
    },
  ],
};

/** Rendu d'une frame avec un style pour le joueur 0 et rien pour le joueur 1. */
function render(style: MannequinStyle) {
  const config = testConfig(2);
  const sim = createSim(config);
  const backend = fakeBackend();
  const renderer = createRendererWith(
    config,
    backend,
    undefined,
    undefined,
    createStyledMannequins((p) => (p === 0 ? style : undefined)),
  );
  renderer.resize(1280, 720, 1);
  step(sim, new Uint32Array(2));
  renderer.capture(sim);
  renderer.draw(1);
  const fighters = backend.scene!.getObjectByName('fighters')!;
  const boxes = fighters.children[0] as InstancedMesh;
  const heads = fighters.children[1] as InstancedMesh;
  const matrix = (mesh: InstancedMesh, i: number): Matrix4 => {
    const m = new Matrix4();
    mesh.getMatrixAt(i, m);
    return m;
  };
  const color = (mesh: InstancedMesh, i: number): number => {
    const c = new Color();
    mesh.getColorAt(i, c);
    return c.getHex();
  };
  return { fighters, boxes, heads, matrix, color };
}

/** Indice de la pièce `k` du joueur `p`, deux joueurs : après les 2 × 10 boîtes de corps. */
const partIndex = (p: number, k: number): number => 20 + p * MAX_PARTS + k;
const position = (m: Matrix4): Vector3 => new Vector3().setFromMatrixPosition(m);
/** Largeur d'une boîte : longueur de sa première colonne. */
const widthOf = (m: Matrix4): number => new Vector3().setFromMatrixColumn(m, 0).length();

describe('mannequins stylés', () => {
  it('restent deux objets dessinés par instances, pièces comprises', () => {
    const r = render(STYLE);
    let meshes = 0;
    r.fighters.traverse((o) => {
      if (o instanceof InstancedMesh) meshes++;
    });
    expect(meshes).toBe(2);
    expect(r.boxes.count).toBe(2 * (10 + MAX_PARTS));
  });

  it('peignent le corps aux couleurs du style, et une pièce à la couleur du joueur', () => {
    const r = render(STYLE);
    expect(r.color(r.boxes, 0)).toBe(STYLE.primary); // torse
    expect(r.color(r.boxes, 2)).toBe(STYLE.secondary); // bras côté caméra
    expect(r.color(r.heads, 0)).toBe(STYLE.secondary);
    expect(r.color(r.boxes, partIndex(0, 0))).toBe(PLAYER_COLORS[0]);
    expect(r.color(r.boxes, partIndex(0, 1))).toBe(0xabcdef);
    // Le joueur sans style garde la couleur de joueur partout.
    expect(r.color(r.boxes, 10)).toBe(PLAYER_COLORS[1]);
  });

  it('placent les pièces, copies symétriques comprises, et cachent les emplacements inutilisés', () => {
    const r = render(STYLE);
    const head = position(r.matrix(r.heads, 0));
    expect(position(r.matrix(r.boxes, partIndex(0, 0))).distanceTo(head)).toBeLessThan(1);
    const left = position(r.matrix(r.boxes, partIndex(0, 1)));
    const right = position(r.matrix(r.boxes, partIndex(0, 2)));
    expect(left.z).toBeCloseTo(-right.z, 6);
    expect(left.z).not.toBeCloseTo(0, 3);
    expect(r.matrix(r.boxes, partIndex(0, 3)).determinant()).toBe(0);
    expect(r.matrix(r.boxes, partIndex(1, 0)).determinant()).toBe(0);
  });

  it('appliquent les proportions sans changer la taille totale', () => {
    const plain = render(STYLE);
    const built = render({ ...STYLE, build: { ...BUILD, torsoWidth: 1.6, legLength: 1.3 } });
    expect(widthOf(built.matrix(built.boxes, 0))).toBeGreaterThan(
      1.3 * widthOf(plain.matrix(plain.boxes, 0)),
    );
    // La tête reste à peu près à la même hauteur : les jambes plus longues sont compensées.
    const top = (r: ReturnType<typeof render>): number => position(r.matrix(r.heads, 0)).y;
    expect(Math.abs(top(built) - top(plain))).toBeLessThan(0.05 * 12);
  });

  it('refusent un style qui dépasse le nombre de pièces', () => {
    const many = Array.from({ length: MAX_PARTS + 1 }, () => STYLE.parts[0]!);
    expect(() => render({ ...STYLE, parts: many })).toThrow(/au plus/);
  });
});
