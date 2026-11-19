/**
 * Canal des Lanternes : quai de pierre d'une cité fluviale au crépuscule. Façades en silhouette
 * aux fenêtres allumées, guirlande de lanternes qui se balance, eau sombre du canal.
 */
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  type BufferGeometry,
} from 'three';
import { at, between, facets, merge, seeded } from './lowpoly.ts';
import { SOLID_DEPTH, type DecorContext, type Theme } from './theme.ts';

const STONE = 0x8a7f74;
const COPING = 0xa39887;
const FACADE = 0x3b2a4a;
const WINDOW = 0xffc46b;
const WATER_Y = -26;

export const CANAL_THEME: Theme = {
  id: 'canal',
  background: 0xb0566a,
  fog: { color: 0x7d4a6a, near: 260, far: 900 },
  sky: 0xffc7a0,
  ground: 0x3a2a4a,
  ambient: 1.3,
  sun: 0xff9e6b,
  sunIntensity: 1.6,
  solid: STONE,
  platform: 0xb07a45,
  // Barge et nacelles : bois sombre.
  mover: 0xb07a45,
  seed: 37,
  skyLook: {
    zenith: 0x2a1f4a,
    horizon: 0xf08a4b,
    below: 0x3a2a4a,
    sunDir: [0.4, 0.035, -1],
    sunColor: 0xff9e6b,
    sunSize: 0.05,
    sunGlow: 0.08,
    clouds: 0.35,
    cloudColor: 0xd9708a,
    stars: 0.3,
  },
  water: { y: WATER_Y, z: -200, width: 1600, depth: 900, color: 0x1c1636, waves: 0.35 },
  motes: [
    {
      count: 160,
      center: [0, 30, -60],
      half: [200, 40, 90],
      color: 0xffc06a,
      intensity: 2.5,
      size: 0.45,
      drift: [0.02, 0.03],
      seed: 37,
    },
  ],

  solidShape(x1, y1, x2, y2, ctx) {
    const w = x2 - x1;
    const cx = (x1 + x2) / 2;
    // Assises de pierre, légèrement irrégulières.
    for (let y = y1; y < y2 - 2; y += 4) {
      const course = new BoxGeometry(w, 4, SOLID_DEPTH);
      ctx.lit.push(facets(at(course, cx, y + 2, 0), STONE, 0.1, ctx.random));
    }
    // Margelle le long du bord avant.
    for (let x = x1 + 3; x < x2; x += 6) {
      const stone = new BoxGeometry(5.6, 1.4, 4);
      ctx.lit.push(facets(at(stone, x, y2 - 0.7, SOLID_DEPTH / 2 - 2), COPING, 0.08, ctx.random));
    }
  },

  decorate(ctx: DecorContext) {
    const { random } = ctx;
    // Façades en silhouette au fond, fenêtres allumées au hasard.
    for (let n = 0; n < 22; n++) {
      const w = between(random, 22, 42);
      const h = between(random, 40, 130);
      const x = -380 + n * 36 + between(random, -6, 6);
      const z = between(random, -260, -150);
      ctx.lit.push(
        facets(at(new BoxGeometry(w, h, 24), x, WATER_Y + h / 2, z), FACADE, 0.12, random),
      );
      if (n % 3 !== 0) {
        const roof = new ConeGeometry(w * 0.72, 14, 4);
        ctx.lit.push(
          facets(at(roof, x, WATER_Y + h + 7, z, 1, 1, 0.6, Math.PI / 4), 0x2a1d36, 0.1, random),
        );
      }
      for (let wy = WATER_Y + 12; wy < WATER_Y + h - 8; wy += 12) {
        for (let wx = x - w / 2 + 5; wx < x + w / 2 - 4; wx += 8) {
          if (random() < 0.55) continue;
          const pane = new BoxGeometry(3, 4.5, 0.4);
          ctx.glow.push(facets(at(pane, wx, wy, z + 12.3), WINDOW, 0.15, random));
        }
      }
    }
    // Poteaux de la guirlande.
    for (const x of [-95, 95]) {
      const pole = new CylinderGeometry(1.2, 1.5, 78, 6);
      ctx.lit.push(facets(at(pole, x, 39, -32), 0x3a2a22, 0.1, random));
    }

    // Guirlande de lanternes : une seule pièce, qui se balance.
    const lanterns: BufferGeometry[] = [];
    const lanternRandom = seeded(5);
    for (let n = 0; n <= 10; n++) {
      const x = -90 + n * 18;
      const sag = 1 - (x / 95) * (x / 95);
      const y = 66 - 12 * sag;
      const color = n % 2 === 0 ? 0xffb347 : 0xff7a59;
      const lantern = new OctahedronGeometry(2.4);
      lanterns.push(facets(at(lantern, x, y - 4, 0, 1, 1.4, 1), color, 0.1, lanternRandom));
      lanterns.push(
        facets(at(new BoxGeometry(0.3, 3, 0.3), x, y - 0.5, 0), 0x2a1d1a, 0, lanternRandom),
      );
    }
    const garland = new Mesh(
      merge(lanterns),
      new MeshBasicMaterial({ vertexColors: true, fog: false }),
    );
    garland.name = 'lanterns';
    garland.position.set(0, 0, -32);
    ctx.root.add(garland);

    ctx.animate((frame) => {
      garland.rotation.z = Math.sin(frame * 0.025) * 0.012;
    });
  },
};
