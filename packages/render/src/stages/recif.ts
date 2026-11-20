/**
 * Récif Nocturne : dalle de basalte mouillée au milieu d'un lagon, de nuit, sous un croissant de
 * lune (SPEC-finition.md, phase 1).
 *
 * La dalle repose sur un massif d'orgues basaltiques (colonnes hexagonales serrées) qui descendent
 * en gradins jusqu'à l'eau ; d'autres orgues sortent du lagon de part et d'autre. Coraux
 * luminescents ramifiés et en éventail au pied des colonnes, plancton en suspension.
 */
import { Color, CylinderGeometry } from 'three';
import { at, between, seeded } from './lowpoly.ts';
import { boulder, displace, paint, roundedBox } from './sculpt.ts';
import { SOLID_DEPTH, type DecorContext, type Theme } from './theme.ts';

const BASALT_TOP = 0x4f6f6a;
const BASALT = 0x34494c;
const WATER_Y = -24;
const CORALS = [0x4ff0d8, 0xd65bf0, 0xf6e27a, 0x6aa8ff, 0xff7aa8];

/**
 * Colonne hexagonale de basalte, sommet à `top` : tronçons séparés par de fines fractures, faces
 * plates alignées pour que les colonnes voisines se touchent, comme de vrais orgues.
 */
function column(ctx: DecorContext, x: number, top: number, z: number, h: number, r: number): void {
  const color = new Color(BASALT).multiplyScalar(0.8 + ctx.random() * 0.4).getHex();
  let y = top;
  while (y > top - h) {
    const len = Math.min(between(ctx.random, 3, 7), y - (top - h));
    const g = new CylinderGeometry(r * 0.97, r * 0.99, Math.max(0.5, len - 0.25), 6, 1);
    ctx.surface('basalt').push(paint(at(g, x, y - len / 2, z), color, 0.12, Math.round(x * 3 + y)));
    y -= len;
  }
}

/** Corail ramifié : tiges qui se divisent, toutes lumineuses. */
function branching(
  ctx: DecorContext,
  x: number,
  y: number,
  z: number,
  size: number,
  color: number,
): void {
  const random = seeded(Math.round(x * 31 + z * 7));
  const grow = (
    px: number,
    py: number,
    pz: number,
    len: number,
    angle: number,
    depth: number,
  ): void => {
    const tilt = angle;
    const g = new CylinderGeometry(0.18 * len * 0.4, 0.28 * len * 0.4, len, 6, 1);
    g.translate(0, len / 2, 0);
    g.rotateZ(tilt);
    g.rotateY(random() * Math.PI * 2);
    ctx.glow.push(paint(at(g, px, py, pz), color, 0.2, depth));
    if (depth === 0) return;
    const ex = px - Math.sin(tilt) * len * 0.9;
    const ey = py + Math.cos(tilt) * len * 0.9;
    for (let k = 0; k < 2; k++) {
      grow(ex, ey, pz, len * 0.72, tilt + between(random, -0.7, 0.7), depth - 1);
    }
  };
  grow(x, y, z, size, 0, 3);
}

/** Corail en boule (« cerveau ») ou en éventail aplati. */
function blob(
  ctx: DecorContext,
  x: number,
  y: number,
  z: number,
  r: number,
  color: number,
  fan: boolean,
): void {
  const g = boulder(r, Math.round(x + z), 2);
  if (fan) g.scale(1.4, 1.2, 0.25);
  ctx.glow.push(paint(at(g, x, y, z), color, 0.25, Math.round(x)));
}

export const RECIF_THEME: Theme = {
  id: 'recif',
  background: 0x0d1834,
  fog: { color: 0x0f1d3d, near: 280, far: 1100 },
  sky: 0x8fa8ff,
  ground: 0x23415a,
  ambient: 1.7,
  sun: 0xbcd0ff,
  sunIntensity: 1.8,
  solid: BASALT,
  platform: BASALT_TOP,
  mover: BASALT_TOP,
  seed: 23,
  rim: 0x9fe8ff,
  look: { contrast: 1.12, saturation: 1.05 },
  surfaces: {
    top: {
      texture: 'dark_rock_02',
      tile: 16,
      base: BASALT_TOP,
      tint: 0xc4ecdf,
      roughness: 0.55,
      relief: 1.1,
    },
    basalt: {
      texture: 'dark_rock_02',
      tile: 20,
      base: BASALT,
      tint: 0xb4dcd6,
      roughness: 0.7,
      relief: 1.3,
      variation: 0.2,
    },
  },
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
    const d = SOLID_DEPTH;
    // Dalle au dessus exactement à y2, arêtes adoucies : les rebords se lisent nettement.
    ctx
      .surface('top')
      .push(paint(at(roundedBox(w + 2, 3.2, d + 2, 0.8), cx, y2 - 1.6, 0), BASALT_TOP, 0.1, 3));
    // Massif d'orgues sous la dalle : rangées de colonnes, plus basses vers l'avant et les bords.
    const r = 2.6;
    const step = r * 1.73;
    for (let row = 0; row < 4; row++) {
      const z = d / 2 - 2 - row * r * 1.5;
      const offset = row % 2 === 0 ? 0 : step / 2;
      for (let x = x1 + 2 + offset; x <= x2 - 2; x += step) {
        const edge = Math.min(x - x1, x2 - x) / (w / 2);
        const top = y2 - 3.2 - between(ctx.random, 0, 1.5);
        const bottom = WATER_Y - 4 - (1 - edge) * 2;
        column(ctx, x, top, z, top - bottom, r);
      }
    }
    // Gradins qui débordent sur les côtés et descendent vers l'eau.
    for (const side of [-1, 1]) {
      for (let k = 0; k < 7; k++) {
        const x = (side < 0 ? x1 : x2) + side * (3 + k * step * 0.8);
        const top = y2 - 6 - k * 2.6 - between(ctx.random, 0, 1.5);
        for (let row = 0; row < 3; row++) {
          const z = d / 2 - 4 - row * r * 1.6 + between(ctx.random, -1, 1);
          column(ctx, x + (row % 2) * step * 0.4, top - row * 0.8, z, top - (WATER_Y - 4), r);
        }
      }
    }
    void y1;
  },

  decorate(ctx: DecorContext) {
    const { random } = ctx;
    // Deux grands pitons d'orgues qui encadrent la scène, au plan moyen.
    const stacks: readonly (readonly [number, number, number])[] = [
      [-190, -140, 95],
      [215, -175, 80],
    ];
    for (const [px, pz, height] of stacks) {
      for (let k = 0; k < 40; k++) {
        const a = random() * Math.PI * 2;
        const d = Math.sqrt(random()) * 22;
        const top = WATER_Y + height * (1 - d / 30) * between(random, 0.75, 1);
        column(ctx, px + Math.cos(a) * d, top, pz + Math.sin(a) * d, top - WATER_Y + 4, 3.2);
      }
    }
    // Orgues qui sortent du lagon, en groupes, hors de la zone de jeu.
    for (let g = 0; g < 9; g++) {
      const gx = between(random, -420, 420);
      if (Math.abs(gx) < 120) continue;
      const gz = between(random, -380, -60);
      const tallest = between(random, 8, 40);
      for (let k = 0; k < 9; k++) {
        const x = gx + between(random, -12, 12);
        const z = gz + between(random, -10, 10);
        const top = WATER_Y + tallest * between(random, 0.35, 1);
        column(ctx, x, top, z, top - WATER_Y + 4, between(random, 2.2, 3.4));
      }
    }
    // Rochers au pied des orgues.
    for (let n = 0; n < 14; n++) {
      const x = between(random, -260, 260);
      if (Math.abs(x) < 100) continue;
      const rock = displace(boulder(between(random, 3, 7), 200 + n), 0.4, 0.3, n);
      ctx
        .surface('basalt')
        .push(paint(at(rock, x, WATER_Y, between(random, -200, -20), 1, 0.6, 1), BASALT, 0.2, n));
    }
    // Coraux luminescents ramifiés, en boule et en éventail, au bord de l'eau.
    for (let n = 0; n < 46; n++) {
      const x = between(random, -380, 380);
      const z = between(random, -320, 40);
      if (Math.abs(x) < 105 && z > -40) continue;
      const color = CORALS[n % CORALS.length]!;
      const kind = n % 3;
      if (kind === 0) branching(ctx, x, WATER_Y - 1, z, between(random, 2.5, 4.5), color);
      else blob(ctx, x, WATER_Y, z, between(random, 1.5, 3.5), color, kind === 2);
    }
  },
};
