/**
 * Nacre — zoneur.
 *
 * Gardienne des récifs, armée d'un bâton de corail et de perles. Garde l'adversaire à distance :
 * la plus grande allonge du roster et les seuls projectiles qui portent loin (perle droite, galet
 * en cloche, piège de corail). Faible au corps à corps : démarrages plus lents que Sorel.
 *
 * Unités : distances en unités de jeu (Nacre mesure 13), vitesses par frame, durées en frames.
 */
import {
  ENTITY_BOUNCE,
  ENTITY_DESTROY,
  ENTITY_PASS,
  M_BAIR,
  M_DAIR,
  M_DASH_ATTACK,
  M_DSMASH,
  M_DSPECIAL,
  M_DTILT,
  M_FAIR,
  M_FSMASH,
  M_FTILT,
  M_JAB,
  M_JAB2,
  M_JAB3,
  M_LEDGE_ATTACK,
  M_NAIR,
  M_NSPECIAL,
  M_SSPECIAL,
  M_UAIR,
  M_ULTIMATE,
  M_USMASH,
  M_USPECIAL,
  M_UTILT,
  fx,
  type EntityDef,
  type FighterDef,
} from '@game/sim-core';
import { capsule, dodge, move, moveset, throwDef } from '../build.ts';
import { defineCharacter, type Character } from '../character.ts';

/** Projectiles, numérotés à partir de 1. */
const PEARL = 1;
const PEBBLE = 2;
const CORAL = 3;
const GREAT_PEARL = 4;

const ENTITIES: EntityDef[] = [
  {
    // Droite et rapide, longue portée : 60 frames à 2,6, soit 156 unités.
    name: 'Perle',
    radius: fx(1.6),
    gravity: fx(0),
    lifetime: 60,
    stageCollision: ENTITY_DESTROY,
    hit: { damage: fx(7), angle: 35, baseKnockback: fx(15), knockbackGrowth: fx(0.45) },
    destroyOnHit: true,
  },
  {
    // En cloche, rebondit sur le sol.
    name: 'Galet',
    radius: fx(2),
    gravity: fx(0.08),
    lifetime: 150,
    stageCollision: ENTITY_BOUNCE,
    hit: { damage: fx(9), angle: 60, baseKnockback: fx(22), knockbackGrowth: fx(0.7) },
    destroyOnHit: true,
  },
  {
    // Piège posé : tombe, se pose et attend qu'on marche dessus.
    name: 'Corail',
    radius: fx(2.2),
    gravity: fx(0.1),
    lifetime: 360,
    stageCollision: ENTITY_BOUNCE,
    hit: { damage: fx(10), angle: 75, baseKnockback: fx(35), knockbackGrowth: fx(0.7) },
    destroyOnHit: true,
  },
  {
    // Ultime : énorme, lente, traverse le décor et frappe chacun une fois.
    name: 'Grande perle',
    radius: fx(9),
    gravity: fx(0),
    lifetime: 200,
    stageCollision: ENTITY_PASS,
    hit: { damage: fx(30), angle: 45, baseKnockback: fx(90), knockbackGrowth: fx(1) },
    destroyOnHit: false,
  },
];

const SMASH_CHARGE = { maxFrames: 60, maxScale: 1.4 };

const MOVES = moveset([
  // --- Normaux ---
  [
    M_JAB,
    move(
      'Bâton',
      20,
      [{ frames: [4, 5], shape: [7, 8, 2.5], damage: 3, angle: 75, base: 8, growth: 0.3 }],
      { cancels: [{ start: 7, end: 20, on: M_JAB, to: M_JAB2, requiresHit: false }] },
    ),
  ],
  [
    M_JAB2,
    move(
      'Revers de bâton',
      22,
      [{ frames: [4, 5], shape: [7.5, 8, 2.5], damage: 3, angle: 75, base: 8, growth: 0.3 }],
      { cancels: [{ start: 8, end: 22, on: M_JAB, to: M_JAB3, requiresHit: false }] },
    ),
  ],
  [
    M_JAB3,
    move('Tourbillon', 30, [
      { frames: [6, 9], shape: [0, 7, 9, 7, 3], damage: 5, angle: 45, base: 30, growth: 0.8 },
    ]),
  ],
  [
    M_FTILT,
    move('Estoc', 28, [
      {
        frames: [7, 9],
        shape: [5, 7.5, 15, 7.5, 2.2],
        damage: 9,
        angle: 40,
        base: 14,
        growth: 0.9,
      },
    ]),
  ],
  [
    M_UTILT,
    move('Arc de corail', 30, [
      { frames: [6, 12], shape: [8, 8, -6, 12, 3], damage: 7, angle: 92, base: 22, growth: 0.85 },
    ]),
  ],
  [
    M_DTILT,
    move('Balayage long', 24, [
      { frames: [6, 8], shape: [4, 1, 14, 1, 2], damage: 6, angle: 75, base: 18, growth: 0.55 },
    ]),
  ],
  [
    M_DASH_ATTACK,
    move(
      'Glissement',
      34,
      [{ frames: [7, 11], shape: [6, 6, 3.5], damage: 8, angle: 55, base: 30, growth: 0.7 }],
      { motion: [{ start: 1, end: 8, velX: 1.2 }] },
    ),
  ],

  // --- Smash ---
  [
    M_FSMASH,
    move(
      'Lance de corail',
      50,
      [{ frames: [16, 18], shape: [6, 8, 18, 8, 2.5], damage: 15, angle: 38, base: 28, growth: 1 }],
      { charge: { frame: 7, ...SMASH_CHARGE } },
    ),
  ],
  [
    M_USMASH,
    move(
      'Gerbe',
      46,
      [
        {
          frames: [12, 16],
          shape: [0, 11, 0, 21, 3.5],
          damage: 14,
          angle: 88,
          base: 30,
          growth: 1,
        },
      ],
      { charge: { frame: 6, ...SMASH_CHARGE } },
    ),
  ],
  [
    M_DSMASH,
    move(
      'Ressac',
      48,
      [
        {
          frames: [9, 11],
          shape: [3, 1.5, 14, 1.5, 2.5],
          damage: 12,
          angle: 30,
          base: 26,
          growth: 0.95,
        },
        {
          frames: [9, 11],
          shape: [-3, 1.5, -14, 1.5, 2.5],
          damage: 12,
          angle: 150,
          base: 26,
          growth: 0.95,
        },
      ],
      { charge: { frame: 5, ...SMASH_CHARGE } },
    ),
  ],

  // --- Aériennes ---
  [
    M_NAIR,
    move(
      'Bulle',
      38,
      [{ frames: [6, 22], shape: [0, 6.5, 6], damage: 8, angle: 50, base: 18, growth: 0.8 }],
      { landingLag: 9 },
    ),
  ],
  [
    M_FAIR,
    move(
      'Pointe',
      40,
      [
        {
          frames: [10, 13],
          shape: [4, 8, 13, 7, 2.5],
          damage: 10,
          angle: 42,
          base: 20,
          growth: 0.95,
        },
      ],
      { landingLag: 12 },
    ),
  ],
  [
    M_BAIR,
    move(
      'Contre-courant',
      36,
      [
        {
          frames: [9, 12],
          shape: [-4, 7, -12, 7, 2.8],
          damage: 12,
          angle: 140,
          base: 22,
          growth: 1,
        },
      ],
      { landingLag: 11 },
    ),
  ],
  [
    M_UAIR,
    move(
      'Vague haute',
      34,
      [
        {
          frames: [6, 11],
          shape: [-5, 13, 5, 15, 3.5],
          damage: 8,
          angle: 85,
          base: 20,
          growth: 0.9,
        },
      ],
      { landingLag: 9 },
    ),
  ],
  [
    M_DAIR,
    move(
      'Plongée',
      42,
      [
        {
          frames: [12, 15],
          shape: [0, 0, 0, -5, 3.5],
          damage: 12,
          angle: 275,
          base: 20,
          growth: 0.9,
        },
      ],
      { landingLag: 16 },
    ),
  ],

  // --- Spéciaux ---
  [
    M_NSPECIAL,
    move('Perle', 40, [], { spawn: { frame: 14, kind: PEARL, x: 7, y: 8, velX: 2.6, velY: 0 } }),
  ],
  [
    M_SSPECIAL,
    move('Galet', 44, [], { spawn: { frame: 15, kind: PEBBLE, x: 6, y: 9, velX: 1.4, velY: 1.6 } }),
  ],
  [
    // Montée en spirale, coups faibles qui retiennent, puis chute impuissante.
    M_USPECIAL,
    move(
      'Écume',
      46,
      [
        { frames: [6, 10], shape: [0, 7, 5], damage: 2, angle: 85, base: 25, growth: 0, group: 0 },
        { frames: [12, 16], shape: [0, 7, 5], damage: 2, angle: 85, base: 25, growth: 0, group: 1 },
        { frames: [18, 22], shape: [0, 7, 5], damage: 2, angle: 85, base: 25, growth: 0, group: 2 },
        {
          frames: [24, 27],
          shape: [0, 9, 5.5],
          damage: 5,
          angle: 70,
          base: 40,
          growth: 0.7,
          group: 3,
        },
      ],
      {
        intangible: [1, 4],
        motion: [
          { start: 6, end: 22, velY: 2.1 },
          { start: 23, end: 26, velY: 0.8 },
        ],
        helpless: true,
        landingLag: 20,
      },
    ),
  ],
  [
    // Pose un piège de corail devant elle. Il apparaît au-dessus du sol (plus haut que son rayon),
    // sans quoi il partirait de l'intérieur du stage et le traverserait.
    M_DSPECIAL,
    move('Corail', 46, [], { spawn: { frame: 18, kind: CORAL, x: 8, y: 3, velX: 0, velY: 0 } }),
  ],

  // --- Ultime ---
  [
    M_ULTIMATE,
    move('Grande perle', 80, [], {
      spawn: { frame: 30, kind: GREAT_PEARL, x: 8, y: 8, velX: 1.2, velY: 0 },
      intangible: [1, 80],
    }),
  ],

  // --- Rebord ---
  [
    M_LEDGE_ATTACK,
    move(
      'Remontée en vague',
      40,
      [{ frames: [20, 23], shape: [3, 4, 11, 4, 3], damage: 9, angle: 45, base: 40, growth: 0.5 }],
      { intangible: [1, 18] },
    ),
  ],
]);

const DEF: FighterDef = {
  name: 'Nacre',
  weight: fx(92),
  height: fx(13),
  halfWidth: fx(3),
  hurtboxes: [capsule([0, 3, 0, 9.5, 3]), capsule([0.4, 11, 2])],
  moves: MOVES,
  shieldMax: fx(50),
  spotDodge: dodge(26, [3, 17], 0),
  roll: dodge(30, [4, 15], 1.6),
  airDodge: dodge(40, [3, 29], 2.2),
  airDodgeLandingLag: 10,
  ledgeGetupFrames: 30,
  ledgeRollFrames: 40,
  ledgeRollDistance: fx(20),
  techFrames: 20,
  downFrames: 30,
  grab: {
    totalFrames: 36,
    start: 7,
    end: 8,
    box: capsule([3, 7.5, 10, 7.5, 2.5]),
    holdX: fx(6.5),
    pummelDamage: fx(1.2),
    pummelFrames: 18,
  },
  throws: [
    throwDef({ total: 30, release: 12, damage: 8, angle: 45, base: 48, growth: 0.6 }),
    throwDef({ total: 34, release: 16, damage: 9, angle: 135, base: 52, growth: 0.65 }),
    throwDef({ total: 30, release: 11, damage: 7, angle: 90, base: 52, growth: 0.62 }),
    throwDef({ total: 32, release: 14, damage: 6, angle: 72, base: 40, growth: 0.4 }),
  ],
  walkSpeed: fx(1),
  walkAccel: fx(0.09),
  friction: fx(0.1),
  dashSpeed: fx(1.75),
  dashFrames: 12,
  runSpeed: fx(1.5),
  runAccel: fx(0.09),
  brakeFrames: 8,
  turnFrames: 7,
  jumpSquatFrames: 3,
  jumpVelocity: fx(2.3),
  shortHopVelocity: fx(1.45),
  doubleJumpVelocity: fx(2.2),
  airJumps: 1,
  airSpeed: fx(1.05),
  airAccel: fx(0.065),
  airFriction: fx(0.015),
  gravity: fx(0.075),
  maxFallSpeed: fx(1.4),
  fastFallSpeed: fx(2.3),
  landFrames: 2,
};

export const NACRE: Character = defineCharacter({
  id: 'nacre',
  name: 'Nacre',
  archetype: 'zoneur',
  def: DEF,
  entities: ENTITIES,
  look: {
    primary: 0x2ec4c4,
    secondary: 0xf3ead8,
    build: {
      torsoWidth: 0.95,
      limbThickness: 0.9,
      headSize: 1.1,
      legLength: 1.1,
      armLength: 1.05,
      shoulderWidth: 1,
    },
    parts: [
      // Haute coiffe, à la couleur du joueur.
      {
        anchor: 'head',
        x: 0,
        y: 0.16,
        z: 0,
        width: 0.12,
        height: 0.17,
        depth: 0.12,
        angle: 0,
        color: 'player',
      },
      // Panache nacré qui retombe vers l'arrière.
      {
        anchor: 'head',
        x: -0.09,
        y: 0.22,
        z: 0,
        width: 0.06,
        height: 0.13,
        depth: 0.05,
        angle: -0.6,
        color: 'secondary',
      },
      // Col évasé.
      {
        anchor: 'torso',
        x: 0,
        y: 0.33,
        z: 0,
        width: 0.2,
        height: 0.05,
        depth: 0.26,
        angle: 0,
        color: 'secondary',
      },
    ],
    // Figurine : gardienne des récifs. Couronne de corail, longues mèches, robe-coquillage irisée,
    // collier de perles, voiles, bâton de corail dans la main côté caméra. Tête de rayon 0,11.
    palette: { skin: 0xc99b7a, hair: 0x1d3b5a, accent: 0xe9f1f0, light: 0xfffaf0, dark: 0xe25a5a },
    iridescent: 'accent',
    vfx: 'pearl',
    palettes: [
      {},
      { primary: 0xe2708a, hair: 0x5a1d3b, dark: 0x2ec4c4 },
      { primary: 0x6a5ae2, hair: 0xe9e4f5, dark: 0xf2c14a },
      { primary: 0x2a8a5a, hair: 0x1a2a1a, dark: 0xff8a5a },
      { primary: 0x1d2a4a, secondary: 0xc8d4f0, hair: 0xa8d8f0, dark: 0x6ae2f0 },
      { primary: 0xf2c14a, secondary: 0xfff6dc, hair: 0x7a3a1a, dark: 0xe25a5a, skin: 0xf0c8a8 },
      { primary: 0xe8ecf0, secondary: 0x9ab4c8, hair: 0x2a2f3a, dark: 0x5ab4e2 },
      { primary: 0x3a2a4a, secondary: 0xd9c8e8, hair: 0xe25ab4, dark: 0xb4f05a, skin: 0x8a5c42 },
    ],
    sculpt: [
      // Couronne de corail, à la couleur du joueur.
      {
        bone: 'head',
        shape: 'capsule',
        zone: 'player',
        from: [0, 0.2, 0],
        to: [0.03, 0.27, 0],
        radius: 0.012,
        radiusTo: 0.008,
      },
      {
        bone: 'head',
        shape: 'capsule',
        zone: 'player',
        from: [-0.04, 0.2, 0.04],
        to: [-0.06, 0.26, 0.07],
        radius: 0.011,
        radiusTo: 0.007,
        mirror: true,
      },
      {
        bone: 'head',
        shape: 'capsule',
        zone: 'player',
        from: [0.04, 0.19, 0.05],
        to: [0.07, 0.24, 0.08],
        radius: 0.01,
        radiusTo: 0.006,
        mirror: true,
      },
      // Longues mèches qui tombent dans le dos.
      {
        bone: 'tail1',
        frame: 'head',
        shape: 'capsule',
        zone: 'hair',
        from: [-0.07, 0.16, 0],
        to: [-0.11, 0.075, 0],
        radius: 0.036,
        radiusTo: 0.028,
        blend: 0.02,
      },
      {
        bone: 'tail2',
        frame: 'head',
        shape: 'capsule',
        zone: 'hair',
        from: [-0.11, 0.075, 0],
        to: [-0.15, -0.01, 0],
        radius: 0.028,
        radiusTo: 0.02,
        blend: 0.01,
      },
      {
        bone: 'tail1',
        frame: 'head',
        shape: 'capsule',
        zone: 'hair',
        from: [-0.06, 0.16, 0.05],
        to: [-0.09, 0.09, 0.065],
        radius: 0.03,
        radiusTo: 0.023,
        blend: 0.02,
        mirror: true,
      },
      {
        bone: 'tail2',
        frame: 'head',
        shape: 'capsule',
        zone: 'hair',
        from: [-0.09, 0.09, 0.065],
        to: [-0.12, 0.02, 0.08],
        radius: 0.023,
        radiusTo: 0.016,
        blend: 0.01,
        mirror: true,
      },
      // Robe-coquillage irisée jusqu'aux genoux, col et collier de perles.
      {
        bone: 'skirt',
        frame: 'hips',
        shape: 'capsule',
        zone: 'accent',
        from: [0, 0.07, 0],
        to: [0, -0.17, 0],
        radius: 0.086,
        radiusTo: 0.135,
        blend: 0.02,
      },
      {
        bone: 'spine',
        shape: 'ellipsoid',
        zone: 'light',
        center: [0, 0.33, 0],
        size: [0.085, 0.024, 0.1],
        blend: 0.008,
      },
      {
        bone: 'spine',
        shape: 'ellipsoid',
        zone: 'light',
        center: [0.07, 0.285, 0],
        size: [0.013, 0.013, 0.013],
      },
      {
        bone: 'spine',
        shape: 'ellipsoid',
        zone: 'light',
        center: [0.064, 0.3, 0.032],
        size: [0.012, 0.012, 0.012],
        mirror: true,
      },
      // Voiles qui flottent derrière les épaules.
      {
        bone: 'cloth1',
        frame: 'spine',
        shape: 'capsule',
        zone: 'secondary',
        from: [-0.06, 0.3, 0.08],
        to: [-0.13, 0.175, 0.1],
        radius: 0.015,
        radiusTo: 0.011,
        mirror: true,
      },
      {
        bone: 'cloth2',
        frame: 'spine',
        shape: 'capsule',
        zone: 'secondary',
        from: [-0.13, 0.175, 0.1],
        to: [-0.2, 0.05, 0.12],
        radius: 0.011,
        radiusTo: 0.006,
        blend: 0.003,
        mirror: true,
      },
      // Bâton de corail, tenu à l'horizontale ; branches et perle au bout.
      {
        bone: 'handF',
        shape: 'capsule',
        zone: 'dark',
        from: [-0.18, -0.03, 0],
        to: [0.32, -0.03, 0],
        radius: 0.012,
      },
      {
        bone: 'handF',
        shape: 'capsule',
        zone: 'dark',
        from: [0.32, -0.03, 0],
        to: [0.38, 0.03, 0],
        radius: 0.012,
        radiusTo: 0.007,
      },
      {
        bone: 'handF',
        shape: 'capsule',
        zone: 'dark',
        from: [0.33, -0.03, 0],
        to: [0.37, -0.08, 0.02],
        radius: 0.01,
        radiusTo: 0.006,
      },
      {
        bone: 'handF',
        shape: 'ellipsoid',
        zone: 'light',
        center: [0.345, 0, 0],
        size: [0.022, 0.022, 0.022],
      },
    ],
  },
});
