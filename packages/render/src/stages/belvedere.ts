/**
 * Belvédère des Brumes : terrasse de grès sculpté suspendue au-dessus d'une mer de nuages, à
 * l'aube. Rochers flottants au loin, soleil bas, nuages hauts qui dérivent lentement.
 */
import {
  BoxGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  type BufferGeometry,
} from 'three';
import { at, between, facets, merge, seeded } from './lowpoly.ts';
import { SOLID_DEPTH, type DecorContext, type Theme } from './theme.ts';

const SAND = 0xd9a066;
const ROCK = 0xb57a45;
const CLOUD = 0xfbe3d0;

export const BELVEDERE_THEME: Theme = {
  id: 'belvedere',
  background: 0xf6c28b,
  fog: { color: 0xeab995, near: 320, far: 950 },
  sky: 0xffe9d6,
  ground: 0x7a5a6a,
  ambient: 1.4,
  sun: 0xffd2a0,
  sunIntensity: 2,
  solid: SAND,
  platform: 0xe4b47e,
  mover: 0xe4b47e,
  seed: 11,
  skyLook: {
    zenith: 0x4f63a8,
    horizon: 0xf6c28b,
    below: 0xeab995,
    sunDir: [-0.3, 0.05, -1],
    sunColor: 0xffd9a0,
    sunSize: 0.06,
    sunGlow: 0.12,
    clouds: 0.42,
    cloudColor: 0xfbe3d0,
  },
  motes: [
    {
      count: 260,
      center: [0, 40, -40],
      half: [220, 90, 120],
      color: 0xffd59a,
      intensity: 1.6,
      size: 0.5,
      drift: [0.05, 0.01],
      seed: 11,
    },
  ],

  solidShape(x1, y1, x2, y2, ctx) {
    const w = x2 - x1;
    const cx = (x1 + x2) / 2;
    // Dalle de la terrasse, puis la roche qui s'effile dessous (décor : la collision est la boîte).
    ctx.lit.push(
      facets(at(new BoxGeometry(w, 6, SOLID_DEPTH), cx, y2 - 3, 0), SAND, 0.05, ctx.random),
    );
    const rock = new CylinderGeometry(w / 2, w / 7, 70, 7, 3);
    ctx.lit.push(facets(at(rock, cx, y2 - 6 - 35, 0, 1, 1, 0.42), ROCK, 0.14, ctx.random));
    // Balustrade au fond de la terrasse, derrière les combattants.
    for (let x = x1 + 6; x <= x2 - 6; x += 13) {
      ctx.lit.push(
        facets(at(new BoxGeometry(2.2, 7, 2.2), x, y2 + 3.5, -15), SAND, 0.08, ctx.random),
      );
    }
    ctx.lit.push(
      facets(at(new BoxGeometry(w - 8, 1.6, 3), cx, y2 + 7.5, -15), SAND, 0.05, ctx.random),
    );
    void y1;
  },

  decorate(ctx: DecorContext) {
    const { random } = ctx;
    // Mer de nuages sous le stage.
    for (let n = 0; n < 46; n++) {
      const puff = new IcosahedronGeometry(1, 1);
      ctx.lit.push(
        facets(
          at(
            puff,
            between(random, -520, 520),
            between(random, -95, -45),
            between(random, -520, 40),
            between(random, 14, 34),
            between(random, 6, 11),
            between(random, 12, 30),
          ),
          CLOUD,
          0.05,
          random,
        ),
      );
    }
    // Rochers flottants au loin.
    for (let n = 0; n < 9; n++) {
      const r = between(random, 6, 16);
      const x = between(random, -420, 420);
      const y = between(random, -20, 90);
      const z = between(random, -480, -220);
      ctx.lit.push(
        facets(at(new DodecahedronGeometry(r, 0), x, y, z, 1, 1.3, 1), ROCK, 0.15, random),
      );
      ctx.lit.push(
        facets(
          at(new CylinderGeometry(r * 0.9, r * 0.8, 2, 6), x, y + r * 1.2, z),
          0x9bb06a,
          0.1,
          random,
        ),
      );
    }

    // Nuages hauts : une seule pièce qui dérive, selon la frame.
    const high: BufferGeometry[] = [];
    const cloudRandom = seeded(77);
    for (let n = 0; n < 14; n++) {
      high.push(
        facets(
          at(
            new IcosahedronGeometry(1, 1),
            between(cloudRandom, -600, 600),
            between(cloudRandom, 110, 200),
            between(cloudRandom, -560, -420),
            between(cloudRandom, 20, 40),
            between(cloudRandom, 5, 9),
            8,
          ),
          0xfff1e6,
          0.04,
          cloudRandom,
        ),
      );
    }
    const drift = new Mesh(
      merge(high),
      new MeshStandardMaterial({ vertexColors: true, flatShading: true }),
    );
    drift.name = 'clouds';
    ctx.root.add(drift);
    ctx.animate((frame) => {
      drift.position.x = Math.sin(frame * 0.0009) * 60;
    });
  },
};
