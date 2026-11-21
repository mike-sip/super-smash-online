/**
 * Belvédère des Brumes : terrasse de grès taillé suspendue au-dessus d'une mer de nuages, au
 * coucher du soleil (SPEC-finition.md, phase 1).
 *
 * Premier plan : la terrasse (dalle fissurée, corniche, bandeau de blocs, balustrade tournée) sur
 * son éperon de roche moussue. Plan moyen : deux falaises qui encadrent la scène. Lointain : îles
 * flottantes avec arbres et ruines, au-dessus de nappes de nuages éclairées à contre-jour.
 */
import { CylinderGeometry, type BufferGeometry } from 'three';
import { at, between, seeded } from './lowpoly.ts';
import { baluster, boulder, displace, lathe, paint, roundedBox } from './sculpt.ts';
import { SOLID_DEPTH, type DecorContext, type Theme } from './theme.ts';

const SAND = 0xd9a066;
const STONE = 0xd2a878;
const ROCK = 0xa9825f;
const MOSS = 0x7f9a52;
const WOOD = 0x8a6a4a;
const LEAF = 0x6f8f3a;
const BARK = 0x5a4030;

/** Colorie et range dans une surface texturée. */
function put(ctx: DecorContext, surface: string, g: BufferGeometry, color: number, v = 0.1): void {
  ctx.surface(surface).push(paint(g, color, v, ctx.stage.solids.length));
}

/** Arbre stylisé : tronc et houppier de boules déformées. */
function tree(
  ctx: DecorContext,
  x: number,
  y: number,
  z: number,
  size: number,
  seed: number,
): void {
  const trunk = new CylinderGeometry(0.25 * size, 0.4 * size, 3 * size, 8, 2);
  ctx.lit.push(paint(at(trunk, x, y + 1.5 * size, z), BARK, 0.12, seed));
  const random = seeded(seed);
  for (let k = 0; k < 3; k++) {
    const r = size * between(random, 1.1, 1.6);
    const blob = boulder(r, seed + k, 2);
    ctx.lit.push(
      paint(
        at(
          blob,
          x + between(random, -1, 1) * size,
          y + size * (3.2 + k * 0.7),
          z + between(random, -0.8, 0.8) * size,
        ),
        LEAF,
        0.18,
        seed + k,
      ),
    );
  }
}

/** Île flottante : plateau moussu sur un cône de roche, arbres et parfois une colonne brisée. */
function island(ctx: DecorContext, x: number, y: number, z: number, r: number, seed: number): void {
  const top = displace(new CylinderGeometry(r, r * 0.92, r * 0.3, 22, 2), r * 0.06, 0.12, seed);
  put(ctx, 'moss', at(top, x, y, z), MOSS, 0.15);
  const under = displace(
    new CylinderGeometry(r * 0.9, r * 0.12, r * 1.7, 22, 9),
    r * 0.16,
    3 / r,
    seed + 7,
  );
  put(ctx, 'rock', at(under, x, y - r * 0.15 - r * 0.85, z), ROCK, 0.14);
  const random = seeded(seed);
  const trees = r > 16 ? 3 : r > 11 ? 2 : 1;
  for (let t = 0; t < trees; t++) {
    tree(
      ctx,
      x + between(random, -0.55, 0.55) * r,
      y + r * 0.15,
      z + between(random, -0.4, 0.4) * r,
      between(random, 1.6, 2.6),
      seed * 13 + t,
    );
  }
  if (random() < 0.5) {
    const h = between(random, 6, 12);
    const column = lathe(
      [
        [0.001, 0],
        [2.2, 0],
        [2.2, 0.8],
        [1.6, 1.2],
        [1.5, h],
      ],
      14,
    );
    put(ctx, 'terrace', at(column, x + r * 0.35, y + r * 0.15, z - r * 0.2), STONE, 0.12);
  }
}

/** Grande falaise du plan moyen, qui sort des nuages. */
function cliff(ctx: DecorContext, x: number, z: number, r: number, h: number, seed: number): void {
  const body = displace(new CylinderGeometry(r * 0.7, r, h, 28, 16), r * 0.22, 2.2 / r, seed);
  put(ctx, 'rock', at(body, x, h / 2 - 95, z), ROCK, 0.16);
  const cap = displace(new CylinderGeometry(r * 0.78, r * 0.74, 5, 28, 1), 1.5, 0.08, seed + 3);
  put(ctx, 'moss', at(cap, x, h - 95 + 1.5, z), MOSS, 0.15);
  const random = seeded(seed);
  for (let t = 0; t < 3; t++) {
    tree(
      ctx,
      x + between(random, -0.5, 0.5) * r,
      h - 95 + 3,
      z + between(random, -0.4, 0.4) * r,
      between(random, 2.4, 3.4),
      seed * 7 + t,
    );
  }
}

export const BELVEDERE_THEME: Theme = {
  id: 'belvedere',
  background: 0xf6c28b,
  fog: { color: 0xe9b998, near: 320, far: 1700 },
  sky: 0xffe9d6,
  ground: 0x7a5a6a,
  ambient: 1.15,
  sun: 0xffc890,
  sunIntensity: 2.6,
  solid: SAND,
  platform: WOOD,
  mover: WOOD,
  seed: 11,
  rim: 0xffd6a8,
  look: { exposure: 1.02, contrast: 1.1, saturation: 0.98 },
  hdri: { file: 'belfast_sunset_puresky', intensity: 0.55, rotation: 1.9 },
  surfaces: {
    terrace: {
      texture: 'sandstone_cracks',
      tile: 22,
      base: STONE,
      tint: 0xf2e2d2,
      variation: 0.18,
    },
    blocks: { texture: 'sandstone_blocks_05', tile: 18, base: SAND, tint: 0xffe8cc, relief: 1.2 },
    rock: { texture: 'coast_sand_rocks_02', tile: 34, base: ROCK, tint: 0xf0c8a0, variation: 0.22 },
    moss: { texture: 'coast_sand_rocks_02', tile: 26, base: MOSS, tint: 0xc0d890 },
    wood: { texture: 'weathered_brown_planks', tile: 12, base: WOOD, tint: 0xfff0e0 },
  },
  skyLook: {
    zenith: 0x4f63a8,
    horizon: 0xf6c28b,
    below: 0xeab995,
    sunDir: [-0.3, 0.05, -1],
    sunColor: 0xffd9a0,
    sunSize: 0.06,
    sunGlow: 0.14,
    clouds: 0.42,
    cloudColor: 0xfbe3d0,
  },
  cloudSea: {
    y: -62,
    spacing: 10,
    layers: 4,
    z: -260,
    width: 1800,
    depth: 1100,
    light: 0xfff0e2,
    shadow: 0xb98f9a,
    cover: 0.5,
    sun: [-0.3, -1],
  },
  rays: {
    origin: [-330, 150, -620],
    fromX: -160,
    toX: 260,
    y: -50,
    z: -60,
    count: 7,
    width: [6, 28],
    color: 0xffc890,
    intensity: 0.3,
    seed: 11,
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
    const d = SOLID_DEPTH;
    // Dalle fissurée (dessus exactement à y2 : là où marchent les combattants), corniche, bandeau
    // de blocs et moulure basse. La collision reste la boîte de la simulation.
    put(ctx, 'terrace', at(roundedBox(w + 3, 2.6, d + 3, 0.9), cx, y2 - 1.3, 0), STONE);
    put(ctx, 'terrace', at(roundedBox(w + 5, 1.2, d + 5, 0.5), cx, y2 - 3.1, 0), STONE);
    put(ctx, 'blocks', at(roundedBox(w, 8, d, 0.6), cx, y2 - 7.7, 0), SAND);
    put(ctx, 'terrace', at(roundedBox(w + 2, 1.4, d + 2, 0.6), cx, y2 - 12.2, 0), STONE);
    // Éperon de roche moussue qui s'effile sous la terrasse, et quelques blocs pendants.
    const spur = new CylinderGeometry(w / 2 + 1, 5, 78, 34, 18);
    spur.scale(1, 1, 0.46);
    put(ctx, 'rock', at(displace(spur, 3.8, 0.055, 5), cx, y2 - 12.6 - 39, 0), ROCK, 0.16);
    const random = seeded(23);
    for (let k = 0; k < 5; k++) {
      const r = between(random, 4, 8);
      put(
        ctx,
        'rock',
        at(
          boulder(r, 40 + k),
          cx + between(random, -0.35, 0.35) * w,
          y2 - between(random, 30, 60),
          between(random, -8, 8),
        ),
        ROCK,
        0.16,
      );
    }
    // Balustrade au fond de la terrasse, derrière les combattants : socle, balustres tournés,
    // main courante, piliers à chapiteau.
    const z = -15;
    const x0 = x1 + 4;
    const xEnd = x2 - 4;
    put(ctx, 'terrace', at(roundedBox(xEnd - x0, 1, 3, 0.3), cx, y2 + 0.5, z), STONE);
    put(ctx, 'terrace', at(roundedBox(xEnd - x0, 1, 3.4, 0.35), cx, y2 + 6.7, z), STONE);
    const pillars = [x0, x0 + (xEnd - x0) / 4, cx, xEnd - (xEnd - x0) / 4, xEnd];
    for (const px of pillars) {
      put(ctx, 'blocks', at(roundedBox(3.6, 7.6, 3.6, 0.3), px, y2 + 3.8, z), SAND);
      put(ctx, 'terrace', at(roundedBox(4.4, 0.9, 4.4, 0.3), px, y2 + 8, z), STONE);
    }
    for (let i = 0; i < pillars.length - 1; i++) {
      const a = pillars[i]! + 2.6;
      const b = pillars[i + 1]! - 2.6;
      const n = Math.max(1, Math.round((b - a) / 2.6));
      for (let k = 0; k <= n; k++) {
        put(ctx, 'terrace', at(baluster(5.2, 1.4), a + ((b - a) * k) / n, y2 + 1, z), STONE, 0.08);
      }
    }
    void y1;
  },

  platformShape(x1, x2, y, ctx) {
    const w = x2 - x1;
    const cx = (x1 + x2) / 2;
    // Plancher de bois sur deux poutres, entre deux corbeaux de pierre.
    put(ctx, 'wood', at(roundedBox(w, 1.2, 14, 0.35), cx, y - 0.6, 0), WOOD);
    for (const z of [-4.5, 4.5]) {
      put(ctx, 'wood', at(roundedBox(w * 0.92, 0.9, 1.4, 0.3), cx, y - 1.65, z), WOOD, 0.14);
    }
    for (const ex of [x1 + 1, x2 - 1]) {
      put(ctx, 'terrace', at(roundedBox(2.4, 2.6, 15, 0.5), ex, y - 1.1, 0), STONE);
    }
  },

  decorate(ctx: DecorContext) {
    const random = seeded(31);
    // Plan moyen : deux falaises qui encadrent le stage.
    cliff(ctx, -205, -150, 34, 190, 61);
    cliff(ctx, 230, -190, 40, 175, 67);
    // Lointain : îles flottantes, de tailles et hauteurs variées.
    for (let n = 0; n < 9; n++) {
      island(
        ctx,
        between(random, -460, 460),
        between(random, -10, 95),
        between(random, -560, -260),
        between(random, 8, 24),
        100 + n,
      );
    }
  },
};
