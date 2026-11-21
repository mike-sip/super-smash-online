/**
 * Nacre — animations écrites à la main, d'après sa bible (`assets/fighters/nacre/DESIGN.md`) :
 * gracieuse, ample, ondoyante ; le bâton de corail recule ou se lève d'abord, frappe en arc,
 * continue sa course ; la main arrière ouverte lance les perles.
 *
 * Le bâton est sculpté dans la main avant, le long de son axe x. Les clés le règlent par un canal
 * en plus, `staff` : son angle dans le plan du profil (0 : pointe vers l'avant à l'horizontale,
 * π/2 : vers le haut, π : vers l'arrière, −π/2 : vers le bas). L'angle est gardé d'une clé à
 * l'autre et converti en rotation du poignet (`wristF`) d'après le bras et le buste : le bâton
 * garde son cap quand le bras bouge. Repères des autres canaux et des instants : voir `kit.ts`.
 */
import {
  A_AIR,
  A_AIRDODGE,
  A_ATTACK,
  A_BRAKE,
  A_CROUCH,
  A_DASH,
  A_DOWN,
  A_GRAB,
  A_GRABBED,
  A_GRABBING,
  A_GRAB_RELEASE,
  A_HELPLESS,
  A_HITSTUN,
  A_IDLE,
  A_ITEM_THROW,
  A_JUMPSQUAT,
  A_LAND,
  A_LEDGE,
  A_LEDGE_GETUP,
  A_LEDGE_ROLL,
  A_ROLL,
  A_RUN,
  A_SHIELD,
  A_SHIELDSTUN,
  A_SHIELD_BREAK,
  A_SHIELD_DROP,
  A_SPOTDODGE,
  A_TECH,
  A_THROW,
  A_TUMBLE,
  A_TURN,
  A_WALK,
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
} from '@game/sim-core';
import type { Sculpt } from '../../src/fighters/sdf.ts';
import type { CharacterAnimation } from '../bake-character.ts';
import { REST, type ClipDef, type Ease, type Key, type Posture } from '../anim/keys.ts';
import {
  TAU,
  charge,
  cycleLength,
  key,
  loop,
  strikeKit,
  timed,
  windOf,
  type Clip,
  type StrikeParts,
} from './kit.ts';

/** Pose avec l'angle du bâton. */
type NPosture = Posture & { staff?: number };

const k = (at: number | string, pose: NPosture, ease?: Ease): Key => key(at, pose, ease);

const HALF = Math.PI / 2;
const PI = Math.PI;

// --- Poses de référence ------------------------------------------------------------------------

/**
 * Garde : droite et calme, de trois quarts ; le bâton en diagonale, pointe vers l'adversaire ; la
 * main arrière ouverte à hauteur de poitrine.
 */
const GUARD: NPosture = {
  torso: 0.08,
  head: -0.05,
  twist: -0.2,
  hipTwist: -0.1,
  lean: 0,
  tilt: 0.03,
  turn: 0.3,
  armF: 0.55,
  foreF: 1.0,
  spreadF: 0.2,
  handF: 0.95,
  armB: 0.35,
  foreB: 1.9,
  wristB: 0.6,
  spreadB: 0.3,
  handB: 0.05,
  legF: 0.22,
  shinF: -0.25,
  legB: -0.15,
  shinB: -0.2,
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
  spin: 0,
  yaw: 0,
  staff: 0.35,
};

/** Garde en l'air : jambes jointes et pliées, comme une nageuse ; la main arrière ouverte. */
const AIR: NPosture = {
  ...GUARD,
  torso: 0.1,
  head: -0.1,
  armF: 0.9,
  foreF: 0.8,
  armB: 1.2,
  foreB: 0.6,
  spreadB: 0.6,
  wristB: 0.3,
  legF: 0.5,
  shinF: -0.8,
  legB: 0.3,
  shinB: -0.7,
  staff: 0.2,
};

/** Enroulée : le bâton serré le long du corps. */
const TUCK: NPosture = {
  torso: 0.8,
  head: 0.4,
  twist: 0,
  armF: 1.2,
  foreF: 1.9,
  armB: 1.1,
  foreB: 2.0,
  spreadF: 0.2,
  spreadB: 0.2,
  handB: 0.8,
  legF: 1.6,
  shinF: -2.2,
  legB: 1.45,
  shinB: -2.2,
  staff: 1.4,
};

/** Accroupie, genoux joints sous la robe. */
const LOW: NPosture = {
  torso: 0.45,
  head: -0.35,
  legF: 1.2,
  shinF: -2.1,
  legB: 0.6,
  shinB: -2.1,
  armB: 0.8,
  foreB: 1.6,
};

const baseStrike = strikeKit(GUARD, AIR);

interface NStrike extends Omit<StrikeParts, 'wind' | 'hit' | 'hold' | 'follow' | 'ret'> {
  wind: NPosture;
  hit: NPosture;
  hold?: NPosture;
  follow?: NPosture;
  ret?: NPosture;
}

/** Coup type de Nacre : arrivée en arc (`out`) par défaut, suivi plus long que Sorel. */
const strike = (name: string, move: number, p: NStrike): Clip =>
  baseStrike(name, move, { hitEase: 'out', followAt: 'e+6', ...p } as StrikeParts);

// --- Locomotion --------------------------------------------------------------------------------

/** Marche : petits pas glissés sous la robe (±0,32 rad), hanches qui ondulent. */
const WALK_SWING = 0.32;
const walkPose = (side: 1 | -1): NPosture => ({
  torso: 0.05,
  head: -0.04,
  twist: -0.16 + 0.06 * side,
  hipTwist: 0.12 * side,
  lean: 0.03 * side,
  turn: 0.25,
  legF: WALK_SWING * side,
  shinF: side > 0 ? -0.1 : -0.35,
  legB: -WALK_SWING * side,
  shinB: side > 0 ? -0.35 : -0.1,
  armF: 0.5,
  foreF: 1.0,
  armB: 0.35 + 0.1 * side,
  foreB: 1.6,
  staff: 0.4,
});
const walkPass = (side: 1 | -1): NPosture => ({
  legF: side > 0 ? -0.05 : 0.2,
  shinF: side > 0 ? -0.15 : -0.7,
  legB: side > 0 ? 0.2 : -0.05,
  shinB: side > 0 ? -0.7 : -0.15,
  hipTwist: 0,
  lean: 0,
  staff: 0.33,
});

/** Course : grandes foulées souples (±0,75 rad), le bâton tenu en arrière, pointe qui traîne. */
const RUN_SWING = 0.75;
const runPose = (side: 1 | -1): NPosture => ({
  torso: 0.38,
  head: -0.3,
  twist: -0.15 * side,
  hipTwist: 0.12 * side,
  turn: 0.15,
  legF: side > 0 ? RUN_SWING : -0.65,
  shinF: side > 0 ? -0.3 : -1.4,
  legB: side > 0 ? -0.65 : RUN_SWING,
  shinB: side > 0 ? -1.4 : -0.3,
  armF: -0.5,
  foreF: 0.4,
  spreadF: 0.3,
  armB: side > 0 ? 1.5 : 0.6,
  foreB: 1.2,
  spreadB: 0.35,
  staff: PI - 0.25,
});
const runPass = (side: 1 | -1): NPosture => ({
  legF: side > 0 ? 0.0 : 0.45,
  shinF: side > 0 ? -0.6 : -1.8,
  legB: side > 0 ? 0.45 : 0.0,
  shinB: side > 0 ? -1.8 : -0.6,
  armB: 1.05,
  twist: 0,
  hipTwist: 0,
  staff: PI - 0.2,
});

const LOCOMOTION: Clip[] = [
  // Repos : elle ondule comme une algue dans le courant, la pointe du bâton monte et descend.
  loop('idle', A_IDLE, 140, [
    k(0, { ...GUARD }),
    k(35, { torso: 0.11, lean: 0.05, tilt: 0.08, armB: 0.42, wristB: 0.75, staff: 0.42 }),
    k(70, { torso: 0.06, lean: 0, tilt: 0.02, armB: 0.32, wristB: 0.55, staff: 0.3, turn: 0.38 }),
    k(105, { torso: 0.1, lean: -0.05, tilt: -0.04, armB: 0.4, wristB: 0.7, staff: 0.38 }),
  ]),
  loop(
    'walk',
    A_WALK,
    50,
    [k(0, walkPose(1)), k(12.5, walkPass(1)), k(25, walkPose(-1)), k(37.5, walkPass(-1))],
    { vel: [0.6, 0] },
  ),
  loop(
    'run',
    A_RUN,
    28,
    [k(0, runPose(1)), k(7, runPass(1)), k(14, runPose(-1)), k(21, runPass(-1))],
    { vel: [1.5, 0] },
  ),
  // Départ de course : elle s'élance, le bâton passe derrière elle.
  timed(
    'dash',
    A_DASH,
    [
      k(0, { ...GUARD }),
      k('t*0.35', { ...runPose(1), torso: 0.5, armF: 0.2, staff: 2.2 }, 'out'),
      k('t', runPose(-1), 'inOut'),
    ],
    { vel: [1.75, 0] },
  ),
  // Freinage : elle plante la pointe du bâton derrière elle et pivote dessus.
  timed(
    'brake',
    A_BRAKE,
    [
      k(0, runPose(1)),
      k(
        't*0.45',
        {
          torso: -0.1,
          head: 0.05,
          legF: 0.65,
          shinF: -0.15,
          legB: -0.2,
          shinB: -0.8,
          armF: -0.3,
          foreF: 0.3,
          staff: -PI * 0.7,
          armB: 1.3,
          foreB: 0.8,
          spreadB: 0.5,
        },
        'out',
      ),
      k('t', { ...GUARD }, 'inOut'),
    ],
    { vel: [0.8, 0] },
  ),
  // Demi-tour : une pirouette lente, le bâton balaie l'air au-dessus d'elle.
  timed('turn', A_TURN, [
    k(0, { ...GUARD, yaw: PI }),
    k('t*0.5', { yaw: PI * 0.5, armF: 1.6, staff: HALF + 0.3, torso: 0.0 }, 'inOut'),
    k('t', { ...GUARD, yaw: 0 }, 'inOut'),
  ]),
  loop('crouch', A_CROUCH, 100, [
    k(0, { ...LOW, armF: 0.9, foreF: 0.6, staff: -0.1 }),
    k(50, { torso: 0.5, staff: -0.05 }),
  ]),
  timed('jumpsquat', A_JUMPSQUAT, [
    k(0, { ...GUARD }),
    k('t', { ...LOW, armF: 0.2, foreF: 0.8, armB: -0.2, foreB: 1.0, staff: 0.6 }, 'out'),
  ]),
  // Saut : elle monte comme une bulle, droite, le bâton levé.
  timed(
    'jump',
    A_AIR,
    [
      k(0, {
        torso: -0.05,
        head: -0.25,
        legF: 0.05,
        shinF: -0.05,
        legB: -0.1,
        shinB: -0.1,
        armF: 2.3,
        foreF: 0.3,
        armB: 2.0,
        foreB: 0.5,
        spreadB: 0.4,
        staff: HALF,
      }),
      k(12, { ...AIR, armF: 1.3, staff: 0.6 }, 'out'),
      k(28, { ...AIR }, 'inOut'),
    ],
    { air: true, frames: 28, vel: [0, 1.6] },
  ),
  // Double saut : une vrille lente, le bâton tenu au-dessus de la tête.
  timed(
    'double_jump',
    A_AIR,
    [
      k(0, { ...AIR }),
      k(
        5,
        {
          torso: 0,
          head: -0.2,
          armF: 2.9,
          foreF: 0.1,
          armB: 1.4,
          foreB: 0.4,
          spreadB: 0.8,
          legF: 0.2,
          shinF: -0.3,
          legB: 0.1,
          shinB: -0.4,
          staff: HALF,
          yaw: TAU * 0.2,
        },
        'out',
      ),
      k(18, { yaw: TAU * 0.9 }, 'linear'),
      k(24, { ...AIR, yaw: TAU }, 'out'),
    ],
    { air: true, frames: 24, vel: [0, 1.4] },
  ),
  loop(
    'fall',
    A_AIR,
    80,
    [
      k(0, { ...AIR, armB: 1.5, foreB: 0.4, legF: 0.4, shinF: -0.6 }),
      k(40, { armB: 1.6, armF: 1.0, legF: 0.35, legB: 0.35, shinB: -0.8, staff: 0.3 }),
    ],
    { air: true, vel: [0, -1.1] },
  ),
  // Atterrissage : elle se pose sans bruit, les genoux plient, la robe s'étale.
  timed('land', A_LAND, [
    k(0, { ...LOW, torso: 0.35, armF: 0.9, foreF: 0.5, armB: 1.3, foreB: 0.5, spreadB: 0.6 }),
    k('t', { ...GUARD }, 'settle'),
  ]),
];

// --- Défense, chocs et déplacements spéciaux ---------------------------------------------------

/** Bouclier : le bâton dressé devant elle, la main arrière posée dessus. */
const SHIELD: NPosture = {
  torso: 0.15,
  head: 0.05,
  twist: 0,
  armF: 1.2,
  foreF: 1.2,
  armB: 1.35,
  foreB: 1.3,
  wristB: 0.8,
  handB: 0.6,
  spreadB: -0.1,
  legF: 0.4,
  shinF: -0.6,
  legB: -0.2,
  shinB: -0.4,
  staff: HALF + 0.1,
};

const HANG: NPosture = {
  torso: 0.0,
  head: -0.3,
  armF: 2.9,
  foreF: 0.05,
  armB: 2.95,
  foreB: 0.05,
  handB: 0.9,
  spreadF: 0.15,
  spreadB: 0.1,
  legF: 0.1,
  shinF: -0.2,
  legB: 0.0,
  shinB: -0.15,
  staff: HALF + 0.2,
};

const DEFENSE: Clip[] = [
  loop('shield', A_SHIELD, 80, [k(0, { ...SHIELD }), k(40, { torso: 0.17, staff: HALF + 0.15 })]),
  timed(
    'shieldstun',
    A_SHIELDSTUN,
    [
      k(0, { ...SHIELD, torso: 0.0, offsetX: -0.03, staff: HALF + 0.35 }),
      k('t', { ...SHIELD, offsetX: 0 }, 'settle'),
    ],
    { frames: 12 },
  ),
  timed('shield_drop', A_SHIELD_DROP, [k(0, { ...SHIELD }), k('t', { ...GUARD }, 'inOut')]),
  // Bouclier brisé : étourdie, elle chancelle appuyée sur son bâton.
  timed(
    'shield_break',
    A_SHIELD_BREAK,
    [
      k(0, {
        torso: -0.35,
        head: 0.35,
        armF: 0.9,
        foreF: 0.3,
        armB: 0.6,
        foreB: 0.3,
        spreadB: 0.6,
        handB: 0,
        legF: 0.2,
        shinF: -0.2,
        legB: -0.1,
        shinB: -0.2,
        staff: 1.6,
      }),
      k(
        16,
        {
          torso: 0.3,
          head: 0.45,
          armF: 0.7,
          foreF: 0.5,
          armB: 0.1,
          lean: 0.15,
          tilt: 0.3,
          staff: -1.3,
        },
        'out',
      ),
      k(38, { lean: -0.12, tilt: -0.25, staff: -1.4 }),
      k(60, { lean: 0.1, tilt: 0.2, staff: -1.3 }),
    ],
    { frames: 60 },
  ),
  // Esquive sur place : elle s'efface en tournant vers le fond, voiles en traîne.
  timed('spotdodge', A_SPOTDODGE, [
    k(0, { ...GUARD }),
    k(
      's',
      {
        twist: -1.0,
        hipTwist: -0.6,
        torso: 0.0,
        offsetZ: -0.08,
        armF: 0.2,
        foreF: 1.2,
        armB: 0.9,
        foreB: 0.8,
        turn: 0.6,
        staff: HALF + 0.2,
      },
      'out',
    ),
    k('e', { twist: -0.9, offsetZ: -0.07 }),
    k('t', { ...GUARD }, 'inOut'),
  ]),
  // Roulade : une glissade en tournant sur elle-même, comme emportée par une vague.
  timed(
    'roll',
    A_ROLL,
    [
      k(0, { ...GUARD }),
      k(
        's',
        {
          ...LOW,
          torso: 0.4,
          armF: 0.9,
          foreF: 1.6,
          armB: 1.0,
          foreB: 1.8,
          staff: HALF + 0.1,
          yaw: TAU * 0.25,
          offsetY: -0.05,
        },
        'out',
      ),
      k('e', { yaw: TAU * 0.85 }, 'linear'),
      k('t', { ...GUARD, yaw: TAU, offsetY: 0 }, 'inOut'),
    ],
    { vel: [1.2, 0] },
  ),
  timed(
    'airdodge',
    A_AIRDODGE,
    [
      k(0, { ...AIR }),
      k('s', { ...TUCK, twist: -0.6, offsetZ: -0.1 }, 'out'),
      k('e', { offsetZ: -0.09 }),
      k('t', { ...AIR, offsetZ: 0 }, 'inOut'),
    ],
    { air: true, from: AIR },
  ),
  timed(
    'hitstun',
    A_HITSTUN,
    [
      k(0, {
        torso: -0.5,
        head: 0.5,
        armF: 1.9,
        foreF: 0.4,
        armB: 1.5,
        foreB: 0.4,
        spreadB: 0.7,
        handB: 0,
        legF: 0.6,
        shinF: -0.6,
        legB: 0.2,
        shinB: -0.4,
        tilt: 0.2,
        staff: 2.2,
      }),
      k(7, { torso: -0.3, head: 0.3, staff: 1.8 }, 'out'),
      k(40, { ...AIR, torso: 0.05 }, 'inOut'),
    ],
    { air: true, frames: 40 },
  ),
  loop(
    'tumble',
    A_TUMBLE,
    30,
    [
      k(0, { ...TUCK, torso: 0.3, armF: 2.0, armB: -1.6, legF: 0.9, legB: -0.5, spin: 0 }),
      k(30, { spin: -TAU }, 'linear'),
    ],
    { air: true, vel: [0, -0.6] },
  ),
  timed('tech', A_TECH, [
    k(0, { ...TUCK, offsetY: -0.25, spin: -TAU * 0.25 }),
    k('t*0.6', { ...TUCK, offsetY: -0.08, spin: 0 }, 'out'),
    k('t', { ...GUARD, offsetY: 0 }, 'inOut'),
  ]),
  // Au sol : allongée sur le dos, elle se relève en s'appuyant sur le bâton.
  timed('down', A_DOWN, [
    k(0, {
      spin: -1.45,
      offsetY: -0.42,
      torso: 0.05,
      armF: 1.6,
      foreF: 0.2,
      armB: 2.4,
      legF: 0.25,
      legB: 0.1,
      shinF: -0.3,
      shinB: -0.2,
      staff: 0,
    }),
    k('t*0.6', { spin: -1.4, armB: 2.2 }),
    k('t', { ...LOW, spin: -0.3, offsetY: -0.12, armF: 0.7, staff: -1.2 }, 'out'),
  ]),
  loop(
    'helpless',
    A_HELPLESS,
    48,
    [
      k(0, {
        ...AIR,
        torso: -0.1,
        head: 0.2,
        armF: 2.4,
        armB: 2.5,
        foreF: 0.3,
        foreB: 0.3,
        spreadB: 0.6,
        handB: 0,
        legF: 0.3,
        legB: -0.05,
        staff: 1.2,
      }),
      k(24, { armF: 2.6, armB: 2.3, legF: 0.15, legB: 0.15, tilt: 0.12, staff: 1.4 }),
    ],
    { air: true, vel: [0, -1.3] },
  ),
  // Rebord : suspendue à la main arrière, le bâton crocheté au bord.
  loop('ledge', A_LEDGE, 70, [k(0, { ...HANG }), k(35, { legF: 0.02, legB: 0.08, tilt: 0.05 })], {
    air: true,
  }),
  timed(
    'ledge_getup',
    A_LEDGE_GETUP,
    [
      k(0, { ...HANG, offsetX: -0.25, offsetY: -0.9 }),
      k(
        't*0.4',
        {
          torso: 0.55,
          armF: 1.4,
          armB: 1.3,
          legF: 1.4,
          shinF: -2.1,
          legB: 0.9,
          shinB: -1.8,
          offsetX: -0.15,
          offsetY: -0.25,
          staff: -0.8,
        },
        'out',
      ),
      k('t', { ...GUARD, offsetX: 0, offsetY: 0 }, 'inOut'),
    ],
    { air: true },
  ),
  timed(
    'ledge_roll',
    A_LEDGE_ROLL,
    [
      k(0, { ...HANG, offsetX: -0.6, offsetY: -0.9 }),
      k('t*0.3', { ...TUCK, spin: TAU * 0.3, offsetX: -0.4, offsetY: -0.2 }, 'in'),
      k('t*0.8', { ...TUCK, spin: TAU * 0.9, offsetX: -0.05, offsetY: -0.1 }, 'linear'),
      k('t', { ...GUARD, spin: TAU, offsetX: 0, offsetY: 0 }, 'inOut'),
    ],
    { air: true },
  ),
];

// --- Saisies et projections --------------------------------------------------------------------

/** Prise : la main arrière tient l'adversaire, le bâton dressé à côté. */
const HOLD: NPosture = {
  torso: 0.15,
  head: 0,
  twist: 0.15,
  armF: 0.8,
  foreF: 1.0,
  armB: 1.6,
  foreB: 0.35,
  wristB: 0,
  handB: 0.9,
  legF: 0.3,
  shinF: -0.35,
  legB: -0.2,
  shinB: -0.25,
  staff: 1.25,
};

const GRABS: Clip[] = [
  // Saisie : le bâton crochète, la main arrière attrape.
  timed('grab', A_GRAB, [
    k(0, { ...GUARD }),
    k('s*0.6', { armF: 1.2, foreF: 0.4, staff: 0.6, armB: 0.8, foreB: 1.4, handB: 0.1 }),
    k(
      's',
      {
        ...HOLD,
        torso: 0.35,
        armF: 1.5,
        foreF: 0.1,
        staff: -0.25,
        armB: 1.75,
        foreB: 0.1,
        handB: 0.1,
        legF: 0.6,
        shinF: -0.5,
      },
      'snap',
    ),
    k('e', { handB: 0.9 }),
    k('t', { ...GUARD }, 'inOut'),
  ]),
  loop('grab_hold', A_GRABBING, 50, [k(0, { ...HOLD }), k(25, { torso: 0.18, staff: 1.3 })]),
  loop('grabbed', A_GRABBED, 26, [
    k(0, {
      torso: -0.3,
      head: 0.3,
      armF: 0.5,
      foreF: 1.4,
      armB: 0.6,
      foreB: 1.5,
      legF: 0.2,
      shinF: -0.4,
      legB: -0.1,
      shinB: -0.3,
      handB: 0.5,
      staff: -1.2,
    }),
    k(13, { torso: -0.22, lean: 0.1, armB: 0.7 }),
  ]),
  timed(
    'grab_release',
    A_GRAB_RELEASE,
    [k(0, { torso: -0.35, head: 0.3, armF: 1.1, armB: 1.0, staff: 1.4 }), k('t', { ...GUARD })],
    { vel: [-0.8, 0] },
  ),
  // Projection avant : elle repousse l'adversaire du plat du bâton.
  timed(
    'throw_forward',
    A_THROW,
    [
      k(0, { ...HOLD }),
      k('s*0.6', { torso: -0.15, twist: -0.3, armF: 0.6, foreF: 1.6, staff: HALF, armB: 1.0 }),
      k(
        's',
        {
          torso: 0.35,
          twist: 0.3,
          armF: 1.6,
          foreF: 0.1,
          staff: HALF,
          armB: 1.7,
          foreB: 0.1,
          wristB: 1.2,
          handB: 0,
          legF: 0.6,
          shinF: -0.5,
          legB: -0.5,
          shinB: -0.1,
        },
        'snap',
      ),
      k('t', { ...GUARD }, 'inOut'),
    ],
    { move: 0 },
  ),
  // Projection arrière : une volte-face, le bâton fauche l'adversaire derrière elle.
  timed(
    'throw_back',
    A_THROW,
    [
      k(0, { ...HOLD }),
      k('s*0.7', { yaw: PI * 0.6, armF: 1.4, staff: 0.4, torso: 0.1 }, 'in'),
      k(
        's',
        {
          yaw: PI,
          torso: 0.2,
          armF: 1.6,
          foreF: 0.05,
          staff: -0.2,
          armB: 0.5,
          spreadB: 0.6,
          legF: 0.5,
          shinF: -0.6,
          legB: -0.4,
        },
        'out',
      ),
      k('t*0.8', { yaw: TAU * 0.9 }, 'out'),
      k('t', { ...GUARD, yaw: TAU }, 'inOut'),
    ],
    { move: 1 },
  ),
  // Projection haute : le bâton soulève l'adversaire et le lance au-dessus d'elle.
  timed(
    'throw_up',
    A_THROW,
    [
      k(0, { ...HOLD }),
      k('s*0.6', { ...LOW, armF: 1.0, foreF: 0.4, staff: -0.2 }),
      k(
        's',
        {
          torso: -0.15,
          head: -0.4,
          armF: 3.0,
          foreF: 0.05,
          staff: HALF + 0.2,
          armB: 2.6,
          foreB: 0.2,
          handB: 0,
          legF: 0.1,
          shinF: -0.1,
          legB: -0.1,
          shinB: -0.1,
        },
        'out',
      ),
      k('t', { ...GUARD }, 'inOut'),
    ],
    { move: 2 },
  ),
  // Projection basse : elle plaque l'adversaire au sol du bout du bâton.
  timed(
    'throw_down',
    A_THROW,
    [
      k(0, { ...HOLD }),
      k('s*0.6', { torso: -0.1, armF: 2.5, foreF: 0.3, staff: HALF + 0.4 }),
      k(
        's',
        {
          torso: 0.6,
          head: 0.1,
          armF: 1.3,
          foreF: 0.05,
          staff: -1.1,
          armB: 0.6,
          legF: 0.8,
          shinF: -1.3,
          legB: 0.2,
          shinB: -1.0,
        },
        'snap',
      ),
      k('t', { ...GUARD }, 'inOut'),
    ],
    { move: 3 },
  ),
  timed('item_throw', A_ITEM_THROW, [
    k(0, { ...GUARD }),
    k('s*0.8', { torso: -0.2, twist: 0.4, armB: -0.8, foreB: 1.2, handB: 0.6 }),
    k(
      's',
      {
        torso: 0.3,
        twist: -0.4,
        armB: 1.9,
        foreB: 0.1,
        handB: 0.1,
        legF: 0.5,
        legB: -0.4,
      },
      'snap',
    ),
    k('t', { ...GUARD }, 'inOut'),
  ]),
];

// --- Attaques ----------------------------------------------------------------------------------

const ATTACKS: Clip[] = [
  // Bâton : petit coup de pointe, droit devant.
  strike('jab1', M_JAB, {
    wind: { armF: 0.25, foreF: 1.4, staff: 0.15, twist: -0.3 },
    hit: { armF: 1.45, foreF: 0.15, staff: 0.05, twist: 0.05, torso: 0.15, legF: 0.35 },
    hitEase: 'snap',
    follow: { armF: 1.3, foreF: 0.3, staff: 0.1 },
    followAt: 'e+4',
  }),
  // Revers de bâton : le bâton se lève puis retombe en diagonale.
  strike('jab2', M_JAB2, {
    wind: { armF: 1.4, foreF: 0.8, staff: HALF + 0.3, twist: -0.1, torso: 0.0 },
    hit: { armF: 1.5, foreF: 0.1, staff: -0.45, twist: 0.15, torso: 0.2, legF: 0.35 },
    hitEase: 'snap',
    follow: { staff: -0.6, armF: 1.35 },
    followAt: 'e+4',
  }),
  // Tourbillon : le bâton tournoie devant elle comme une hélice.
  strike('jab3', M_JAB3, {
    wind: { armF: 1.1, foreF: 0.6, staff: -0.4, twist: -0.1 },
    hit: {
      armF: 1.5,
      foreF: 0.15,
      staff: TAU * 0.6,
      torso: 0.12,
      twist: 0.1,
      legF: 0.4,
      shinF: -0.35,
    },
    hold: { staff: TAU * 1.6 },
    follow: { staff: TAU * 1.95, armF: 1.2, foreF: 0.5 },
    ret: { ...GUARD, staff: TAU + 0.35 },
  }),
  // Estoc : fente, le bâton tendu à l'horizontale, toute l'allonge.
  strike('ftilt', M_FTILT, {
    wind: { twist: -0.45, torso: 0.0, armF: 0.0, foreF: 1.5, staff: 0.05, legF: 0.3 },
    hit: {
      twist: 0.25,
      torso: 0.32,
      head: -0.2,
      armF: 1.89,
      foreF: 0.0,
      staff: 0.0,
      legF: 0.65,
      shinF: -0.55,
      legB: -0.5,
      shinB: -0.02,
      armB: -0.2,
      foreB: 1.0,
      spreadB: 0.5,
    },
    hitEase: 'snap',
    follow: { armF: 1.7, torso: 0.25 },
  }),
  // Arc de corail : le bâton passe en arc au-dessus de sa tête, d'avant en arrière.
  strike('utilt', M_UTILT, {
    wind: { armF: 1.0, foreF: 0.5, staff: -0.3, torso: 0.2 },
    hit: { armF: 2.2, foreF: 0.1, staff: 0.9, torso: -0.05, head: -0.25, legF: 0.3 },
    hold: { armF: 3.0, staff: 2.5, torso: -0.2, head: -0.35 },
    follow: { armF: 2.8, staff: 2.9 },
    ret: { ...GUARD, staff: 0.35 },
  }),
  // Balayage long : accroupie, le bâton balaie le sol d'arrière en avant.
  strike('dtilt', M_DTILT, {
    windAt: 's*0.5',
    wind: { ...LOW, armF: 0.3, foreF: 0.4, staff: -2.4 },
    hit: { ...LOW, torso: 0.55, armF: 1.55, foreF: 0.05, staff: -0.2, twist: 0.2 },
    hold: { staff: -0.1 },
    follow: { staff: 0.05, armF: 1.45 },
    ret: { ...LOW, armF: 0.9, foreF: 0.6, staff: -0.1 },
  }),
  // Glissement : elle glisse, le bâton pointé devant.
  strike('dash_attack', M_DASH_ATTACK, {
    windAt: 's*0.5',
    wind: { ...runPose(1), armF: 0.2, staff: 0.6 },
    hit: {
      torso: 0.3,
      head: -0.2,
      armF: 1.85,
      foreF: 0.05,
      staff: 0.05,
      armB: 0.9,
      foreB: 0.5,
      spreadB: 0.5,
      legF: 0.7,
      shinF: -0.4,
      legB: -0.55,
      shinB: -0.1,
      twist: 0.2,
    },
    hold: { torso: 0.32 },
    vel: [1.2, 0],
  }),
  // Lance de corail : le bâton ramené loin en arrière, puis estoc de tout le corps.
  {
    name: 'fsmash',
    action: A_ATTACK,
    move: M_FSMASH,
    keys: [
      k('c', {
        twist: -0.65,
        hipTwist: -0.3,
        torso: -0.05,
        head: -0.1,
        armF: -0.45,
        foreF: 1.3,
        staff: 0.0,
        armB: 1.2,
        foreB: 0.6,
        spreadB: 0.6,
        legF: 0.35,
        shinF: -0.5,
        legB: -0.35,
        shinB: -0.2,
      }),
      k(
        's',
        {
          twist: 0.4,
          hipTwist: 0.15,
          torso: 0.45,
          head: -0.3,
          armF: 2.02,
          foreF: 0.0,
          staff: 0.0,
          armB: -0.4,
          foreB: 0.8,
          spreadB: 0.5,
          legF: 0.75,
          shinF: -0.55,
          legB: -0.7,
          shinB: -0.02,
          offsetX: 0.06,
        },
        'snap',
      ),
      k('e', {}, 'linear'),
      k('e+8', { torso: 0.4, armF: 1.9 }, 'out'),
      k('t', { ...GUARD, offsetX: 0 }, 'inOut'),
    ],
  },
  // Gerbe : bâton dressé au-dessus de la tête, elle tourne sur elle-même.
  {
    name: 'usmash',
    action: A_ATTACK,
    move: M_USMASH,
    keys: [
      k('c', { ...LOW, armF: 0.6, foreF: 0.6, staff: -0.3, armB: 0.4 }),
      k(
        's',
        {
          torso: -0.1,
          head: -0.4,
          armF: 3.05,
          foreF: 0.0,
          staff: HALF,
          armB: 2.0,
          foreB: 0.3,
          spreadB: 0.9,
          handB: 0,
          legF: 0.1,
          shinF: -0.1,
          legB: -0.05,
          shinB: -0.1,
          offsetY: 0.03,
          yaw: 0,
        },
        'out',
      ),
      k('e', { yaw: TAU * 1.5 }, 'linear'),
      k('e+8', { yaw: TAU * 1.85, offsetY: 0 }, 'out'),
      k('t', { ...GUARD, yaw: TAU * 2 }, 'inOut'),
    ],
  },
  // Ressac : le bâton balaie le sol en cercle, devant puis derrière.
  {
    name: 'dsmash',
    action: A_ATTACK,
    move: M_DSMASH,
    keys: [
      k('c', { ...LOW, armF: 0.8, foreF: 0.8, staff: 0.9, yaw: 0.4 }),
      k(
        's',
        {
          ...LOW,
          torso: 0.4,
          armF: 1.55,
          foreF: 0.0,
          staff: -0.1,
          armB: 1.2,
          spreadB: 0.8,
          yaw: 0,
        },
        'out',
      ),
      k('e', { yaw: PI }, 'linear'),
      k('e+5', { yaw: PI * 1.6 }, 'out'),
      k('t', { ...GUARD, yaw: TAU }, 'inOut'),
    ],
  },
  // Bulle : le bâton tournoie tout autour d'elle.
  {
    name: 'nair',
    action: A_ATTACK,
    move: M_NAIR,
    air: true,
    from: AIR,
    keys: [
      k('s*0.5', { ...AIR, armF: 1.0, staff: -0.6 }),
      k(
        's',
        {
          torso: 0.0,
          head: -0.05,
          armF: 1.5,
          foreF: 0.1,
          staff: 0.6,
          armB: 1.5,
          foreB: 0.3,
          spreadB: 1.0,
          handB: 0,
          legF: 0.4,
          shinF: -0.7,
          legB: 0.2,
          shinB: -0.6,
        },
        'out',
      ),
      k('e', { staff: 0.6 + TAU * 2 }, 'linear'),
      k('t', { ...AIR, staff: 0.2 + TAU * 2 }, 'inOut'),
    ],
  },
  // Pointe : estoc aérien, droit devant.
  strike('fair', M_FAIR, {
    air: true,
    wind: { armF: 0.1, foreF: 1.4, staff: 0.1, twist: -0.4, torso: 0.0 },
    hit: {
      armF: 1.7,
      foreF: 0.0,
      staff: -0.08,
      twist: 0.25,
      torso: 0.15,
      armB: 0.4,
      spreadB: 0.6,
      legF: 0.7,
      shinF: -1.0,
      legB: 0.1,
      shinB: -0.5,
    },
    hitEase: 'snap',
  }),
  // Contre-courant : le bâton fouette vers l'arrière.
  strike('bair', M_BAIR, {
    air: true,
    wind: { armF: 1.4, foreF: 0.4, staff: 0.6, twist: -0.3 },
    hit: {
      armF: -1.1,
      foreF: 0.15,
      staff: PI - 0.08,
      twist: 0.45,
      torso: 0.25,
      head: -0.2,
      turn: -0.1,
      armB: 1.4,
      foreB: 0.5,
      spreadB: 0.5,
      legF: 0.3,
      shinF: -0.8,
      legB: -0.3,
      shinB: -0.6,
    },
    follow: { armF: -1.2, staff: PI + 0.2 },
  }),
  // Vague haute : le bâton passe en arc au-dessus de sa tête, d'arrière en avant.
  strike('uair', M_UAIR, {
    air: true,
    wind: { armF: 2.2, foreF: 0.4, staff: PI, torso: 0.1 },
    hit: { armF: 3.0, foreF: 0.05, staff: 2.3, torso: -0.15, head: -0.4, legF: 0.3, legB: 0.2 },
    hold: { staff: 0.7, armF: 2.8 },
    follow: { staff: 0.3, armF: 2.4 },
  }),
  // Plongée : le bâton plonge à la verticale sous elle.
  strike('dair', M_DAIR, {
    air: true,
    wind: { armF: 3.0, foreF: 0.2, staff: HALF, torso: -0.1, legF: 0.7, shinF: -1.4 },
    hit: {
      armF: 0.45,
      foreF: 0.05,
      staff: -HALF,
      torso: 0.35,
      head: 0.45,
      legF: 0.4,
      shinF: -0.9,
      legB: 0.1,
      shinB: -0.7,
      armB: 1.6,
      spreadB: 0.7,
    },
    hitEase: 'snap',
    hold: { staff: -HALF + 0.05 },
  }),
  // Perle : la main arrière ouverte pousse la perle droit devant.
  strike('nspecial', M_NSPECIAL, {
    windAt: 's*0.6',
    wind: {
      twist: 0.35,
      torso: -0.05,
      armB: -0.35,
      foreB: 1.9,
      wristB: 1.0,
      handB: 0.4,
      armF: 0.35,
      foreF: 0.9,
      staff: 1.3,
    },
    hit: {
      twist: -0.45,
      torso: 0.2,
      armB: 1.82,
      foreB: 0.05,
      wristB: 1.4,
      handB: 0,
      spreadB: 0,
      armF: 0.2,
      foreF: 1.1,
      staff: 1.4,
      legF: 0.4,
      shinF: -0.4,
    },
    hitEase: 'snap',
    follow: { armB: 1.7, foreB: 0.2, twist: -0.35 },
    followAt: 'e+10',
  }),
  // Galet : lancer par en dessous, en cloche.
  strike('sspecial', M_SSPECIAL, {
    windAt: 's*0.6',
    wind: { twist: 0.3, torso: 0.25, armB: -0.9, foreB: 0.3, handB: 0.6, staff: 1.0 },
    hit: {
      twist: -0.3,
      torso: -0.1,
      head: -0.25,
      armB: 2.1,
      foreB: 0.15,
      wristB: 0.6,
      handB: 0.1,
      armF: 0.4,
      foreF: 0.9,
      staff: 1.2,
      legF: 0.35,
    },
    followAt: 'e+10',
    follow: { armB: 2.3, foreB: 0.3 },
  }),
  // Écume : ascension en spirale, le bâton dressé au-dessus de la tête.
  {
    name: 'uspecial',
    action: A_ATTACK,
    move: M_USPECIAL,
    air: true,
    vel: [0, 2.1],
    keys: [
      k('s*0.6', { ...LOW, armF: 0.5, staff: -0.3, armB: 0.5 }),
      k(
        's',
        {
          torso: -0.05,
          head: -0.35,
          armF: 3.0,
          foreF: 0.05,
          staff: HALF,
          armB: 2.0,
          foreB: 0.2,
          spreadB: 1.0,
          handB: 0,
          legF: 0.15,
          shinF: -0.2,
          legB: 0.05,
          shinB: -0.3,
          yaw: 0,
        },
        'out',
      ),
      k('e', { yaw: TAU * 3 }, 'linear'),
      k('t', { ...AIR, armF: 2.4, armB: 2.2, staff: 1.2, yaw: TAU * 3 }, 'out'),
    ],
  },
  // Corail : elle plante la pointe du bâton dans le sol devant elle.
  strike('dspecial', M_DSPECIAL, {
    windAt: 's*0.6',
    wind: { armF: 2.5, foreF: 0.3, staff: HALF + 0.3, torso: -0.05, armB: 1.2 },
    hit: {
      torso: 0.5,
      head: -0.25,
      armF: 1.3,
      foreF: 0.05,
      staff: -1.05,
      armB: 0.7,
      spreadB: 0.5,
      legF: 0.7,
      shinF: -1.0,
      legB: -0.1,
      shinB: -0.8,
    },
    hitEase: 'snap',
    followAt: 'e+10',
    follow: { torso: 0.45, staff: -1.0 },
  }),
  // Grande perle : elle rassemble l'eau entre ses mains, puis pousse une perle immense.
  {
    name: 'ultimate',
    action: A_ATTACK,
    move: M_ULTIMATE,
    keys: [
      k('s*0.35', {
        torso: -0.1,
        head: -0.35,
        armF: 2.9,
        foreF: 0.1,
        staff: HALF,
        armB: 2.6,
        foreB: 0.4,
        handB: 0,
        spreadB: 0.6,
        legF: 0.15,
        legB: -0.1,
      }),
      k(
        's*0.8',
        {
          ...LOW,
          torso: 0.35,
          armF: 0.9,
          foreF: 1.5,
          staff: 1.0,
          armB: 0.6,
          foreB: 1.9,
          wristB: 1.2,
          spreadB: -0.1,
        },
        'inOut',
      ),
      k(
        's',
        {
          torso: 0.3,
          head: -0.15,
          twist: -0.1,
          armF: 1.75,
          foreF: 0.1,
          staff: 0.15,
          armB: 1.85,
          foreB: 0.05,
          wristB: 1.4,
          handB: 0,
          spreadB: 0,
          legF: 0.6,
          shinF: -0.5,
          legB: -0.5,
          shinB: -0.05,
        },
        'snap',
      ),
      k('s+20', { torso: 0.32, armB: 1.9 }, 'linear'),
      k('s+32', { torso: 0.15, armB: 1.2, foreB: 0.8, armF: 1.0, foreF: 0.8 }, 'out'),
      k('t', { ...GUARD }, 'inOut'),
    ],
  },
  // Remontée en vague : remontée et balayage bas du bâton.
  {
    name: 'ledge_attack',
    action: A_ATTACK,
    move: M_LEDGE_ATTACK,
    keys: [
      k(0, { ...HANG, offsetX: -0.25, offsetY: -0.6 }),
      k(
        's*0.7',
        { ...LOW, armF: 0.4, foreF: 0.6, staff: -2.3, offsetX: -0.1, offsetY: -0.1 },
        'out',
      ),
      k(
        's',
        {
          ...LOW,
          torso: 0.5,
          armF: 1.55,
          foreF: 0.05,
          staff: -0.15,
          twist: 0.2,
          offsetX: 0,
          offsetY: 0,
        },
        'out',
      ),
      k('e', { staff: 0.0 }, 'linear'),
      k('t', { ...GUARD }, 'inOut'),
    ],
  },
];

// --- Bâton : de l'angle voulu à la rotation du poignet -----------------------------------------

/** Rotation du poignet qui oriente le bâton à `staff`, pour ce bras et ce buste. */
const wristFor = (c: Record<string, number>, staff: number): number =>
  staff - (c.armF! + c.foreF! - c.torso!);

/** Retire `staff` d'une pose et y écrit `wristF` (la pose complète en cours est `cur`). */
function resolvePose(pose: NPosture, cur: Record<string, number>, staff: number): Posture {
  const out: NPosture = { ...pose, wristF: wristFor(cur, staff) };
  delete out.staff;
  return out;
}

const GUARD_ANGLE = GUARD.staff!;
const GUARD_OUT: Posture = resolvePose(GUARD, { ...REST, ...GUARD }, GUARD_ANGLE);

/** Convertit l'angle du bâton de toutes les clés d'un clip en rotation du poignet. */
function staffed(clip: Clip): Clip {
  const from = clip.from as NPosture | undefined;
  let cur: Record<string, number> = { ...REST, ...GUARD, ...from };
  let staff = from?.staff ?? GUARD_ANGLE;
  const fromOut = from === undefined ? undefined : resolvePose(from, cur, staff);
  const keys = clip.keys.map((kk): Key => {
    const pose = kk.pose as NPosture;
    cur = { ...cur, ...pose };
    if (pose.staff !== undefined) staff = pose.staff;
    return { ...kk, pose: resolvePose(pose, cur, staff) };
  });
  return { ...clip, keys, ...(fromOut === undefined ? {} : { from: fromOut }) };
}

/** Poses de victoire (portraits des résultats : dernière image), comme une vague qui se pose. */
const victory = (name: string, pose: NPosture): Clip =>
  timed(name, A_IDLE, [k(0, { ...GUARD }), k(24, pose, 'inOut'), k(48, {}, 'settle')], {
    frames: 48,
  });

const VICTORY: Clip[] = [
  // Le bâton planté droit à côté d'elle, la main arrière sur la hanche.
  victory('victory1', {
    torso: 0.0,
    head: -0.1,
    tilt: 0.1,
    turn: 0.45,
    armF: 0.75,
    foreF: 0.65,
    staff: HALF,
    armB: 0.5,
    foreB: 2.0,
    spreadB: 0.65,
    handB: 0.5,
    legF: 0.2,
    shinF: -0.1,
    legB: -0.05,
    shinB: -0.3,
  }),
  // Le bâton levé à l'horizontale au-dessus de la tête, la main arrière ouverte au ciel.
  victory('victory2', {
    torso: -0.1,
    head: -0.3,
    turn: 0.4,
    armF: 2.95,
    foreF: 0.2,
    staff: 0.0,
    armB: 2.6,
    foreB: 0.3,
    spreadB: 0.4,
    handB: 0,
    wristB: 0.3,
    legF: 0.15,
    shinF: -0.1,
    legB: -0.12,
    shinB: -0.12,
  }),
  // Révérence : le bâton tendu de côté, la main arrière sur le cœur.
  victory('victory3', {
    torso: 0.5,
    head: 0.3,
    turn: 0.35,
    armF: 0.9,
    foreF: 0.2,
    staff: -0.6,
    armB: 1.0,
    foreB: 2.2,
    spreadB: -0.15,
    handB: 0.2,
    legF: 0.2,
    shinF: -0.25,
    legB: -0.3,
    shinB: -0.65,
  }),
];

const STAFFED_ATTACKS = ATTACKS.map(staffed);

const CLIPS: Clip[] = [
  ...[...LOCOMOTION, ...DEFENSE, ...GRABS, ...VICTORY].map(staffed),
  ...STAFFED_ATTACKS,
  // Charges : la vague retenue ondule lentement.
  charge('fsmash', M_FSMASH, windOf(STAFFED_ATTACKS, 'fsmash', GUARD_OUT), 1, 20),
  charge('usmash', M_USMASH, windOf(STAFFED_ATTACKS, 'usmash', GUARD_OUT), 1, 20),
  charge('dsmash', M_DSMASH, windOf(STAFFED_ATTACKS, 'dsmash', GUARD_OUT), 1, 20),
];

/**
 * Détails du modèle : deux mèches qui encadrent le visage et une perle à chaque oreille. Repère de
 * la tête : x vers l'avant, y vers le haut, z vers la caméra.
 */
const DETAILS: Sculpt = [
  {
    bone: 'head',
    shape: 'ellipsoid',
    zone: 'hair',
    center: [0.01, 0.165, 0],
    size: [0.1, 0.06, 0.11],
    blend: 0.014,
  },
  {
    bone: 'head',
    shape: 'capsule',
    zone: 'hair',
    from: [0.04, 0.15, 0.09],
    to: [0.06, 0.02, 0.1],
    radius: 0.018,
    radiusTo: 0.01,
    blend: 0.01,
    mirror: true,
  },
  {
    bone: 'head',
    shape: 'ellipsoid',
    zone: 'light',
    center: [-0.01, 0.06, 0.112],
    size: [0.011, 0.011, 0.011],
    mirror: true,
  },
];

/** Gabarit de Nacre (`packages/fighters/src/characters/nacre.ts`). */
const LEG_LENGTH = 1.1;
const HEAD_SIZE = 1.1;

const nacre: CharacterAnimation = {
  guard: GUARD_OUT,
  sculpt: DETAILS,
  detail: 1.5,
  walkCycle: cycleLength(WALK_SWING, LEG_LENGTH, HEAD_SIZE),
  runCycle: cycleLength((RUN_SWING + 0.65) / 2, LEG_LENGTH, HEAD_SIZE),
  clips: CLIPS satisfies readonly ClipDef[],
};

export default nacre;
