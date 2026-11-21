/**
 * Canal des Lanternes : quai pavé d'une cité fluviale au crépuscule (SPEC-finition.md, phase 1).
 *
 * Premier plan : le quai (pavés mouillés, margelle, mur de briques, escaliers qui descendent à
 * l'eau, pieux d'amarrage). Plan moyen : une rangée de maisons de briques à pignons, fenêtres
 * allumées qui se reflètent dans le canal. Lointain : silhouettes de toits et de clochers dans la
 * brume. Au-dessus du quai, une guirlande de lanternes en papier se balance.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type BufferGeometry,
} from 'three';
import { at, between, merge } from './lowpoly.ts';
import { lathe, paint, roundedBox } from './sculpt.ts';
import { SOLID_DEPTH, type DecorContext, type Theme } from './theme.ts';

const PAVING = 0x8f8a84;
const BRICK = 0x9a5a48;
const WOOD = 0x6a5038;
const ROOF = 0x2c2436;
const FAR = 0x3b2a4a;
const WINDOW = 0xffc46b;
const WATER_Y = -26;

function put(ctx: DecorContext, surface: string, g: BufferGeometry, color: number, v = 0.1): void {
  ctx.surface(surface).push(paint(g, color, v, 7));
}

/** Toit à deux pans (prisme triangulaire), faîte en haut. */
function gable(width: number, height: number, depth: number): BufferGeometry {
  const g = new CylinderGeometry(1, 1, depth, 3, 1);
  g.rotateX(-Math.PI / 2);
  g.scale(width * 0.58, height * 0.67, 1);
  return g;
}

/** Maison de briques à pignon, fenêtres allumées ou non, reflets dans l'eau. */
function house(
  ctx: DecorContext,
  x: number,
  z: number,
  w: number,
  h: number,
  reflections: BufferGeometry[],
): void {
  const { random } = ctx;
  const base = WATER_Y - 2;
  put(ctx, 'brick', at(roundedBox(w, h, 22, 0.4), x, base + h / 2, z), BRICK, 0.18);
  // Corniche et toit.
  put(ctx, 'paving', at(roundedBox(w + 1.6, 1.2, 23.6, 0.3), x, base + h + 0.6, z), PAVING);
  const roofH = between(random, 9, 16);
  ctx.lit.push(paint(at(gable(w + 2, roofH, 24), x, base + h + 1.2 + roofH / 3, z), ROOF, 0.12));
  if (random() < 0.5) {
    ctx.lit.push(
      paint(at(roundedBox(2.6, 7, 2.6, 0.3), x + w * 0.25, base + h + roofH * 0.6, z - 4), BRICK),
    );
  }
  // Fenêtres : encadrement de pierre, vitre allumée (lueur) ou sombre.
  const front = z + 11.1;
  for (let wy = base + 9; wy < base + h - 6; wy += 10) {
    for (let wx = x - w / 2 + 5; wx <= x + w / 2 - 5; wx += 7.5) {
      put(ctx, 'paving', at(new BoxGeometry(4.2, 6, 0.6), wx, wy, front), PAVING, 0.06);
      const lit = random() < 0.45;
      const pane = at(new BoxGeometry(3, 4.6, 0.4), wx, wy, front + 0.3);
      if (lit) {
        ctx.glow.push(paint(pane, WINDOW, 0.25, Math.round(wx)));
        // Reflet : traînée verticale qui s'éteint vers le bas, sur l'eau.
        const streak = new PlaneGeometry(2.4, 18).rotateX(-Math.PI / 2);
        reflections.push(
          fadeStreak(at(streak, wx, WATER_Y + 0.2, front + 10 + (wy - base) * 0.15)),
        );
      } else {
        ctx.lit.push(paint(pane, 0x1c1a2a, 0.1));
      }
    }
  }
}

/** Couleur de reflet sur une traînée : chaude au pied de la maison, noire (invisible) au loin. */
function fadeStreak(g: BufferGeometry): BufferGeometry {
  g.deleteAttribute('uv');
  const flat = g.toNonIndexed();
  g.dispose();
  const pos = flat.getAttribute('position');
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    zMin = Math.min(zMin, pos.getZ(i));
    zMax = Math.max(zMax, pos.getZ(i));
  }
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getZ(i) - zMin) / (zMax - zMin || 1);
    const k = 0.55 * (1 - t);
    colors[i * 3] = k;
    colors[i * 3 + 1] = k * 0.62;
    colors[i * 3 + 2] = k * 0.28;
  }
  flat.setAttribute('color', new BufferAttribute(colors, 3));
  return flat;
}

/** Lanterne en papier, tournée, centrée sur son milieu. */
function lantern(): BufferGeometry {
  return lathe(
    [
      [0.001, -2.6],
      [1.2, -2.4],
      [2.1, -1.4],
      [2.4, 0],
      [2.1, 1.4],
      [1.2, 2.4],
      [0.001, 2.6],
    ],
    12,
  );
}

export const CANAL_THEME: Theme = {
  id: 'canal',
  background: 0xb0566a,
  fog: { color: 0x7d4a6a, near: 300, far: 1300 },
  sky: 0xffc7a0,
  ground: 0x3a2a4a,
  ambient: 1.2,
  sun: 0xff9e6b,
  sunIntensity: 1.9,
  solid: PAVING,
  platform: WOOD,
  mover: WOOD,
  seed: 37,
  rim: 0xffb48a,
  look: { contrast: 1.1, saturation: 1.02 },
  hdri: { file: 'qwantani_dusk_2_puresky', intensity: 0.5, rotation: 2.2 },
  surfaces: {
    paving: {
      texture: 'cobblestone_floor_04',
      tile: 20,
      base: PAVING,
      tint: 0xf0e4dc,
      roughness: 0.7,
      relief: 1.2,
    },
    brick: { texture: 'red_brick', tile: 26, base: BRICK, tint: 0xf0d8d0, variation: 0.2 },
    mover: { texture: 'brown_planks_03', tile: 14, base: WOOD, tint: 0xd8b898, local: true },
    wood: { texture: 'brown_planks_03', tile: 10, base: WOOD, tint: 0xc8a888 },
  },
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
  water: {
    y: WATER_Y,
    z: -200,
    width: 1600,
    depth: 900,
    color: 0x1c1636,
    waves: 0.35,
    reflect: 1.1,
  },
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
    const d = SOLID_DEPTH;
    // Pavés (dessus exactement à y2), margelle de pierre, mur de briques jusqu'à l'eau.
    put(ctx, 'paving', at(roundedBox(w, 2, d, 0.5), cx, y2 - 1, 0), PAVING);
    put(ctx, 'paving', at(roundedBox(w + 2.4, 1.8, 3.6, 0.6), cx, y2 - 0.9, d / 2 - 0.6), PAVING);
    put(
      ctx,
      'brick',
      at(roundedBox(w - 1, y2 - 2 - (WATER_Y - 4), d - 2, 0.4), cx, (y2 - 2 + WATER_Y - 4) / 2, 0),
      BRICK,
      0.16,
    );
    // Bandeau de pierre à mi-hauteur et ligne de flottaison verdie.
    put(ctx, 'paving', at(roundedBox(w + 0.6, 1.4, d - 1, 0.4), cx, y2 - 12, 0), PAVING);
    // Escaliers qui descendent à l'eau de chaque côté, le long du mur.
    for (const side of [-1, 1]) {
      const edge = side < 0 ? x1 : x2;
      for (let k = 0; k < 9; k++) {
        const top = y2 - 3 - k * 2.5;
        const sx = edge + side * (2.5 + k * 2.6);
        put(
          ctx,
          'paving',
          at(roundedBox(2.8, top - WATER_Y + 2, 10, 0.3), sx, (top + WATER_Y - 2) / 2, d / 2 - 6),
          PAVING,
          0.12,
        );
      }
    }
    // Pieux d'amarrage devant le quai, dans l'eau, hors du plan de jeu.
    for (const px of [x1 - 30, x1 - 22, x2 + 22, x2 + 30]) {
      const pile = new CylinderGeometry(1.1, 1.3, 30, 10, 1);
      put(ctx, 'wood', at(pile, px, WATER_Y + 9, d / 2 + 4), WOOD, 0.14);
    }
    // Bornes d'amarrage en fonte au fond du quai.
    for (const bx of [x1 + 8, x2 - 8]) {
      const bollard = lathe(
        [
          [0.001, 0],
          [1.3, 0],
          [1.1, 0.6],
          [0.8, 1.2],
          [0.85, 2.4],
          [1.25, 2.8],
          [0.001, 3],
        ],
        12,
      );
      ctx.lit.push(paint(at(bollard, bx, y2, -d / 2 + 3), 0x22202a, 0.1));
    }
    void y1;
  },

  moverShape(width, index) {
    const parts: BufferGeometry[] = [];
    if (index === 0) {
      // Barge : coque arrondie, pont de planches, plat-bord.
      const hull = roundedBox(width + 4, 4, 14, 1.8);
      hull.translate(0, -3.2, 0);
      parts.push(paint(hull, 0x4a3426, 0.12));
      parts.push(paint(at(roundedBox(width, 1, 12, 0.3), 0, -0.5, 0), WOOD, 0.1));
      for (const z of [-6.2, 6.2]) {
        parts.push(paint(at(roundedBox(width + 3, 1.2, 0.8, 0.3), 0, 0.1, z), 0x5a4030, 0.1));
      }
    } else {
      // Nacelle : plancher, garde-corps au fond, cordes qui montent vers les poulies.
      parts.push(paint(at(roundedBox(width, 1.2, 12, 0.3), 0, -0.6, 0), WOOD, 0.1));
      parts.push(paint(at(roundedBox(width, 0.6, 0.6, 0.2), 0, 4, -5.5), 0x5a4030, 0.1));
      for (const sx of [-width / 2 + 0.6, width / 2 - 0.6]) {
        parts.push(paint(at(new CylinderGeometry(0.3, 0.3, 4, 6), sx, 2, -5.5), 0x5a4030));
        parts.push(paint(at(new CylinderGeometry(0.12, 0.12, 120, 5), sx, 60, -5.5), 0x2a2018));
      }
    }
    return merge(parts);
  },

  decorate(ctx: DecorContext) {
    const { random } = ctx;
    // Plan moyen : maisons de briques le long du canal, reflets de leurs fenêtres.
    const reflections: BufferGeometry[] = [];
    let x = -420;
    while (x < 420) {
      const w = between(random, 24, 38);
      house(ctx, x + w / 2, between(random, -200, -170), w, between(random, 38, 90), reflections);
      x += w + between(random, 0, 3);
    }
    // Lointain : silhouettes de toits et de clochers.
    for (let n = 0; n < 18; n++) {
      const fx = -520 + n * 60 + between(random, -10, 10);
      const h = between(random, 70, 150);
      ctx.lit.push(paint(at(roundedBox(40, h, 30, 1), fx, WATER_Y + h / 2, -340), FAR, 0.1));
      if (n % 5 === 2) {
        const spire = new CylinderGeometry(0.4, 9, 46, 4, 1);
        ctx.lit.push(paint(at(spire, fx, WATER_Y + h + 23, -340), FAR, 0.1));
      } else {
        ctx.lit.push(paint(at(gable(42, 18, 32), fx, WATER_Y + h + 6, -340), ROOF, 0.1));
      }
    }
    const shine = new Mesh(
      merge(reflections),
      new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    shine.name = 'reflections';
    ctx.root.add(shine);
    ctx.animate((frame) => {
      // Les reflets ondulent avec l'eau.
      shine.scale.x = 1 + Math.sin(frame * 0.05) * 0.04;
    });

    // Poteaux de la guirlande.
    for (const px of [-95, 95]) {
      const pole = new CylinderGeometry(1.1, 1.4, 78, 10);
      put(ctx, 'wood', at(pole, px, 39, -32), WOOD, 0.12);
      ctx.lit.push(paint(at(roundedBox(4, 1.2, 4, 0.4), px, 78.6, -32), 0x2a2018));
    }

    // Guirlande de lanternes en papier : une seule pièce, qui se balance.
    const lanterns: BufferGeometry[] = [];
    for (let n = 0; n <= 10; n++) {
      const lx = -90 + n * 18;
      const sag = 1 - (lx / 95) * (lx / 95);
      const y = 66 - 12 * sag;
      const color = n % 2 === 0 ? 0xffb347 : 0xff7a59;
      lanterns.push(paint(at(lantern(), lx, y - 4, 0, 1, 1.1, 1), color, 0.15, n));
      lanterns.push(paint(at(new CylinderGeometry(0.15, 0.15, 3, 5), lx, y - 0.5, 0), 0x2a1d1a));
    }
    // Corde entre les lanternes.
    for (let n = 0; n < 10; n++) {
      const ax = -90 + n * 18;
      const bx = ax + 18;
      const ay = 66 - 12 * (1 - (ax / 95) * (ax / 95));
      const by = 66 - 12 * (1 - (bx / 95) * (bx / 95));
      const len = Math.hypot(bx - ax, by - ay);
      const rope = new CylinderGeometry(0.12, 0.12, len, 4);
      rope.rotateZ(Math.PI / 2 + Math.atan2(by - ay, bx - ax));
      lanterns.push(paint(at(rope, (ax + bx) / 2, (ay + by) / 2 + 1, 0), 0x2a1d1a));
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
