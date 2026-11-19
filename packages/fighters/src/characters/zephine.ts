/**
 * Zéphine — rapide.
 *
 * Coursière des falaises, acrobate. Très mobile (deux sauts aériens, la course la plus rapide),
 * coups faibles mais nombreux et rapides ; légère, donc éjectée tôt.
 *
 * Unités : distances en unités de jeu (Zéphine mesure 11), vitesses par frame, durées en frames.
 */
import {
  ENTITY_DESTROY,
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

/** Projectile 1 : plume, rapide et de courte portée. */
const FEATHER = 1;

const ENTITIES: EntityDef[] = [
  {
    name: 'Plume',
    radius: fx(1.2),
    gravity: fx(0),
    lifetime: 14,
    stageCollision: ENTITY_DESTROY,
    hit: { damage: fx(3), angle: 40, baseKnockback: fx(8), knockbackGrowth: fx(0.3) },
    destroyOnHit: true,
  },
];

const SMASH_CHARGE = { maxFrames: 60, maxScale: 1.4 };

const MOVES = moveset([
  // --- Normaux ---
  [
    M_JAB,
    move(
      'Pique',
      14,
      [{ frames: [2, 3], shape: [5.5, 7, 2.2], damage: 2, angle: 80, base: 5, growth: 0.2 }],
      { cancels: [{ start: 5, end: 14, on: M_JAB, to: M_JAB2, requiresHit: false }] },
    ),
  ],
  [
    M_JAB2,
    move(
      'Contre-pique',
      16,
      [{ frames: [2, 3], shape: [6, 7, 2.2], damage: 2, angle: 80, base: 5, growth: 0.2 }],
      { cancels: [{ start: 5, end: 16, on: M_JAB, to: M_JAB3, requiresHit: false }] },
    ),
  ],
  [
    M_JAB3,
    move('Coup de talon', 24, [
      { frames: [4, 6], shape: [3, 4, 8, 4.5, 2.5], damage: 4, angle: 45, base: 28, growth: 0.8 },
    ]),
  ],
  [
    M_FTILT,
    move('Fouet', 22, [
      { frames: [5, 7], shape: [4, 6, 9.5, 6.5, 2.2], damage: 7, angle: 40, base: 10, growth: 0.9 },
    ]),
  ],
  [
    M_UTILT,
    move('Moulinet', 22, [
      { frames: [4, 9], shape: [3, 9, -3, 11, 3], damage: 5, angle: 95, base: 20, growth: 0.8 },
    ]),
  ],
  [
    M_DTILT,
    move('Fauchage', 16, [
      { frames: [4, 6], shape: [3, 1, 9, 1, 2], damage: 5, angle: 75, base: 18, growth: 0.5 },
    ]),
  ],
  [
    M_DASH_ATTACK,
    move(
      'Glissade',
      30,
      [{ frames: [5, 12], shape: [4, 2, 7, 2, 2.5], damage: 7, angle: 70, base: 30, growth: 0.6 }],
      { motion: [{ start: 1, end: 10, velX: 2.2 }] },
    ),
  ],

  // --- Smash ---
  [
    // Deux estocs : le premier retient, le second éjecte.
    M_FSMASH,
    move(
      'Double estoc',
      40,
      [
        {
          frames: [11, 12],
          shape: [4, 6, 10, 6, 2],
          damage: 4,
          angle: 60,
          base: 20,
          growth: 0,
          group: 0,
        },
        {
          frames: [16, 18],
          shape: [4, 6, 11, 6, 2.5],
          damage: 10,
          angle: 38,
          base: 24,
          growth: 1,
          group: 1,
        },
      ],
      { charge: { frame: 5, ...SMASH_CHARGE } },
    ),
  ],
  [
    M_USMASH,
    move(
      'Vrille',
      40,
      [
        {
          frames: [9, 13],
          shape: [0, 10, 0, 16, 3],
          damage: 12,
          angle: 88,
          base: 28,
          growth: 0.95,
        },
      ],
      { charge: { frame: 4, ...SMASH_CHARGE } },
    ),
  ],
  [
    // Devant et derrière à la fois.
    M_DSMASH,
    move(
      'Éventail',
      40,
      [
        {
          frames: [6, 7],
          shape: [3, 1.5, 9, 1.5, 2.2],
          damage: 11,
          angle: 30,
          base: 24,
          growth: 0.95,
        },
        {
          frames: [6, 7],
          shape: [-3, 1.5, -9, 1.5, 2.2],
          damage: 11,
          angle: 150,
          base: 24,
          growth: 0.95,
        },
      ],
      { charge: { frame: 4, ...SMASH_CHARGE } },
    ),
  ],

  // --- Aériennes ---
  [
    M_NAIR,
    move(
      'Roue',
      30,
      [
        { frames: [3, 5], shape: [0, 5.5, 5], damage: 7, angle: 45, base: 15, growth: 0.8 },
        { frames: [6, 16], shape: [0, 5.5, 4.5], damage: 4, angle: 45, base: 10, growth: 0.6 },
      ],
      { landingLag: 5 },
    ),
  ],
  [
    M_FAIR,
    move(
      'Ciseaux',
      32,
      [
        { frames: [6, 7], shape: [5, 6, 2.8], damage: 3, angle: 60, base: 20, growth: 0, group: 0 },
        {
          frames: [11, 13],
          shape: [5.5, 6, 3],
          damage: 6,
          angle: 40,
          base: 18,
          growth: 0.9,
          group: 1,
        },
      ],
      { landingLag: 8 },
    ),
  ],
  [
    M_BAIR,
    move(
      'Talon arrière',
      28,
      [
        {
          frames: [5, 8],
          shape: [-3.5, 5.5, -8, 5.5, 2.5],
          damage: 9,
          angle: 140,
          base: 18,
          growth: 1,
        },
      ],
      { landingLag: 8 },
    ),
  ],
  [
    M_UAIR,
    move(
      'Pirouette',
      26,
      [
        {
          frames: [4, 8],
          shape: [-2.5, 11.5, 3, 12.5, 3],
          damage: 6,
          angle: 85,
          base: 18,
          growth: 0.85,
        },
      ],
      { landingLag: 6 },
    ),
  ],
  [
    // Trois coups vers le bas, le dernier plaque au sol.
    M_DAIR,
    move(
      'Piétinement',
      34,
      [
        {
          frames: [6, 7],
          shape: [0, 0, 0, -2.5, 3],
          damage: 2,
          angle: 270,
          base: 2,
          growth: 0,
          group: 0,
        },
        {
          frames: [10, 11],
          shape: [0, 0, 0, -2.5, 3],
          damage: 2,
          angle: 270,
          base: 2,
          growth: 0,
          group: 1,
        },
        {
          frames: [14, 16],
          shape: [0, 0, 0, -2.5, 3],
          damage: 5,
          angle: 280,
          base: 22,
          growth: 0.85,
          group: 2,
        },
      ],
      { landingLag: 12 },
    ),
  ],

  // --- Spéciaux ---
  [
    M_NSPECIAL,
    move('Plumes', 30, [], { spawn: { frame: 9, kind: FEATHER, x: 6, y: 7, velX: 3, velY: 0 } }),
  ],
  [
    // Traversée rapide qui frappe au passage. En l'air, la gravité continue d'agir.
    M_SSPECIAL,
    move(
      'Fente',
      34,
      [{ frames: [7, 16], shape: [3, 6, 3], damage: 7, angle: 35, base: 30, growth: 0.6 }],
      { motion: [{ start: 6, end: 16, velX: 2.8 }], landingLag: 14 },
    ),
  ],
  [
    // Bond en diagonale vers l'avant, très rapide.
    M_USPECIAL,
    move(
      'Envol',
      34,
      [
        { frames: [4, 8], shape: [0, 6, 4], damage: 4, angle: 80, base: 30, growth: 0, group: 0 },
        {
          frames: [12, 16],
          shape: [0, 7, 4],
          damage: 4,
          angle: 70,
          base: 40,
          growth: 0.6,
          group: 1,
        },
      ],
      {
        intangible: [1, 3],
        motion: [
          { start: 4, end: 16, velX: 1.5, velY: 2.4 },
          { start: 17, end: 20, velX: 0.6, velY: 0.8 },
        ],
        helpless: true,
        landingLag: 18,
      },
    ),
  ],
  [
    // En l'air, coup de pied plongeant en diagonale ; au sol, glissade.
    M_DSPECIAL,
    move(
      'Piqué',
      36,
      [{ frames: [5, 30], shape: [3, 1, 3], damage: 8, angle: 45, base: 25, growth: 0.7 }],
      { motion: [{ start: 5, end: 30, velX: 1.6, velY: -2.6 }], landingLag: 10 },
    ),
  ],

  // --- Ultime ---
  [
    // Traverse le stage en frappant tout sur son passage.
    M_ULTIMATE,
    move(
      'Mille rafales',
      80,
      [
        { frames: [10, 14], shape: [0, 6, 6], damage: 5, angle: 80, base: 40, growth: 0, group: 0 },
        { frames: [20, 24], shape: [0, 6, 6], damage: 5, angle: 80, base: 40, growth: 0, group: 1 },
        { frames: [30, 34], shape: [0, 6, 6], damage: 5, angle: 80, base: 40, growth: 0, group: 2 },
        {
          frames: [44, 48],
          shape: [0, 6, 8],
          damage: 18,
          angle: 45,
          base: 85,
          growth: 1,
          group: 3,
        },
      ],
      { intangible: [1, 80], motion: [{ start: 10, end: 40, velX: 3 }] },
    ),
  ],

  // --- Rebord ---
  [
    M_LEDGE_ATTACK,
    move(
      'Bond du rebord',
      34,
      [{ frames: [16, 19], shape: [3, 3, 8, 3, 2.5], damage: 8, angle: 45, base: 38, growth: 0.5 }],
      { intangible: [1, 15] },
    ),
  ],
]);

const DEF: FighterDef = {
  name: 'Zéphine',
  weight: fx(82),
  height: fx(11),
  halfWidth: fx(2.6),
  hurtboxes: [capsule([0, 2.8, 0, 7.8, 2.6]), capsule([0.4, 9, 2])],
  moves: MOVES,
  shieldMax: fx(45),
  spotDodge: dodge(24, [3, 16], 0),
  roll: dodge(28, [4, 14], 1.9),
  airDodge: dodge(38, [3, 27], 2.4),
  airDodgeLandingLag: 9,
  ledgeGetupFrames: 28,
  ledgeRollFrames: 36,
  ledgeRollDistance: fx(22),
  techFrames: 18,
  downFrames: 28,
  grab: {
    totalFrames: 32,
    start: 6,
    end: 7,
    box: capsule([2.5, 6, 8, 6, 2.2]),
    holdX: fx(5.5),
    pummelDamage: fx(1),
    pummelFrames: 14,
  },
  throws: [
    throwDef({ total: 26, release: 10, damage: 6, angle: 40, base: 45, growth: 0.55 }),
    throwDef({ total: 30, release: 14, damage: 9, angle: 140, base: 50, growth: 0.65 }),
    throwDef({ total: 26, release: 9, damage: 5, angle: 90, base: 45, growth: 0.55 }),
    throwDef({ total: 28, release: 12, damage: 5, angle: 70, base: 35, growth: 0.35 }),
  ],
  walkSpeed: fx(1.3),
  walkAccel: fx(0.12),
  friction: fx(0.1),
  dashSpeed: fx(2.5),
  dashFrames: 9,
  runSpeed: fx(2.3),
  runAccel: fx(0.14),
  brakeFrames: 7,
  turnFrames: 5,
  jumpSquatFrames: 3,
  jumpVelocity: fx(2.6),
  shortHopVelocity: fx(1.7),
  doubleJumpVelocity: fx(2.3),
  airJumps: 2,
  airSpeed: fx(1.35),
  airAccel: fx(0.09),
  airFriction: fx(0.015),
  gravity: fx(0.1),
  maxFallSpeed: fx(1.9),
  fastFallSpeed: fx(2.9),
  landFrames: 2,
};

export const ZEPHINE: Character = defineCharacter({
  id: 'zephine',
  name: 'Zéphine',
  archetype: 'rapide',
  def: DEF,
  entities: ENTITIES,
  look: {
    primary: 0x5ee6b5,
    secondary: 0x2b2f36,
    build: {
      torsoWidth: 0.85,
      limbThickness: 0.8,
      headSize: 0.95,
      legLength: 1.15,
      armLength: 1,
      shoulderWidth: 0.9,
    },
    parts: [
      // Col de l'écharpe, à la couleur du joueur.
      {
        anchor: 'torso',
        x: 0,
        y: 0.33,
        z: 0,
        width: 0.17,
        height: 0.05,
        depth: 0.2,
        angle: 0,
        color: 'player',
      },
      // Longue écharpe qui flotte derrière elle.
      {
        anchor: 'torso',
        x: -0.2,
        y: 0.3,
        z: 0.05,
        width: 0.28,
        height: 0.045,
        depth: 0.03,
        angle: -0.35,
        color: 'player',
      },
    ],
    // Figurine : coursière des falaises. Queue de cheval haute, frange, lunettes d'aviatrice
    // relevées, écharpe, sacoche en bandoulière, bottes à plumes. Tête de rayon 0,095.
    palette: { skin: 0xf2c09a, hair: 0xd9663a, accent: 0xf2b33d, light: 0xfdf6e3, dark: 0x2b2f36 },
    vfx: 'feather',
    palettes: [
      {},
      { primary: 0xf2884a, secondary: 0x2b2f36, hair: 0x2a1e1a, accent: 0x5ee6b5 },
      { primary: 0x8a6ff0, secondary: 0x1f2233, hair: 0xf2e1b0, accent: 0xf2b33d },
      { primary: 0xf2d24a, secondary: 0x3a3f48, hair: 0x6b3a2a, accent: 0xe24a6a },
      { primary: 0xe8ecf2, secondary: 0x3d6fd9, hair: 0x1e2433, accent: 0x3d6fd9 },
      { primary: 0x3a4250, secondary: 0x16181d, hair: 0xe85a8a, accent: 0x5ee6b5 },
      { primary: 0x6fc24a, secondary: 0x4a3324, hair: 0xb8572a, accent: 0xf2e1b0 },
      { primary: 0xf27a9a, secondary: 0xfdf2f5, hair: 0x7a4ad9, accent: 0xffffff, skin: 0x8f5c3d },
    ],
    sculpt: [
      {
        bone: 'head',
        shape: 'ellipsoid',
        zone: 'hair',
        center: [0.028, 0.15, 0],
        size: [0.068, 0.03, 0.084],
        blend: 0.01,
      },
      {
        bone: 'head',
        shape: 'ellipsoid',
        zone: 'hair',
        center: [-0.05, 0.19, 0],
        size: [0.036, 0.03, 0.036],
        blend: 0.012,
      },
      {
        bone: 'tail1',
        frame: 'head',
        shape: 'capsule',
        zone: 'hair',
        from: [-0.06, 0.2, 0],
        to: [-0.115, 0.135, 0],
        radius: 0.026,
        radiusTo: 0.019,
        blend: 0.012,
      },
      {
        bone: 'tail2',
        frame: 'head',
        shape: 'capsule',
        zone: 'hair',
        from: [-0.115, 0.135, 0],
        to: [-0.17, 0.07, 0],
        radius: 0.019,
        radiusTo: 0.011,
        blend: 0.006,
      },
      // Lunettes relevées sur le front : bande sombre et deux verres ambrés.
      {
        bone: 'head',
        shape: 'ellipsoid',
        zone: 'dark',
        center: [0.004, 0.13, 0],
        size: [0.097, 0.012, 0.09],
      },
      {
        bone: 'head',
        shape: 'ellipsoid',
        zone: 'accent',
        center: [0.074, 0.146, 0.034],
        size: [0.022, 0.02, 0.022],
        mirror: true,
      },
      // Écharpe : col et pan qui file en arrière.
      {
        bone: 'spine',
        shape: 'ellipsoid',
        zone: 'player',
        center: [0, 0.335, 0],
        size: [0.07, 0.03, 0.075],
        blend: 0.01,
      },
      {
        bone: 'cloth1',
        frame: 'spine',
        shape: 'capsule',
        zone: 'player',
        from: [-0.05, 0.33, 0.03],
        to: [-0.125, 0.29, 0.045],
        radius: 0.02,
        radiusTo: 0.016,
      },
      {
        bone: 'cloth2',
        frame: 'spine',
        shape: 'capsule',
        zone: 'player',
        from: [-0.125, 0.29, 0.045],
        to: [-0.2, 0.25, 0.06],
        radius: 0.016,
        radiusTo: 0.011,
        blend: 0.004,
      },
      // Sacoche et sa bandoulière.
      {
        bone: 'hips',
        shape: 'box',
        zone: 'accent',
        center: [-0.02, 0.01, 0.085],
        size: [0.04, 0.034, 0.014],
        round: 0.01,
      },
      {
        bone: 'spine',
        shape: 'capsule',
        zone: 'dark',
        from: [0.06, 0.31, 0.045],
        to: [-0.02, 0.02, 0.075],
        radius: 0.007,
      },
      // Bottes et leurs plumes.
      {
        bone: 'shinF',
        shape: 'capsule',
        zone: 'dark',
        from: [0, -0.17, 0],
        to: [0, -0.24, 0],
        radius: 0.034,
        radiusTo: 0.032,
        blend: 0.01,
        mirror: true,
      },
      {
        bone: 'shinF',
        shape: 'capsule',
        zone: 'light',
        from: [-0.02, -0.17, 0.022],
        to: [-0.065, -0.115, 0.03],
        radius: 0.009,
        radiusTo: 0.004,
        mirror: true,
      },
    ],
  },
});
