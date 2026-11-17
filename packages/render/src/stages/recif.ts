/**
 * Récif Nocturne : dalle de basalte vert au milieu d'un lagon, de nuit. Coraux luminescents,
 * colonnes de basalte dans l'eau, lune en croissant, étoiles. L'eau ondule doucement.
 */
import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  TetrahedronGeometry,
} from 'three';
import { at, between, facets, gradient } from './lowpoly.ts';
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
    const sky = new Mesh(
      gradient(at(new PlaneGeometry(2400, 1000, 1, 8), 0, 150, -700), 0x050a1c, 0x1d3463),
      new MeshBasicMaterial({ vertexColors: true, fog: false }),
    );
    sky.name = 'sky';
    ctx.root.add(sky);

    // Lune en croissant : un disque pâle, mordu par un disque couleur de ciel.
    ctx.glow.push(facets(at(new CircleGeometry(30, 18), 230, 170, -690), 0xf3f0d0, 0, random));
    ctx.glow.push(facets(at(new CircleGeometry(28, 18), 244, 178, -688), 0x0f1d42, 0, random));
    for (let n = 0; n < 140; n++) {
      const star = new TetrahedronGeometry(between(random, 0.8, 1.8));
      const x = between(random, -900, 900);
      const y = between(random, 60, 420);
      ctx.glow.push(facets(at(star, x, y, -690), 0xdfe8ff, 0.1, random));
    }

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

    const surface = new PlaneGeometry(1600, 900, 32, 16).rotateX(-Math.PI / 2);
    const water = new Mesh(
      facets(at(surface, 0, WATER_Y, -250), 0x1d5a86, 0.08, random),
      new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    );
    water.name = 'water';
    ctx.root.add(water);
    ctx.animate((frame) => {
      water.position.y = Math.sin(frame * 0.02) * 0.6;
    });
  },
};
