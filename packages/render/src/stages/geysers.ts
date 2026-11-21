/**
 * Bassin des Geysers : terrasses minérales d'une vallée volcanique, en fin de journée
 * (SPEC-finition.md, phase 1).
 *
 * Premier plan : le bloc principal en strates de roche ocre, chacune bordée d'une lèvre de
 * travertin pâle d'où pendent des concrétions ; deux évents encroûtés, rougeoyants, qui fument de
 * plus en plus fort avant de jaillir (le jet est dessiné avec les entités, `stages/items.ts`).
 * Plan moyen : terrasses en gradins coiffées de bassins turquoise, cristaux. Lointain : un volcan
 * dont le cratère rougeoie.
 */
import { fxToFloat } from '@game/sim-core';
import {
  CircleGeometry,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  TorusGeometry,
  type BufferGeometry,
} from 'three';
import { at, between, facets, hazardLevel, merge, seeded } from './lowpoly.ts';
import { boulder, displace, paint, roundedBox } from './sculpt.ts';
import { SOLID_DEPTH, type DecorContext, type Theme } from './theme.ts';

const OCHRE = 0xc98b4a;
const CLIFF = 0xa87048;
const TRAVERTINE = 0xe8d8c0;
const POOL = 0x4aa8a4;
const CRYSTALS = [0x9be7ff, 0xc7a6ff, 0xffffff] as const;
/** Évents du décor : dessinés même quand les dangers sont désactivés. */
const VENT_X = [-44, 44];

function put(ctx: DecorContext, surface: string, g: BufferGeometry, color: number, v = 0.1): void {
  ctx.surface(surface).push(paint(g, color, v, 41));
}

/** Lèvre de travertin pâle le long d'un bord de strate. */
function lip(ctx: DecorContext, cx: number, y: number, w: number, d: number): void {
  put(
    ctx,
    'travertine',
    at(roundedBox(w + 1.6, 1.4, d + 1.6, 0.6), cx, y - 0.7, 0),
    TRAVERTINE,
    0.08,
  );
}

export const GEYSERS_THEME: Theme = {
  id: 'geysers',
  background: 0xe6c9a4,
  fog: { color: 0xdcc4a4, near: 340, far: 1500 },
  sky: 0xfff0dc,
  ground: 0x7a5a44,
  ambient: 1.25,
  sun: 0xffe2b8,
  sunIntensity: 2.3,
  solid: OCHRE,
  platform: TRAVERTINE,
  mover: TRAVERTINE,
  seed: 41,
  rim: 0xffd8a0,
  look: { contrast: 1.1, saturation: 1.02 },
  hdri: { file: 'kiara_9_dusk', intensity: 0.5, rotation: 1.2 },
  surfaces: {
    mineral: {
      texture: 'rock_pitted_mossy',
      tile: 22,
      base: OCHRE,
      tint: 0xffe4cc,
      variation: 0.2,
    },
    cliff: { texture: 'rock_face_03', tile: 28, base: CLIFF, tint: 0xf4d4b4, relief: 1.2 },
    travertine: {
      texture: 'rock_pitted_mossy',
      tile: 16,
      base: TRAVERTINE,
      tint: 0xfff6ee,
      roughness: 0.8,
    },
  },
  skyLook: {
    zenith: 0x5a7fb0,
    horizon: 0xf4d0a0,
    below: 0xe6c9a4,
    sunDir: [0.35, 0.3, -1],
    sunColor: 0xffe8c0,
    sunSize: 0.05,
    sunGlow: 0.12,
    clouds: 0.45,
    cloudColor: 0xfff2e2,
  },
  rays: {
    origin: [300, 300, -700],
    fromX: -220,
    toX: 140,
    y: -40,
    z: -80,
    count: 6,
    width: [8, 30],
    color: 0xffe0b0,
    intensity: 0.22,
    seed: 41,
  },
  motes: [
    {
      count: 160,
      center: [0, 20, -30],
      half: [200, 60, 80],
      color: 0xffa050,
      intensity: 2.2,
      size: 0.3,
      drift: [0, 0.05],
      seed: 41,
    },
  ],

  solidShape(x1, y1, x2, y2, ctx) {
    const cx = (x1 + x2) / 2;
    const d = SOLID_DEPTH;
    // Dessus minéral (exactement à y2) et sa lèvre de travertin.
    put(ctx, 'mineral', at(roundedBox(x2 - x1, 3, d, 0.8), cx, y2 - 1.5, 0), OCHRE);
    lip(ctx, cx, y2 - 2.6, x2 - x1, d);
    // Strates, chacune un peu plus étroite que celle du dessus, bordées de travertin.
    let w = x2 - x1 - 3;
    let y = y2 - 4;
    let k = 0;
    while (y > y1 - 40) {
      const h = between(ctx.random, 6, 9);
      const strata = displace(roundedBox(w, h, d - k * 1.5, 1.2, 3), 0.6, 0.15, 50 + k);
      put(ctx, 'cliff', at(strata, cx, y - h / 2, 0), k % 2 === 0 ? CLIFF : OCHRE, 0.14);
      if (k < 4) lip(ctx, cx, y - h + 0.4, w - 2, d - k * 1.5);
      y -= h;
      w -= between(ctx.random, 6, 12);
      k++;
      if (w < 30) break;
    }
  },

  platformShape(x1, x2, y, ctx) {
    const w = x2 - x1;
    const cx = (x1 + x2) / 2;
    // Dalle de travertin suspendue, concrétions dessous.
    put(ctx, 'travertine', at(roundedBox(w, 1.6, 15, 0.6), cx, y - 0.8, 0), TRAVERTINE, 0.08);
    const random = seeded(Math.round(cx));
    for (let x = x1 + 2; x < x2 - 1; x += between(random, 4, 8)) {
      const len = between(random, 1.5, 3.5);
      const drip = boulder(1, Math.round(x * 5), 1);
      drip.scale(between(random, 0.5, 0.9), len * 0.5, between(random, 0.5, 0.9));
      put(ctx, 'travertine', at(drip, x, y - 1.6 - len / 3, between(random, -5, 5)), TRAVERTINE);
    }
  },

  decorate(ctx: DecorContext) {
    const { random } = ctx;
    // Plan moyen : terrasses en gradins coiffées de bassins turquoise, toutes sous le niveau du
    // sol de jeu : rien ne se confond avec les plateformes.
    for (let row = 0; row < 5; row++) {
      const z = -330 - row * 90;
      const ty = -135 + row * 15;
      for (let n = 0; n < 7; n++) {
        const w = between(random, 70, 120);
        const x = -420 + n * 140 + between(random, -20, 20);
        const body = displace(roundedBox(w, 20, 50, 4, 3), 2, 0.05, row * 10 + n);
        put(ctx, row % 2 === 0 ? 'cliff' : 'mineral', at(body, x, ty - 10, z), CLIFF, 0.15);
        put(ctx, 'travertine', at(roundedBox(w + 2, 2, 52, 1), x, ty, z), TRAVERTINE, 0.08);
        ctx.lit.push(paint(at(roundedBox(w - 8, 0.6, 42, 0.3), x, ty + 1.1, z), POOL, 0.06));
      }
    }
    // Rochers et cristaux, hors du plan de jeu.
    for (let n = 0; n < 16; n++) {
      const x = between(random, -330, 330);
      if (Math.abs(x) < 110) continue;
      put(
        ctx,
        'cliff',
        at(boulder(between(random, 4, 9), 300 + n), x, -30, between(random, -170, -60)),
        CLIFF,
        0.18,
      );
    }
    for (let n = 0; n < 28; n++) {
      const x = between(random, -400, 400);
      if (Math.abs(x) < 100) continue;
      const h = between(random, 2, 4);
      const crystal = new OctahedronGeometry(2.2);
      ctx.lit.push(
        facets(
          at(crystal, x, between(random, -10, 30), between(random, -300, -90), 1, h, 1),
          CRYSTALS[n % 3]!,
          0.1,
          random,
        ),
      );
    }
    // Lointain : volcan au cratère rougeoyant.
    const volcano = displace(new CylinderGeometry(40, 230, 260, 40, 14), 14, 0.012, 77);
    put(ctx, 'cliff', at(volcano, 160, 30, -900), 0x6a5048, 0.2);
    ctx.glow.push(
      paint(
        at(new CylinderGeometry(36, 38, 3, 24).translate(0, 0, 0), 160, 161, -900),
        0xff7030,
        0.2,
      ),
    );

    // Évents : anneau de croûte minérale, fond rougeoyant ; vapeur qui grossit pendant l'annonce.
    const hazards = ctx.stage.hazards ?? [];
    for (const vx of VENT_X) {
      const ring = displace(new TorusGeometry(5, 1.4, 10, 20).rotateX(Math.PI / 2), 0.35, 0.6, vx);
      put(ctx, 'travertine', at(ring, vx, 0.4, 0), 0xb89878, 0.14);
      const ember = new CircleGeometry(4.2, 20).rotateX(-Math.PI / 2);
      ctx.glow.push(paint(at(ember, vx, 0.15, 0), 0xff9a3d, 0.2));

      const hazard = hazards.find((h) => Math.abs(fxToFloat(h.x) - vx) < 1);
      if (hazard === undefined) continue;
      const puffs: BufferGeometry[] = [];
      const puffRandom = seeded(vx + 100);
      for (let n = 0; n < 6; n++) {
        const puff = boulder(1, n + 9, 2);
        const px = between(puffRandom, -3, 3);
        const pz = between(puffRandom, -2, 2);
        puffs.push(
          paint(
            at(puff, px, 2 + n * 3, pz, 2 + n * 0.8, 1.6 + n * 0.5, 2 + n * 0.8),
            0xffffff,
            0.06,
          ),
        );
      }
      const steam = new Mesh(
        merge(puffs),
        new MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.45,
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
        steam.rotation.y = frame * 0.01;
      });
    }
  },
};
