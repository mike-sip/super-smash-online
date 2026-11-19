import { describe, expect, it } from 'vitest';
import { meshSculpt } from '../src/fighters/mesher.ts';
import {
  BONES,
  compileSculpt,
  primitiveDistance,
  sculptDistance,
  smoothMin,
  type Sculpt,
} from '../src/fighters/sdf.ts';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const bindAll = (): number[][] => BONES.map(() => [...IDENTITY]);

describe('volumes', () => {
  it('capsule : distance nulle sur la surface, négative dedans', () => {
    const [q] = compileSculpt(
      [
        {
          bone: 'hips',
          shape: 'capsule',
          zone: 'skin',
          from: [0, 0, 0],
          to: [0, 1, 0],
          radius: 0.1,
        },
      ],
      bindAll(),
    );
    expect(primitiveDistance(q!, 0.1, 0.5, 0)).toBeCloseTo(0, 6);
    expect(primitiveDistance(q!, 0, 0.5, 0)).toBeCloseTo(-0.1, 6);
    expect(primitiveDistance(q!, 0, 1.3, 0)).toBeCloseTo(0.2, 6);
  });

  it('ellipsoïde et boîte arrondie : signe juste sur leurs axes', () => {
    const prims = compileSculpt(
      [
        {
          bone: 'hips',
          shape: 'ellipsoid',
          zone: 'skin',
          center: [0, 0, 0],
          size: [0.2, 0.1, 0.1],
        },
        {
          bone: 'hips',
          shape: 'box',
          zone: 'dark',
          center: [1, 0, 0],
          size: [0.1, 0.1, 0.1],
          round: 0.02,
        },
      ],
      bindAll(),
    );
    expect(primitiveDistance(prims[0]!, 0.19, 0, 0)).toBeLessThan(0);
    expect(primitiveDistance(prims[0]!, 0.21, 0, 0)).toBeGreaterThan(0);
    expect(primitiveDistance(prims[1]!, 1.1, 0, 0)).toBeCloseTo(0, 6);
    expect(primitiveDistance(prims[1]!, 1, 0, 0)).toBeLessThan(0);
  });

  it('suit le repère de son os', () => {
    const bind = bindAll();
    bind[BONES.indexOf('head')] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 2, 0, 1];
    const [q] = compileSculpt(
      [
        {
          bone: 'head',
          shape: 'ellipsoid',
          zone: 'skin',
          center: [0, 0, 0],
          size: [0.1, 0.1, 0.1],
        },
      ],
      bind,
    );
    expect(primitiveDistance(q!, 0, 2, 0)).toBeLessThan(0);
    expect(q!.bone).toBe(BONES.indexOf('head'));
  });

  it('copie symétrique : sur l’autre membre, ou de l’autre côté du tronc', () => {
    const prims = compileSculpt(
      [
        {
          bone: 'handF',
          shape: 'capsule',
          zone: 'skin',
          from: [0, 0, 0.1],
          to: [0, 0, 0.1],
          radius: 0.05,
          mirror: true,
        },
        {
          bone: 'spine',
          shape: 'capsule',
          zone: 'player',
          from: [0, 0, 0.2],
          to: [0, 0, 0.2],
          radius: 0.05,
          mirror: true,
        },
      ],
      bindAll(),
    );
    expect(prims.map((p) => BONES[p.bone])).toEqual(['handF', 'handB', 'spine', 'spine']);
    expect(prims[3]!.p[2]).toBeCloseTo(-0.2, 6);
  });

  it('union douce : plus de matière près de la jonction, rien de changé au loin', () => {
    expect(smoothMin(0.1, 0.1, 0.1)).toBeLessThan(0.1);
    expect(smoothMin(0.1, 0.5, 0.1)).toBe(0.1);
    expect(smoothMin(0.3, 0.1, 0)).toBe(0.1);
  });
});

describe('maillage', () => {
  const sphere: Sculpt = [
    { bone: 'head', shape: 'ellipsoid', zone: 'skin', center: [0, 0, 0], size: [0.2, 0.2, 0.2] },
  ];

  it('produit une surface fermée, sur le volume, aux normales tournées vers l’extérieur', () => {
    const prims = compileSculpt(sphere, bindAll());
    const mesh = meshSculpt(prims, 0.03);
    const count = mesh.positions.length / 3;
    expect(count).toBeGreaterThan(100);
    for (let v = 0; v < count; v++) {
      const x = mesh.positions[v * 3]!;
      const y = mesh.positions[v * 3 + 1]!;
      const z = mesh.positions[v * 3 + 2]!;
      expect(Math.abs(sculptDistance(prims, x, y, z))).toBeLessThan(0.006);
      const dot =
        x * mesh.normals[v * 3]! + y * mesh.normals[v * 3 + 1]! + z * mesh.normals[v * 3 + 2]!;
      expect(dot).toBeGreaterThan(0);
    }
    // Étanche : chaque arête est partagée par exactement deux triangles, dans des sens opposés.
    const edges = new Map<string, number>();
    for (let t = 0; t < mesh.index.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = mesh.index[t + e]!;
        const b = mesh.index[t + ((e + 1) % 3)]!;
        const key = `${a}-${b}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    for (const [key, n] of edges) {
      expect(n).toBe(1);
      const [a, b] = key.split('-');
      expect(edges.get(`${b}-${a}`)).toBe(1);
    }
    // Faces tournées vers l’extérieur.
    let outward = 0;
    for (let t = 0; t < mesh.index.length; t += 3) {
      const p = [0, 1, 2].map((e) => {
        const i = mesh.index[t + e]!;
        return [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
      });
      const u = p[1]!.map((c, i) => c - p[0]![i]!);
      const w = p[2]!.map((c, i) => c - p[0]![i]!);
      const n = [
        u[1]! * w[2]! - u[2]! * w[1]!,
        u[2]! * w[0]! - u[0]! * w[2]!,
        u[0]! * w[1]! - u[1]! * w[0]!,
      ];
      if (n[0]! * p[0]![0]! + n[1]! * p[0]![1]! + n[2]! * p[0]![2]! > 0) outward++;
    }
    expect(outward).toBe(mesh.index.length / 3);
  });

  it('une cellule plus fine donne plus de triangles', () => {
    const prims = compileSculpt(sphere, bindAll());
    expect(meshSculpt(prims, 0.02).index.length).toBeGreaterThan(
      meshSculpt(prims, 0.04).index.length,
    );
  });

  it('poids de peau normalisés, os du volume le plus proche, zone de couleur', () => {
    const bind = bindAll();
    const prims = compileSculpt(
      [
        {
          bone: 'upperArmF',
          shape: 'capsule',
          zone: 'primary',
          from: [0, 0, 0],
          to: [0, -0.3, 0],
          radius: 0.05,
        },
        {
          bone: 'forearmF',
          shape: 'capsule',
          zone: 'skin',
          from: [0, -0.3, 0],
          to: [0, -0.6, 0],
          radius: 0.05,
          blend: 0.03,
        },
      ],
      bind,
    );
    const mesh = meshSculpt(prims, 0.02);
    const count = mesh.positions.length / 3;
    const upper = BONES.indexOf('upperArmF');
    const fore = BONES.indexOf('forearmF');
    for (let v = 0; v < count; v++) {
      let sum = 0;
      for (let s = 0; s < 4; s++) sum += mesh.skinWeight[v * 4 + s]!;
      expect(sum).toBeCloseTo(1, 5);
      const y = mesh.positions[v * 3 + 1]!;
      if (y > -0.1) {
        expect(mesh.skinIndex[v * 4]).toBe(upper);
        expect(mesh.zones[v]).toBe(0);
      }
      if (y < -0.5) {
        expect(mesh.skinIndex[v * 4]).toBe(fore);
        expect(mesh.zones[v]).toBe(2);
      }
    }
  });
});
