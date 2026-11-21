/**
 * Ferroc — lourd.
 *
 * Forgeron des volcans, bardé de fer. Lent à démarrer et à se déplacer, mais ses coups sont les
 * plus forts du roster, et deux de ses spéciaux ont de l'armure : il encaisse sans broncher.
 *
 * Unités : distances en unités de jeu (Ferroc mesure 15), vitesses par frame, durées en frames.
 */
import {
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
  type FighterDef,
} from '@game/sim-core';
import { capsule, dodge, move, moveset, throwDef } from '../build.ts';
import { defineCharacter, type Character } from '../character.ts';

const SMASH_CHARGE = { maxFrames: 60, maxScale: 1.4 };

const MOVES = moveset([
  // --- Normaux ---
  [
    M_JAB,
    move(
      'Marteau',
      24,
      [{ frames: [5, 7], shape: [7, 9, 3], damage: 4, angle: 70, base: 10, growth: 0.3 }],
      { cancels: [{ start: 9, end: 24, on: M_JAB, to: M_JAB2, requiresHit: false }] },
    ),
  ],
  [
    M_JAB2,
    move(
      'Enclume',
      26,
      [{ frames: [6, 8], shape: [7.5, 8, 3.5], damage: 4, angle: 70, base: 12, growth: 0.3 }],
      { cancels: [{ start: 12, end: 26, on: M_JAB, to: M_JAB3, requiresHit: false }] },
    ),
  ],
  [
    M_JAB3,
    move('Coup de boutoir', 36, [
      { frames: [8, 10], shape: [4, 7, 10, 7, 3.5], damage: 9, angle: 40, base: 38, growth: 0.9 },
    ]),
  ],
  [
    M_FTILT,
    move('Revers de pelle', 34, [
      { frames: [9, 12], shape: [4, 8, 12, 8, 3.2], damage: 13, angle: 38, base: 18, growth: 1 },
    ]),
  ],
  [
    M_UTILT,
    move('Uppercut', 34, [
      {
        frames: [8, 12],
        shape: [4, 11, 1, 16, 3.5],
        damage: 12,
        angle: 88,
        base: 26,
        growth: 0.95,
      },
    ]),
  ],
  [
    M_DTILT,
    move('Coup de pied bas', 26, [
      {
        frames: [7, 9],
        shape: [3, 1.5, 11, 1.5, 2.8],
        damage: 10,
        angle: 70,
        base: 22,
        growth: 0.7,
      },
    ]),
  ],
  [
    M_DASH_ATTACK,
    move(
      'Charge brute',
      42,
      [{ frames: [9, 15], shape: [6, 8, 4.5], damage: 13, angle: 45, base: 38, growth: 0.8 }],
      { motion: [{ start: 1, end: 12, velX: 1.6 }] },
    ),
  ],

  // --- Smash ---
  [
    M_FSMASH,
    move(
      'Masse d’armes',
      62,
      [
        {
          frames: [20, 23],
          shape: [5, 9, 15, 7, 4],
          damage: 24,
          angle: 38,
          base: 34,
          growth: 1.15,
        },
      ],
      { charge: { frame: 9, ...SMASH_CHARGE } },
    ),
  ],
  [
    M_USMASH,
    move(
      'Éruption',
      56,
      [
        {
          frames: [16, 20],
          shape: [0, 13, 0, 24, 4.5],
          damage: 21,
          angle: 88,
          base: 32,
          growth: 1.1,
        },
      ],
      { charge: { frame: 8, ...SMASH_CHARGE } },
    ),
  ],
  [
    // Frappe le sol des deux côtés à la fois.
    M_DSMASH,
    move(
      'Frappe au sol',
      58,
      [
        {
          frames: [12, 15],
          shape: [2, 1.5, 12, 1.5, 3.5],
          damage: 19,
          angle: 35,
          base: 30,
          growth: 1.05,
        },
        {
          frames: [12, 15],
          shape: [-2, 1.5, -12, 1.5, 3.5],
          damage: 19,
          angle: 145,
          base: 30,
          growth: 1.05,
        },
      ],
      { charge: { frame: 7, ...SMASH_CHARGE } },
    ),
  ],

  // --- Aériennes ---
  [
    M_NAIR,
    move(
      'Toupie de fer',
      44,
      [{ frames: [7, 14], shape: [0, 7.5, 6.5], damage: 12, angle: 45, base: 22, growth: 0.9 }],
      { landingLag: 12 },
    ),
  ],
  [
    M_FAIR,
    move(
      'Coup de massue',
      48,
      [{ frames: [13, 16], shape: [5, 10, 11, 5, 4], damage: 16, angle: 40, base: 26, growth: 1 }],
      { landingLag: 16 },
    ),
  ],
  [
    M_BAIR,
    move(
      'Coude arrière',
      40,
      [
        {
          frames: [10, 13],
          shape: [-5, 8, -11, 8, 3.5],
          damage: 15,
          angle: 145,
          base: 26,
          growth: 1,
        },
      ],
      { landingLag: 14 },
    ),
  ],
  [
    M_UAIR,
    move(
      'Tête-bêche',
      40,
      [
        {
          frames: [8, 13],
          shape: [-4, 16, 4, 17, 4],
          damage: 13,
          angle: 85,
          base: 24,
          growth: 0.95,
        },
      ],
      { landingLag: 12 },
    ),
  ],
  [
    M_DAIR,
    move(
      'Enclume tombante',
      50,
      [
        {
          frames: [16, 20],
          shape: [0, 0, 0, -4, 4.5],
          damage: 17,
          angle: 275,
          base: 25,
          growth: 0.95,
        },
      ],
      { landingLag: 22 },
    ),
  ],

  // --- Spéciaux ---
  [
    // Coup de poing chargeable ; l'armure couvre toute la charge.
    M_NSPECIAL,
    move(
      'Bélier',
      60,
      [{ frames: [20, 23], shape: [5, 8, 13, 8, 4], damage: 18, angle: 40, base: 40, growth: 1 }],
      {
        charge: { frame: 10, maxFrames: 90, maxScale: 1.8 },
        armor: { start: 1, end: 22, maxKnockback: 90 },
      },
    ),
  ],
  [
    // Charge à l'épaule, avec armure. En l'air, la gravité continue d'agir.
    M_SSPECIAL,
    move(
      'Rempart',
      46,
      [{ frames: [10, 22], shape: [4, 8, 4.5], damage: 14, angle: 40, base: 40, growth: 0.85 }],
      {
        armor: { start: 1, end: 20, maxKnockback: 70 },
        motion: [{ start: 8, end: 22, velX: 1.9 }],
        landingLag: 20,
      },
    ),
  ],
  [
    // Montée lente, dernier coup très fort.
    M_USPECIAL,
    move(
      'Geyser',
      52,
      [
        { frames: [6, 10], shape: [0, 8, 6], damage: 4, angle: 85, base: 35, growth: 0, group: 0 },
        { frames: [12, 16], shape: [0, 8, 6], damage: 4, angle: 85, base: 35, growth: 0, group: 1 },
        {
          frames: [26, 30],
          shape: [0, 12, 6.5],
          damage: 12,
          angle: 75,
          base: 60,
          growth: 1,
          group: 2,
        },
      ],
      {
        intangible: [1, 6],
        motion: [
          { start: 6, end: 24, velY: 2.2 },
          { start: 25, end: 30, velY: 1 },
        ],
        helpless: true,
        landingLag: 26,
      },
    ),
  ],
  [
    // En l'air, chute lourde qui plaque ; au sol, onde des deux côtés.
    M_DSPECIAL,
    move(
      'Séisme',
      50,
      [
        {
          frames: [8, 40],
          shape: [0, 1, 4.5],
          damage: 15,
          angle: 275,
          base: 25,
          growth: 0.9,
          group: 0,
        },
        {
          frames: [14, 17],
          shape: [-11, 1, 11, 1, 3.5],
          damage: 14,
          angle: 60,
          base: 35,
          growth: 0.9,
          group: 1,
        },
      ],
      { motion: [{ start: 8, end: 40, velY: -3.2 }], landingLag: 24 },
    ),
  ],

  // --- Ultime ---
  [
    // Le sol s'embrase des deux côtés, puis une explosion éjecte tout le monde.
    M_ULTIMATE,
    move(
      'Fournaise',
      100,
      [
        {
          frames: [30, 36],
          shape: [-22, 4, 22, 4, 10],
          damage: 10,
          angle: 85,
          base: 50,
          growth: 0,
          group: 0,
        },
        {
          frames: [60, 66],
          shape: [0, 10, 22],
          damage: 30,
          angle: 60,
          base: 95,
          growth: 1,
          group: 1,
        },
      ],
      { intangible: [1, 100] },
    ),
  ],

  // --- Rebord ---
  [
    M_LEDGE_ATTACK,
    move(
      'Remontée lourde',
      44,
      [
        {
          frames: [22, 26],
          shape: [4, 4, 12, 4, 3.5],
          damage: 11,
          angle: 45,
          base: 42,
          growth: 0.5,
        },
      ],
      { intangible: [1, 20] },
    ),
  ],
]);

const DEF: FighterDef = {
  name: 'Ferroc',
  weight: fx(132),
  height: fx(15),
  halfWidth: fx(4.2),
  hurtboxes: [capsule([0, 4.5, 0, 10, 4.5]), capsule([0.5, 12.8, 2.2])],
  moves: MOVES,
  shieldMax: fx(60),
  spotDodge: dodge(28, [3, 16], 0),
  roll: dodge(34, [5, 15], 1.4),
  airDodge: dodge(44, [4, 28], 2),
  airDodgeLandingLag: 12,
  ledgeGetupFrames: 34,
  ledgeRollFrames: 44,
  ledgeRollDistance: fx(18),
  techFrames: 22,
  downFrames: 34,
  grab: {
    totalFrames: 40,
    start: 9,
    end: 10,
    box: capsule([3, 8, 11, 8, 3]),
    holdX: fx(7),
    pummelDamage: fx(1.8),
    pummelFrames: 22,
  },
  throws: [
    throwDef({ total: 36, release: 16, damage: 11, angle: 45, base: 55, growth: 0.7 }),
    throwDef({ total: 42, release: 20, damage: 13, angle: 135, base: 60, growth: 0.8 }),
    throwDef({ total: 36, release: 14, damage: 10, angle: 90, base: 60, growth: 0.75 }),
    throwDef({ total: 40, release: 18, damage: 8, angle: 70, base: 45, growth: 0.5 }),
  ],
  walkSpeed: fx(0.8),
  walkAccel: fx(0.08),
  friction: fx(0.12),
  dashSpeed: fx(1.6),
  dashFrames: 14,
  runSpeed: fx(1.35),
  runAccel: fx(0.08),
  brakeFrames: 10,
  turnFrames: 8,
  jumpSquatFrames: 5,
  jumpVelocity: fx(2.45),
  shortHopVelocity: fx(1.55),
  doubleJumpVelocity: fx(2.3),
  airJumps: 1,
  airSpeed: fx(0.95),
  airAccel: fx(0.05),
  airFriction: fx(0.02),
  gravity: fx(0.11),
  maxFallSpeed: fx(1.8),
  fastFallSpeed: fx(2.8),
  landFrames: 4,
};

export const FERROC: Character = defineCharacter({
  id: 'ferroc',
  name: 'Ferroc',
  archetype: 'lourd',
  def: DEF,
  entities: [],
  look: {
    primary: 0x9a4a2a,
    secondary: 0xf28b30,
    build: {
      torsoWidth: 1.6,
      limbThickness: 1.5,
      headSize: 0.8,
      legLength: 0.9,
      armLength: 1.1,
      shoulderWidth: 1.3,
    },
    parts: [
      // Épaulières, à la couleur du joueur.
      {
        anchor: 'torso',
        x: 0,
        y: 0.33,
        z: 0.2,
        width: 0.16,
        height: 0.08,
        depth: 0.11,
        angle: 0,
        color: 'player',
        mirror: true,
      },
      // Ceinturon de forge.
      {
        anchor: 'hips',
        x: 0,
        y: 0.03,
        z: 0,
        width: 0.25,
        height: 0.06,
        depth: 0.32,
        angle: 0,
        color: 0x3a2a20,
      },
    ],
    // Figurine : forgeron massif. Barbe, cheveux ras, tablier de cuir, épaulières arrondies,
    // bracelets de fer, gantelets incandescents, ceinturon, chaîne, bottes. Tête de rayon 0,08.
    palette: { skin: 0xc98b62, hair: 0x2a1c14, accent: 0xff7a1a, light: 0x8d939c, dark: 0x4a2f20 },
    emissive: 'accent',
    vfx: 'ember',
    // Épaulières et bracelets de fer.
    materials: { player: 'metal', light: 'metal' },
    // Modèle animé à la main (packages/render/tools/characters/ferroc.ts, bible : assets/fighters/ferroc/DESIGN.md).
    model: 'fighters/ferroc/model.glb',
    palettes: [
      {},
      { primary: 0x3d4a5c, secondary: 0x8aa4c2, accent: 0x4ac7ff, hair: 0x14161a },
      { primary: 0x5c6b3d, secondary: 0xc2b48a, accent: 0xffc14a, hair: 0x6b4a2a },
      { primary: 0x2a2a2e, secondary: 0x5a5a62, accent: 0xff3a2a, hair: 0xd9d4c8 },
      { primary: 0x7a2a3a, secondary: 0xe0b46a, accent: 0xff9a3a, dark: 0x2a1c14 },
      { primary: 0xd9cbb0, secondary: 0x7a5a3a, accent: 0xff6a1a, hair: 0xb8572a, skin: 0xe6b38c },
      { primary: 0x2f6b6b, secondary: 0xa8d0c8, accent: 0x7affc8, hair: 0x1a2a2a },
      { primary: 0x4a2a6b, secondary: 0xb89ad9, accent: 0xff4ad9, hair: 0x14101a, skin: 0x8a5a3d },
    ],
    sculpt: [
      {
        bone: 'head',
        shape: 'ellipsoid',
        zone: 'hair',
        center: [0.05, 0.035, 0],
        size: [0.058, 0.05, 0.064],
        blend: 0.015,
      },
      {
        bone: 'head',
        shape: 'ellipsoid',
        zone: 'hair',
        center: [-0.035, 0.11, 0],
        size: [0.066, 0.052, 0.074],
        blend: 0.01,
      },
      // Tablier de cuir sur la poitrine et le ventre, puis sur les cuisses.
      {
        bone: 'spine',
        shape: 'box',
        zone: 'dark',
        center: [0.118, 0.14, 0],
        size: [0.02, 0.15, 0.1],
        round: 0.015,
        blend: 0.012,
      },
      {
        bone: 'skirt',
        frame: 'hips',
        shape: 'box',
        zone: 'dark',
        center: [0.122, -0.06, 0],
        size: [0.018, 0.1, 0.09],
        round: 0.012,
        blend: 0.01,
      },
      // Épaulières, à la couleur du joueur.
      {
        bone: 'spine',
        shape: 'ellipsoid',
        zone: 'player',
        center: [0, 0.315, 0.2],
        size: [0.08, 0.05, 0.075],
        blend: 0.01,
        mirror: true,
      },
      // Bracelets de fer sur les bras.
      {
        bone: 'upperArmF',
        shape: 'ellipsoid',
        zone: 'light',
        center: [0, -0.06, 0],
        size: [0.06, 0.014, 0.06],
        mirror: true,
      },
      {
        bone: 'upperArmF',
        shape: 'ellipsoid',
        zone: 'light',
        center: [0, -0.125, 0],
        size: [0.056, 0.014, 0.056],
        mirror: true,
      },
      // Gantelets incandescents.
      {
        bone: 'forearmF',
        shape: 'capsule',
        zone: 'accent',
        from: [0, -0.1, 0],
        to: [0, -0.19, 0],
        radius: 0.06,
        radiusTo: 0.064,
        blend: 0.015,
        mirror: true,
      },
      {
        bone: 'handF',
        shape: 'ellipsoid',
        zone: 'accent',
        center: [0.004, -0.036, 0],
        size: [0.052, 0.058, 0.046],
        blend: 0.015,
        mirror: true,
      },
      // Ceinturon, boucle, chaîne qui pend sur le côté.
      {
        bone: 'hips',
        shape: 'ellipsoid',
        zone: 'dark',
        center: [0, 0.05, 0],
        size: [0.134, 0.03, 0.16],
      },
      {
        bone: 'hips',
        shape: 'box',
        zone: 'light',
        center: [0.138, 0.05, 0],
        size: [0.012, 0.026, 0.032],
        round: 0.006,
      },
      {
        bone: 'skirt',
        frame: 'hips',
        shape: 'ellipsoid',
        zone: 'light',
        center: [0.02, 0, 0.155],
        size: [0.012, 0.016, 0.012],
      },
      {
        bone: 'skirt',
        frame: 'hips',
        shape: 'ellipsoid',
        zone: 'light',
        center: [0.012, -0.035, 0.158],
        size: [0.012, 0.016, 0.012],
      },
      {
        bone: 'skirt',
        frame: 'hips',
        shape: 'ellipsoid',
        zone: 'light',
        center: [0.004, -0.07, 0.155],
        size: [0.012, 0.016, 0.012],
      },
      // Bottes.
      {
        bone: 'shinF',
        shape: 'capsule',
        zone: 'dark',
        from: [0, -0.13, 0],
        to: [0, -0.2, 0],
        radius: 0.07,
        radiusTo: 0.066,
        blend: 0.012,
        mirror: true,
      },
    ],
  },
});
