/**
 * Bassin des Geysers : terrasses minérales ocre et bassins turquoise, cristaux. Chaque évent
 * fume de plus en plus fort avant de jaillir ; le jet lui-même est dessiné avec les entités
 * (`stages/items.ts`).
 */
import { fxToFloat } from '@game/sim-core';
import {
  BoxGeometry,
  CircleGeometry,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  TorusGeometry,
  type BufferGeometry,
} from 'three';
import { at, between, facets, gradient, hazardLevel, merge, seeded } from './lowpoly.ts';
import { SOLID_DEPTH, type DecorContext, type Theme } from './theme.ts';

const STRATA = [0xc98b4a, 0xd9a35e, 0xb8743c] as const;
const POOL = 0x4fd1c5;
const CRYSTALS = [0x9be7ff, 0xc7a6ff, 0xffffff] as const;
/** Évents du décor : dessinés même quand les dangers sont désactivés. */
const VENT_X = [-44, 44];

export const GEYSERS_THEME: Theme = {
  id: 'geysers',
  background: 0xd9cfb4,
  fog: { color: 0xd8cdb2, near: 320, far: 950 },
  sky: 0xfff4e0,
  ground: 0x8a6a4a,
  ambient: 1.5,
  sun: 0xffffff,
  sunIntensity: 1.7,
  solid: STRATA[0],
  platform: 0xf4e2bd,
  mover: 0xf4e2bd,
  seed: 41,

  solidShape(x1, y1, x2, y2, ctx) {
    const cx = (x1 + x2) / 2;
    // Strates, chacune un peu plus étroite que celle du dessus.
    let w = x2 - x1;
    let k = 0;
    for (let y = y2; y > y1; y -= 6) {
      const h = Math.min(6, y - y1);
      const layer = new BoxGeometry(w, h, SOLID_DEPTH);
      ctx.lit.push(facets(at(layer, cx, y - h / 2, 0), STRATA[k % 3]!, 0.06, ctx.random));
      w -= 3;
      k++;
    }
  },

  decorate(ctx: DecorContext) {
    const { random } = ctx;
    const sky = new Mesh(
      gradient(at(new PlaneGeometry(2400, 1000, 1, 8), 0, 120, -700), 0x7fb7c9, 0xf1e1c0),
      new MeshBasicMaterial({ vertexColors: true, fog: false }),
    );
    sky.name = 'sky';
    ctx.root.add(sky);

    // Terrasses en gradins au fond, chacune coiffée de son bassin.
    for (let row = 0; row < 5; row++) {
      const z = -220 - row * 80;
      const y = -48 + row * 12;
      for (let n = 0; n < 7; n++) {
        const w = between(random, 70, 130);
        const x = -420 + n * 140 + between(random, -20, 20);
        const color = STRATA[(row + n) % 3]!;
        ctx.lit.push(facets(at(new BoxGeometry(w, 18, 50), x, y - 9, z), color, 0.08, random));
        ctx.lit.push(facets(at(new BoxGeometry(w - 8, 1, 40), x, y + 0.4, z), POOL, 0.04, random));
      }
    }
    for (let n = 0; n < 28; n++) {
      const x = between(random, -400, 400);
      if (Math.abs(x) < 100) continue;
      const h = between(random, 2, 4);
      const y = between(random, -10, 30);
      const z = between(random, -300, -90);
      const crystal = new OctahedronGeometry(2.2);
      ctx.lit.push(facets(at(crystal, x, y, z, 1, h, 1), CRYSTALS[n % 3]!, 0.1, random));
    }

    // Évents : un anneau sombre et un fond rougeoyant ; vapeur qui grossit pendant l'annonce.
    const hazards = ctx.stage.hazards ?? [];
    for (const vx of VENT_X) {
      const ring = new TorusGeometry(5, 1.2, 5, 9).rotateX(Math.PI / 2);
      ctx.lit.push(facets(at(ring, vx, 0.4, 0), 0x5a3b28, 0.1, random));
      const ember = new CircleGeometry(4.2, 9).rotateX(-Math.PI / 2);
      ctx.glow.push(facets(at(ember, vx, 0.15, 0), 0xff9a3d, 0.05, random));

      const hazard = hazards.find((h) => Math.abs(fxToFloat(h.x) - vx) < 1);
      if (hazard === undefined) continue;
      const puffs: BufferGeometry[] = [];
      const puffRandom = seeded(vx + 100);
      for (let n = 0; n < 4; n++) {
        const puff = new IcosahedronGeometry(1, 0);
        const px = between(puffRandom, -3, 3);
        const pz = between(puffRandom, -2, 2);
        puffs.push(
          facets(
            at(puff, px, 2 + n * 3.5, pz, 2 + n, 1.6 + n * 0.6, 2 + n),
            0xffffff,
            0.04,
            puffRandom,
          ),
        );
      }
      const steam = new Mesh(
        merge(puffs),
        new MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.6,
          depthWrite: false,
        }),
      );
      steam.name = 'steam';
      steam.position.set(vx, 0, 0);
      steam.visible = false;
      ctx.root.add(steam);
      ctx.animate((frame) => {
        const level = hazardLevel(hazard, frame);
        steam.visible = level > 0;
        const wobble = 1 + Math.sin(frame * 0.6) * 0.08 * level;
        steam.scale.set(0.4 + level * wobble, 0.3 + level * 0.8, 0.4 + level * wobble);
      });
    }
  },
};
