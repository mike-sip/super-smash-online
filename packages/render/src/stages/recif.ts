/**
 * Récif Nocturne : dalle de basalte vert au milieu d'un lagon, de nuit. Coraux luminescents,
 * colonnes de basalte dans l'eau, lune en croissant, étoiles. L'eau ondule doucement.
 */
import { BoxGeometry, ConeGeometry, CylinderGeometry, OctahedronGeometry } from 'three';
import { at, between, facets } from './lowpoly.ts';
import { SOLID_DEPTH, type DecorContext, type Theme } from './theme.ts';

const BASALT_TOP = 0x5b8a78;
const BASALT = 0x36585a;
const WATER_Y = -24;
const CORALS = [0x4ff0d8, 0xd65bf0, 0xf6e27a, 0x6aa8ff];

export const RECIF_THEME: Theme = {
  id: 'recif',
  background: 0x0d1834,
  fog: { color: 0x0f1d3d, near: 260, far: 820 },
  sky: 0x8fa8ff,
  ground: 0x23415a,
  ambient: 1.6,
  sun: 0xbcd0ff,
  sunIntensity: 1.5,
  solid: BASALT,
  platform: BASALT_TOP,
  mover: BASALT_TOP,
  seed: 23,
  skyLook: {
    zenith: 0x050a1c,
    horizon: 0x1d3463,
    below: 0x0d1834,
    sunDir: [0.3, 0.22, -1],
    sunColor: 0xf3f0d0,
    sunSize: 0.045,
    sunGlow: 0.05,
    crescent: true,
    stars: 1,
    clouds: 0.15,
    cloudColor: 0x2a3c6a,
  },
  water: { y: WATER_Y, z: -250, width: 1600, depth: 900, color: 0x0f3456, waves: 0.45 },
  motes: [
    {
      count: 300,
      center: [0, 0, -40],
      half: [240, 50, 120],
      color: 0x5ff0e0,
      intensity: 2.2,
      size: 0.35,
      drift: [0.01, 0.02],
      seed: 23,
    },
  ],

  solidShape(x1, y1, x2, y2, ctx) {
    const w = x2 - x1;
    const cx = (x1 + x2) / 2;
    // Dessus franc, corps en retrait : les rebords se lisent nettement.
    ctx.lit.push(
      facets(at(new BoxGeometry(w, 4, SOLID_DEPTH), cx, y2 - 2, 0), BASALT_TOP, 0.05, ctx.random),
    );
    const body = new BoxGeometry(w - 12, y2 - 4 - y1, SOLID_DEPTH - 6);
    ctx.lit.push(facets(at(body, cx, (y1 + y2 - 4) / 2, 0), BASALT, 0.08, ctx.random));
    // Colonnes hexagonales sur la face avant.
    for (let x = x1 + 10; x <= x2 - 10; x += 7) {
      const h = between(ctx.random, 10, 22);
      const column = new CylinderGeometry(3.2, 3.2, h, 6);
      ctx.lit.push(
        facets(at(column, x, y2 - 4 - h / 2, SOLID_DEPTH / 2 - 4), BASALT, 0.12, ctx.random),
      );
    }
  },

  decorate(ctx: DecorContext) {
    const { random } = ctx;
    // Coraux luminescents, hors de la zone de jeu.
    for (let n = 0; n < 40; n++) {
      const x = between(random, -380, 380);
      const z = between(random, -360, 70);
      if (Math.abs(x) < 95 && z > -30) continue;
      const h = between(random, 3, 9);
      const cone = n % 2 === 0;
      const shape = cone
        ? new ConeGeometry(between(random, 1, 2.5), h, 5)
        : new OctahedronGeometry(1.6);
      const color = CORALS[n % CORALS.length]!;
      ctx.glow.push(
        facets(at(shape, x, WATER_Y + h / 2 - 1, z, 1, cone ? 1 : h / 3, 1), color, 0.15, random),
      );
    }
    // Colonnes de basalte dans l'eau.
    for (let n = 0; n < 16; n++) {
      const x = between(random, -330, 330);
      if (Math.abs(x) < 110) continue;
      const h = between(random, 6, 26);
      const z = between(random, -300, -40);
      const column = new CylinderGeometry(4, 4.5, h, 6);
      ctx.lit.push(facets(at(column, x, WATER_Y + h / 2 - 3, z), BASALT, 0.15, random));
    }
  },
};
