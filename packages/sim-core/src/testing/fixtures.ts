/**
 * Contenu minimal pour tester la simulation sans dépendre des modules `fighters` et
 * `stages-items`. Les valeurs sont choisies pour rendre les scénarios lisibles, pas pour
 * l'équilibrage.
 */
import type { CancelDef, EntityDef, FighterDef, HitDef, MoveDef, StageDef } from '../defs.ts';
import { ENTITY_BOUNCE, ENTITY_DESTROY } from '../systems/entities.ts';
import { fx } from '../fixed.ts';
import {
  MOVE_SLOTS,
  M_BAIR,
  M_DAIR,
  M_DASH_ATTACK,
  M_DSMASH,
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
  M_UAIR,
  M_USMASH,
  M_UTILT,
} from '../moves.ts';
import type { SimConfig } from '../step.ts';

interface HitSpec {
  frames: [start: number, end: number];
  /** Cercle [x, y, rayon] ou capsule [x1, y1, x2, y2, rayon], en unités de jeu. */
  shape: [number, number, number] | [number, number, number, number, number];
  damage: number;
  angle: number;
  base: number;
  growth: number;
  group?: number;
}

function hit(spec: HitSpec): HitDef {
  const sh = spec.shape;
  const capsule = sh.length === 5 ? sh : ([sh[0], sh[1], sh[0], sh[1], sh[2]] as const);
  return {
    start: spec.frames[0],
    end: spec.frames[1],
    group: spec.group ?? 0,
    x1: fx(capsule[0]),
    y1: fx(capsule[1]),
    x2: fx(capsule[2]),
    y2: fx(capsule[3]),
    radius: fx(capsule[4]),
    damage: fx(spec.damage),
    angle: spec.angle,
    baseKnockback: fx(spec.base),
    knockbackGrowth: fx(spec.growth),
  };
}

function move(
  name: string,
  totalFrames: number,
  hits: HitSpec[],
  extra: Partial<Pick<MoveDef, 'charge' | 'landingLag' | 'spawn'>> & {
    cancels?: CancelDef[];
  } = {},
): MoveDef {
  return { name, totalFrames, hits: hits.map(hit), cancels: [], ...extra };
}

function moveset(entries: [slot: number, def: MoveDef][]): (MoveDef | undefined)[] {
  const moves: (MoveDef | undefined)[] = new Array(MOVE_SLOTS).fill(undefined);
  for (const [slot, def] of entries) moves[slot] = def;
  return moves;
}

const SMASH_CHARGE = { frame: 5, maxFrames: 60, maxScale: fx(1.4) };

/** Type 1 : tir rectiligne, détruit au premier contact. */
export const E_SHOT = 1;
/** Type 2 : balle pesante qui rebondit et traverse les combattants en les frappant une fois. */
export const E_BALL = 2;

export const TEST_ENTITIES: EntityDef[] = [
  {
    name: 'shot',
    radius: fx(1.5),
    gravity: fx(0),
    lifetime: 60,
    stageCollision: ENTITY_DESTROY,
    hit: { damage: fx(5), angle: 30, baseKnockback: fx(10), knockbackGrowth: fx(0.3) },
    destroyOnHit: true,
  },
  {
    name: 'ball',
    radius: fx(2),
    gravity: fx(0.09),
    lifetime: 300,
    stageCollision: ENTITY_BOUNCE,
    hit: { damage: fx(8), angle: 60, baseKnockback: fx(20), knockbackGrowth: fx(0.8) },
    destroyOnHit: false,
  },
];

const TEST_MOVES = moveset([
  [
    M_NSPECIAL,
    move('shot', 40, [], {
      spawn: { frame: 12, kind: E_SHOT, x: fx(6), y: fx(7), velX: fx(2.5), velY: fx(0) },
    }),
  ],
  [
    M_LEDGE_ATTACK,
    move('ledge attack', 40, [
      { frames: [20, 23], shape: [5, 5, 4], damage: 9, angle: 45, base: 40, growth: 0.5 },
    ]),
  ],
  [
    M_JAB,
    move(
      'jab',
      16,
      [{ frames: [3, 4], shape: [6, 7, 2.5], damage: 3, angle: 70, base: 8, growth: 0.3 }],
      {
        cancels: [{ start: 6, end: 16, on: M_JAB, to: M_JAB2, requiresHit: false }],
      },
    ),
  ],
  [
    M_JAB2,
    move(
      'jab2',
      20,
      [{ frames: [3, 5], shape: [6, 7, 2.5], damage: 4, angle: 70, base: 8, growth: 0.3 }],
      {
        cancels: [{ start: 7, end: 20, on: M_JAB, to: M_JAB3, requiresHit: true }],
      },
    ),
  ],
  [
    M_JAB3,
    move('jab3', 30, [
      { frames: [5, 7], shape: [7, 7, 3], damage: 6, angle: 45, base: 30, growth: 0.8 },
    ]),
  ],
  [
    // Deux hitbox : la première (pointe intérieure) est prioritaire et plus forte.
    M_FTILT,
    move('ftilt', 28, [
      { frames: [6, 8], shape: [5, 7, 2], damage: 12, angle: 40, base: 15, growth: 0.9 },
      { frames: [6, 8], shape: [5, 7, 11, 7, 2.5], damage: 9, angle: 40, base: 15, growth: 0.9 },
    ]),
  ],
  [
    M_UTILT,
    move('utilt', 26, [
      { frames: [5, 9], shape: [0, 14, 4], damage: 7, angle: 90, base: 20, growth: 0.8 },
    ]),
  ],
  [
    M_DTILT,
    move('dtilt', 22, [
      { frames: [5, 7], shape: [3, 1, 9, 1, 2], damage: 6, angle: 75, base: 18, growth: 0.6 },
    ]),
  ],
  [
    M_DASH_ATTACK,
    move('dash attack', 36, [
      { frames: [6, 12], shape: [5, 6, 3.5], damage: 8, angle: 55, base: 30, growth: 0.7 },
    ]),
  ],
  [
    M_FSMASH,
    move(
      'fsmash',
      44,
      [{ frames: [12, 14], shape: [4, 6, 10, 6, 2], damage: 16, angle: 40, base: 25, growth: 1.1 }],
      { charge: SMASH_CHARGE },
    ),
  ],
  [
    M_USMASH,
    move(
      'usmash',
      46,
      [
        {
          frames: [10, 14],
          shape: [0, 10, 0, 18, 3.5],
          damage: 15,
          angle: 88,
          base: 28,
          growth: 1.05,
        },
      ],
      { charge: SMASH_CHARGE },
    ),
  ],
  [
    // Coup double : un premier coup faible qui laisse la victime sur place, puis le coup fort.
    M_DSMASH,
    move(
      'dsmash',
      48,
      [
        {
          frames: [6, 8],
          shape: [-8, 2, 8, 2, 2.5],
          damage: 5,
          angle: 0,
          base: 1,
          growth: 0,
          group: 0,
        },
        {
          frames: [14, 16],
          shape: [-8, 2, 8, 2, 2.5],
          damage: 8,
          angle: 30,
          base: 30,
          growth: 1,
          group: 1,
        },
      ],
      { charge: SMASH_CHARGE },
    ),
  ],
  [
    M_NAIR,
    move(
      'nair',
      34,
      [{ frames: [4, 20], shape: [0, 6, 5], damage: 7, angle: 50, base: 15, growth: 0.8 }],
      {
        landingLag: 6,
      },
    ),
  ],
  [
    M_FAIR,
    move(
      'fair',
      38,
      [{ frames: [8, 11], shape: [6, 7, 3.5], damage: 10, angle: 45, base: 20, growth: 1 }],
      {
        landingLag: 10,
      },
    ),
  ],
  [
    M_BAIR,
    move(
      'bair',
      34,
      [{ frames: [7, 10], shape: [-7, 7, 3.5], damage: 11, angle: 140, base: 20, growth: 1 }],
      {
        landingLag: 9,
      },
    ),
  ],
  [
    M_UAIR,
    move(
      'uair',
      30,
      [{ frames: [5, 9], shape: [0, 14, 4], damage: 8, angle: 80, base: 18, growth: 0.9 }],
      {
        landingLag: 7,
      },
    ),
  ],
  [
    // Coup triple vers le bas.
    M_DAIR,
    move(
      'dair',
      40,
      [
        {
          frames: [5, 6],
          shape: [0, 0, 0, -4, 4],
          damage: 2,
          angle: 270,
          base: 2,
          growth: 0,
          group: 0,
        },
        {
          frames: [9, 10],
          shape: [0, 0, 0, -4, 4],
          damage: 2,
          angle: 270,
          base: 2,
          growth: 0,
          group: 1,
        },
        {
          frames: [13, 14],
          shape: [0, 0, 0, -4, 4],
          damage: 4,
          angle: 280,
          base: 25,
          growth: 0.9,
          group: 2,
        },
      ],
      { landingLag: 14 },
    ),
  ],
]);

export const TEST_FIGHTER: FighterDef = {
  name: 'test',
  weight: fx(100),
  hurtboxes: [{ x1: fx(0), y1: fx(3), x2: fx(0), y2: fx(9), radius: fx(3) }],
  moves: TEST_MOVES,
  techFrames: 20,
  downFrames: 30,
  shieldMax: fx(50),
  spotDodge: { totalFrames: 26, invStart: 3, invEnd: 17, speed: fx(0) },
  roll: { totalFrames: 30, invStart: 4, invEnd: 15, speed: fx(1.6) },
  airDodge: { totalFrames: 40, invStart: 3, invEnd: 29, speed: fx(2.2) },
  airDodgeLandingLag: 10,
  ledgeGetupFrames: 30,
  ledgeRollFrames: 40,
  ledgeRollDistance: fx(20),
  grab: {
    totalFrames: 34,
    start: 6,
    end: 8,
    box: { x1: fx(3), y1: fx(7), x2: fx(9), y2: fx(7), radius: fx(2.5) },
    holdX: fx(6),
    pummelDamage: fx(1.3),
    pummelFrames: 18,
  },
  throws: [
    {
      totalFrames: 30,
      releaseFrame: 12,
      damage: fx(8),
      angle: 45,
      baseKnockback: fx(45),
      knockbackGrowth: fx(0.6),
    },
    {
      totalFrames: 34,
      releaseFrame: 16,
      damage: fx(10),
      angle: 135,
      baseKnockback: fx(50),
      knockbackGrowth: fx(0.7),
    },
    {
      totalFrames: 30,
      releaseFrame: 10,
      damage: fx(7),
      angle: 90,
      baseKnockback: fx(50),
      knockbackGrowth: fx(0.6),
    },
    {
      totalFrames: 32,
      releaseFrame: 14,
      damage: fx(6),
      angle: 75,
      baseKnockback: fx(35),
      knockbackGrowth: fx(0.4),
    },
  ],
  halfWidth: fx(3),
  height: fx(12),
  walkSpeed: fx(1.1),
  walkAccel: fx(0.1),
  friction: fx(0.1),
  dashSpeed: fx(1.9),
  dashFrames: 11,
  runSpeed: fx(1.7),
  runAccel: fx(0.1),
  brakeFrames: 8,
  turnFrames: 6,
  jumpSquatFrames: 3,
  jumpVelocity: fx(2.5),
  shortHopVelocity: fx(1.6),
  doubleJumpVelocity: fx(2.4),
  airJumps: 1,
  airSpeed: fx(1.2),
  airAccel: fx(0.07),
  airFriction: fx(0.015),
  gravity: fx(0.09),
  maxFallSpeed: fx(1.6),
  fastFallSpeed: fx(2.56),
  landFrames: 2,
};

/**
 * Second combattant, volontairement très différent : lourd, lent, deux sauts aériens, un jab
 * sans suite. Il sert à vérifier que rien dans le moteur ne suppose les valeurs du premier.
 */
export const TEST_HEAVY: FighterDef = {
  ...TEST_FIGHTER,
  name: 'heavy',
  weight: fx(130),
  hurtboxes: [{ x1: fx(0), y1: fx(5), x2: fx(0), y2: fx(13), radius: fx(5) }],
  moves: moveset([
    [
      M_JAB,
      move('heavy jab', 30, [
        { frames: [9, 12], shape: [8, 9, 4], damage: 9, angle: 50, base: 25, growth: 0.9 },
      ]),
    ],
    [
      M_FSMASH,
      move(
        'heavy fsmash',
        70,
        [
          {
            frames: [24, 27],
            shape: [6, 8, 14, 8, 4],
            damage: 24,
            angle: 40,
            base: 35,
            growth: 1.2,
          },
        ],
        { charge: { frame: 10, maxFrames: 90, maxScale: fx(1.5) } },
      ),
    ],
  ]),
  halfWidth: fx(5),
  height: fx(18),
  walkSpeed: fx(0.7),
  dashSpeed: fx(1.4),
  dashFrames: 16,
  runSpeed: fx(1.3),
  jumpSquatFrames: 6,
  jumpVelocity: fx(2.2),
  shortHopVelocity: fx(1.4),
  airJumps: 2,
  airSpeed: fx(0.9),
  gravity: fx(0.12),
  maxFallSpeed: fx(1.9),
  landFrames: 4,
};

/**
 * Bloc principal de x = -60 à 60, dessus en y = 0 ; deux plateformes latérales en y = 20,
 * une plateforme centrale en y = 40.
 */
export const TEST_STAGE: StageDef = {
  name: 'test',
  spawns: [-35, 35, -15, 15, -55, 55, -25, 25].map((x) => ({ x: fx(x), y: fx(0) })),
  solids: [{ x1: fx(-60), y1: fx(-20), x2: fx(60), y2: fx(0) }],
  platforms: [
    { x1: fx(-40), x2: fx(-15), y: fx(20) },
    { x1: fx(15), x2: fx(40), y: fx(20) },
    { x1: fx(-12), x2: fx(12), y: fx(40) },
  ],
  blast: { left: fx(-150), right: fx(150), top: fx(120), bottom: fx(-80) },
};

export function testConfig(players: number, seed = 1): SimConfig {
  return {
    stage: TEST_STAGE,
    fighters: Array.from({ length: players }, () => TEST_FIGHTER),
    entities: TEST_ENTITIES,
    seed,
  };
}
