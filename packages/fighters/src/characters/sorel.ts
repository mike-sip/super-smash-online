/**
 * Sorel — polyvalent, personnage de référence.
 *
 * Messager des vents : arts martiaux mêlés de rafales. Tout fait correctement, punit bien, sans
 * point faible marqué. Ses valeurs servent d'étalon aux trois autres personnages.
 *
 * Unités : distances en unités de jeu (Sorel mesure 12), vitesses par frame, durées en frames.
 */
import {
  ENTITY_DESTROY,
  M_BAIR,
  M_DAIR,
  M_DASH_ATTACK,
  M_DSMASH,
  M_DSPECIAL,
  M_DTILT,
  M_EXTRA1,
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
import { STANDARD_BUILD, defineCharacter, type Character } from '../character.ts';

/** Projectile 1 : trait de vent, droit, détruit au premier contact. */
const WIND_DART = 1;

const ENTITIES: EntityDef[] = [
  {
    name: 'Trait de vent',
    radius: fx(1.8),
    gravity: fx(0),
    // 27 frames à 2,2 : 59 unités. Seuls les projectiles du zoneur portent au-delà de 60.
    lifetime: 27,
    stageCollision: ENTITY_DESTROY,
    hit: { damage: fx(6), angle: 35, baseKnockback: fx(14), knockbackGrowth: fx(0.4) },
    destroyOnHit: true,
  },
];

const SMASH_CHARGE = { maxFrames: 60, maxScale: 1.4 };

const MOVES = moveset([
  // --- Normaux ---
  [
    M_JAB,
    move(
      'Coup sec',
      18,
      [{ frames: [3, 4], shape: [6, 7.5, 2.5], damage: 2.5, angle: 75, base: 6, growth: 0.25 }],
      { cancels: [{ start: 6, end: 18, on: M_JAB, to: M_JAB2, requiresHit: false }] },
    ),
  ],
  [
    M_JAB2,
    move(
      'Revers',
      20,
      [{ frames: [3, 4], shape: [6.5, 7.5, 2.5], damage: 2.5, angle: 75, base: 6, growth: 0.25 }],
      { cancels: [{ start: 7, end: 20, on: M_JAB, to: M_JAB3, requiresHit: false }] },
    ),
  ],
  [
    M_JAB3,
    move('Rafale du pied', 30, [
      { frames: [5, 7], shape: [3, 4, 8.5, 5, 3], damage: 5, angle: 40, base: 32, growth: 0.85 },
    ]),
  ],
  [
    // La pointe du pied est plus forte que le genou.
    M_FTILT,
    move('Pied fouetté', 26, [
      { frames: [6, 8], shape: [10, 7.5, 2.5], damage: 10, angle: 38, base: 12, growth: 0.95 },
      { frames: [6, 8], shape: [4, 7, 9, 7, 2.5], damage: 8, angle: 38, base: 12, growth: 0.95 },
    ]),
  ],
  [
    M_UTILT,
    move('Arc ascendant', 28, [
      {
        frames: [5, 10],
        shape: [3, 10, -3, 13, 3.5],
        damage: 7,
        angle: 95,
        base: 22,
        growth: 0.85,
      },
    ]),
  ],
  [
    M_DTILT,
    move('Balayage', 20, [
      { frames: [5, 7], shape: [3, 1, 10, 1, 2], damage: 6, angle: 80, base: 20, growth: 0.55 },
    ]),
  ],
  [
    M_DASH_ATTACK,
    move(
      'Élan d’épaule',
      34,
      [{ frames: [6, 10], shape: [5, 6, 3.5], damage: 9, angle: 50, base: 32, growth: 0.7 }],
      { motion: [{ start: 1, end: 8, velX: 1.4 }] },
    ),
  ],

  // --- Smash ---
  [
    M_FSMASH,
    move(
      'Poing-rafale',
      46,
      [
        {
          frames: [14, 16],
          shape: [5, 7, 12, 7, 2.5],
          damage: 16,
          angle: 38,
          base: 28,
          growth: 1.05,
        },
      ],
      { charge: { frame: 6, ...SMASH_CHARGE } },
    ),
  ],
  [
    M_USMASH,
    move(
      'Colonne de vent',
      44,
      [
        {
          frames: [11, 15],
          shape: [0, 11, 0, 19, 3.5],
          damage: 15,
          angle: 88,
          base: 30,
          growth: 1,
        },
      ],
      { charge: { frame: 5, ...SMASH_CHARGE } },
    ),
  ],
  [
    // Devant puis derrière.
    M_DSMASH,
    move(
      'Double balayage',
      48,
      [
        {
          frames: [7, 8],
          shape: [3, 1.5, 10, 1.5, 2.5],
          damage: 13,
          angle: 30,
          base: 25,
          growth: 1,
          group: 0,
        },
        {
          frames: [15, 16],
          shape: [-3, 1.5, -10, 1.5, 2.5],
          damage: 14,
          angle: 150,
          base: 26,
          growth: 1,
          group: 1,
        },
      ],
      { charge: { frame: 4, ...SMASH_CHARGE } },
    ),
  ],

  // --- Aériennes ---
  [
    // Forte au début, plus faible ensuite : un seul coup par cible.
    M_NAIR,
    move(
      'Toupie',
      36,
      [
        { frames: [4, 6], shape: [0, 6, 5.5], damage: 9, angle: 45, base: 18, growth: 0.85 },
        { frames: [7, 20], shape: [0, 6, 5], damage: 5, angle: 45, base: 12, growth: 0.7 },
      ],
      { landingLag: 7 },
    ),
  ],
  [
    M_FAIR,
    move(
      'Coup de taille',
      38,
      [{ frames: [9, 12], shape: [4, 8, 9, 6, 3], damage: 11, angle: 42, base: 22, growth: 0.95 }],
      { landingLag: 11 },
    ),
  ],
  [
    M_BAIR,
    move(
      'Ruade',
      34,
      [{ frames: [7, 10], shape: [-4, 6, -9, 6, 3], damage: 12, angle: 140, base: 22, growth: 1 }],
      { landingLag: 10 },
    ),
  ],
  [
    M_UAIR,
    move(
      'Ciseau',
      32,
      [
        {
          frames: [5, 9],
          shape: [-3, 13, 4, 14, 3.5],
          damage: 8,
          angle: 85,
          base: 20,
          growth: 0.9,
        },
      ],
      { landingLag: 8 },
    ),
  ],
  [
    // Talon plongeant : vers le bas au début, plus faible ensuite.
    M_DAIR,
    move(
      'Pique du talon',
      40,
      [
        {
          frames: [12, 14],
          shape: [0, 0, 1, -3, 3.5],
          damage: 13,
          angle: 275,
          base: 20,
          growth: 0.9,
        },
        { frames: [15, 20], shape: [0, 0, 1, -3, 3], damage: 9, angle: 60, base: 15, growth: 0.8 },
      ],
      { landingLag: 16 },
    ),
  ],

  // --- Spéciaux ---
  [
    M_NSPECIAL,
    move('Trait de vent', 42, [], {
      spawn: { frame: 13, kind: WIND_DART, x: 6, y: 7.5, velX: 2.2, velY: 0 },
    }),
  ],
  [
    // Fente vers l'avant. En l'air, la gravité continue d'agir : pas de vol plané.
    M_SSPECIAL,
    move(
      'Ruée',
      38,
      [{ frames: [12, 16], shape: [4, 6.5, 3.5], damage: 10, angle: 40, base: 35, growth: 0.7 }],
      { motion: [{ start: 6, end: 15, velX: 2.1 }], landingLag: 18 },
    ),
  ],
  [
    // Ascension en tourbillon : trois coups qui retiennent, un dernier qui éjecte.
    M_USPECIAL,
    move(
      'Spirale',
      40,
      [
        { frames: [5, 8], shape: [0, 7, 5], damage: 3, angle: 85, base: 30, growth: 0, group: 0 },
        { frames: [10, 13], shape: [0, 7, 5], damage: 3, angle: 85, base: 30, growth: 0, group: 1 },
        { frames: [15, 18], shape: [0, 7, 5], damage: 3, angle: 85, base: 30, growth: 0, group: 2 },
        {
          frames: [21, 24],
          shape: [0, 9, 5.5],
          damage: 5,
          angle: 70,
          base: 45,
          growth: 0.8,
          group: 3,
        },
      ],
      {
        intangible: [1, 4],
        motion: [
          { start: 5, end: 18, velY: 2 },
          { start: 19, end: 22, velY: 0.8 },
        ],
        helpless: true,
        landingLag: 20,
      },
    ),
  ],
  [M_DSPECIAL, move('Contre', 44, [], { counter: { start: 5, end: 24, to: M_EXTRA1 } })],
  [
    M_EXTRA1,
    move(
      'Riposte du vent',
      32,
      [{ frames: [4, 7], shape: [3, 7, 9, 7, 4], damage: 12, angle: 40, base: 45, growth: 0.85 }],
      { intangible: [1, 6] },
    ),
  ],

  // --- Ultime ---
  [
    // Tourbillon autour de lui : trois coups qui retiennent, puis l'éjection.
    M_ULTIMATE,
    move(
      'Tempête',
      90,
      [
        {
          frames: [12, 14],
          shape: [0, 8, 16],
          damage: 4,
          angle: 85,
          base: 40,
          growth: 0,
          group: 0,
        },
        {
          frames: [24, 26],
          shape: [0, 8, 16],
          damage: 4,
          angle: 85,
          base: 40,
          growth: 0,
          group: 1,
        },
        {
          frames: [36, 38],
          shape: [0, 8, 16],
          damage: 4,
          angle: 85,
          base: 40,
          growth: 0,
          group: 2,
        },
        {
          frames: [54, 58],
          shape: [0, 8, 18],
          damage: 20,
          angle: 50,
          base: 90,
          growth: 1,
          group: 3,
        },
      ],
      { intangible: [1, 90] },
    ),
  ],

  // --- Rebord ---
  [
    M_LEDGE_ATTACK,
    move(
      'Remontée tournoyante',
      40,
      [{ frames: [20, 23], shape: [3, 4, 9, 4, 3], damage: 9, angle: 45, base: 40, growth: 0.5 }],
      { intangible: [1, 18] },
    ),
  ],
]);

const DEF: FighterDef = {
  name: 'Sorel',
  weight: fx(100),
  height: fx(12),
  halfWidth: fx(3),
  hurtboxes: [capsule([0, 3, 0, 8.5, 3]), capsule([0.5, 10, 2])],
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
    totalFrames: 34,
    start: 7,
    end: 8,
    box: capsule([3, 7, 9, 7, 2.5]),
    holdX: fx(6),
    pummelDamage: fx(1.3),
    pummelFrames: 18,
  },
  throws: [
    throwDef({ total: 30, release: 12, damage: 8, angle: 45, base: 50, growth: 0.6 }),
    throwDef({ total: 34, release: 16, damage: 10, angle: 135, base: 55, growth: 0.7 }),
    throwDef({ total: 30, release: 10, damage: 7, angle: 90, base: 55, growth: 0.65 }),
    throwDef({ total: 32, release: 14, damage: 6, angle: 75, base: 40, growth: 0.4 }),
  ],
  walkSpeed: fx(1.1),
  walkAccel: fx(0.1),
  friction: fx(0.1),
  dashSpeed: fx(1.95),
  dashFrames: 11,
  runSpeed: fx(1.75),
  runAccel: fx(0.1),
  brakeFrames: 8,
  turnFrames: 6,
  jumpSquatFrames: 3,
  jumpVelocity: fx(2.5),
  shortHopVelocity: fx(1.6),
  doubleJumpVelocity: fx(2.45),
  airJumps: 1,
  airSpeed: fx(1.15),
  airAccel: fx(0.07),
  airFriction: fx(0.015),
  gravity: fx(0.09),
  maxFallSpeed: fx(1.65),
  fastFallSpeed: fx(2.6),
  landFrames: 2,
};

export const SOREL: Character = defineCharacter({
  id: 'sorel',
  name: 'Sorel',
  archetype: 'polyvalent',
  def: DEF,
  entities: ENTITIES,
  look: {
    primary: 0x5aa9e6,
    secondary: 0xf1f5f9,
    build: STANDARD_BUILD,
    parts: [
      // Bandeau autour du front, à la couleur du joueur.
      {
        anchor: 'head',
        x: 0,
        y: 0.03,
        z: 0,
        width: 0.215,
        height: 0.05,
        depth: 0.215,
        angle: 0,
        color: 'player',
      },
      // Ses deux pans flottent derrière la tête.
      {
        anchor: 'head',
        x: -0.15,
        y: 0.01,
        z: 0.03,
        width: 0.14,
        height: 0.035,
        depth: 0.025,
        angle: -0.5,
        color: 'player',
        mirror: true,
      },
    ],
    // Figurine : moine-voyageur svelte. Bandeau à deux longs pans, chignon, tunique ceinturée qui
    // descend sur les cuisses, bandes aux avant-bras, lanières de sandales. Tête de rayon 0,1.
    palette: { skin: 0xe6b38c, hair: 0x1e2433, accent: 0xe8b44a, light: 0xf3e7d3 },
    vfx: 'wind',
    palettes: [
      {},
      { primary: 0xc8423b, secondary: 0xf5ede0, accent: 0xe8c35a },
      { primary: 0x3f8f5a, secondary: 0xeef3e8, accent: 0xd9b45a, hair: 0x3b2a1a },
      { primary: 0x6b4fb3, secondary: 0xe9e4f5, accent: 0xc0c8d8 },
      { primary: 0xd9a35a, secondary: 0x5a3b28, accent: 0x2f4a6b, hair: 0x7a4a2a },
      { primary: 0x2b2f3a, secondary: 0xd9dee8, accent: 0xc8423b, hair: 0xe8e2d0 },
      { primary: 0xe58aa8, secondary: 0xfff4f6, accent: 0x9a7ad6, hair: 0x4a2a3a },
      { primary: 0xeef4fa, secondary: 0x5aa9e6, accent: 0x5aa9e6, skin: 0xb07a55 },
    ],
    sculpt: [
      // Bandeau et nœud, à la couleur du joueur ; deux pans qui partent en arrière.
      {
        bone: 'head',
        shape: 'ellipsoid',
        zone: 'player',
        center: [0.004, 0.122, 0],
        size: [0.101, 0.016, 0.094],
      },
      {
        bone: 'head',
        shape: 'ellipsoid',
        zone: 'player',
        center: [-0.098, 0.12, 0],
        size: [0.022, 0.024, 0.03],
      },
      {
        bone: 'tail1',
        frame: 'head',
        shape: 'capsule',
        zone: 'player',
        from: [-0.1, 0.118, 0.018],
        to: [-0.16, 0.094, 0.034],
        radius: 0.013,
        radiusTo: 0.011,
        mirror: true,
      },
      {
        bone: 'tail2',
        frame: 'head',
        shape: 'capsule',
        zone: 'player',
        from: [-0.16, 0.094, 0.034],
        to: [-0.22, 0.07, 0.05],
        radius: 0.011,
        radiusTo: 0.008,
        blend: 0.004,
        mirror: true,
      },
      // Chignon haut sur la nuque.
      {
        bone: 'head',
        shape: 'ellipsoid',
        zone: 'hair',
        center: [-0.05, 0.2, 0],
        size: [0.04, 0.034, 0.038],
        blend: 0.012,
      },
      // Tunique : jupe évasée sur les cuisses, encolure croisée claire.
      {
        bone: 'skirt',
        frame: 'hips',
        shape: 'capsule',
        zone: 'primary',
        from: [0, 0.06, 0],
        to: [0, -0.09, 0],
        radius: 0.082,
        radiusTo: 0.104,
        blend: 0.025,
      },
      {
        bone: 'spine',
        shape: 'box',
        zone: 'light',
        center: [0.074, 0.27, 0.018],
        size: [0.008, 0.07, 0.016],
        rotation: 0.35,
        round: 0.006,
        blend: 0.006,
      },
      {
        bone: 'spine',
        shape: 'box',
        zone: 'light',
        center: [0.074, 0.27, -0.018],
        size: [0.008, 0.07, 0.016],
        rotation: -0.35,
        round: 0.006,
        blend: 0.006,
      },
      // Ceinture dorée et pan qui pend devant.
      {
        bone: 'hips',
        shape: 'ellipsoid',
        zone: 'accent',
        center: [0, 0.06, 0],
        size: [0.088, 0.022, 0.1],
      },
      {
        bone: 'skirt',
        frame: 'hips',
        shape: 'capsule',
        zone: 'accent',
        from: [0.07, 0.05, 0.05],
        to: [0.09, -0.07, 0.065],
        radius: 0.012,
        radiusTo: 0.009,
      },
      // Bandes claires aux avant-bras.
      {
        bone: 'forearmF',
        shape: 'capsule',
        zone: 'light',
        from: [0, -0.03, 0],
        to: [0, -0.13, 0],
        radius: 0.036,
        radiusTo: 0.031,
        mirror: true,
      },
      // Lanières de sandales au-dessus de la cheville.
      {
        bone: 'shinF',
        shape: 'ellipsoid',
        zone: 'accent',
        center: [0, -0.19, 0],
        size: [0.04, 0.011, 0.04],
        mirror: true,
      },
    ],
  },
});
