/**
 * Poses procédurales du mannequin : une par action, fonction de la frame de l'action.
 * Logique pure, sans Three.js.
 *
 * Unités : les longueurs sont en hauteurs de combattant (1 = des pieds à la tête), les angles en
 * radians. Le combattant est décrit de profil, tourné vers +x. Un angle de membre vaut 0 quand
 * le membre pend à la verticale et croît quand il part vers l'avant ; coude et genou s'ajoutent
 * à l'angle du segment qui les porte.
 *
 * Les durées sont en frames de simulation, jamais en temps réel : la pose ne dépend que de
 * l'état lu dans la simulation, ce qui la garde juste en pause, au ralenti et image par image.
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
  A_ITEM_SWING,
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
  M_EXTRA1,
  M_EXTRA2,
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
  ITEM_THROW_FRAMES,
  ITEM_THROW_RELEASE,
  fxToFloat,
  type FighterDef,
  type MoveDef,
} from '@game/sim-core';

export interface Pose {
  /** Hauteur du bassin au-dessus des pieds. */
  hipY: number;
  /** Décalage du corps entier : vers l'avant, vers le haut, vers la caméra. */
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  /** Rotation du corps entier autour de son centre, positive quand la tête part vers l'avant. */
  spin: number;
  /** Rotation du corps autour de la verticale. */
  yaw: number;
  /** Inclinaison du torse, positive vers l'avant. */
  torso: number;
  /** Inclinaison de la tête par rapport au torse. */
  head: number;
  /** Bras et jambe « F » sont du côté de la caméra quand le combattant regarde à droite. */
  armF: number;
  foreF: number;
  armB: number;
  foreB: number;
  legF: number;
  shinF: number;
  legB: number;
  shinB: number;
}

export const POSE_KEYS: readonly (keyof Pose)[] = [
  'hipY',
  'offsetX',
  'offsetY',
  'offsetZ',
  'spin',
  'yaw',
  'torso',
  'head',
  'armF',
  'foreF',
  'armB',
  'foreB',
  'legF',
  'shinF',
  'legB',
  'shinB',
];

/** Proportions du mannequin, en hauteurs de combattant. */
export const THIGH = 0.225;
export const SHIN = 0.225;
export const TORSO = 0.35;
export const UPPER_ARM = 0.17;
export const FOREARM = 0.17;
export const HEAD_RADIUS = 0.1;
/** Hauteur du bassin jambes tendues. */
export const HIP_HEIGHT = THIGH + SHIN;
/** Centre autour duquel tourne le corps entier (`spin`). */
export const SPIN_PIVOT_Y = 0.5;

const HALF_PI = Math.PI / 2;
const TAU = Math.PI * 2;

export function createPose(): Pose {
  return {
    hipY: HIP_HEIGHT,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    spin: 0,
    yaw: 0,
    torso: 0,
    head: 0,
    armF: 0,
    foreF: 0,
    armB: 0,
    foreB: 0,
    legF: 0,
    shinF: 0,
    legB: 0,
    shinB: 0,
  };
}

export function copyPose(from: Pose, to: Pose): void {
  for (let k = 0; k < POSE_KEYS.length; k++) {
    const key = POSE_KEYS[k]!;
    to[key] = from[key];
  }
}

/** Mélange deux poses ; `out` peut être l'une des deux. */
export function lerpPose(a: Pose, b: Pose, t: number, out: Pose): void {
  for (let k = 0; k < POSE_KEYS.length; k++) {
    const key = POSE_KEYS[k]!;
    const from = a[key];
    out[key] = from + (b[key] - from) * t;
  }
}

const unwind = (angle: number): number => angle - TAU * Math.round(angle / TAU);

/**
 * Ramène les rotations du corps entier à l'angle équivalent le plus proche de zéro. À faire avant
 * de mélanger vers une autre pose : sans cela, une roulade terminée se déroulerait à l'envers.
 */
export function unwindPose(pose: Pose): void {
  pose.spin = unwind(pose.spin);
  pose.yaw = unwind(pose.yaw);
}

/** Ce dont une pose dépend. Rempli par le mannequin à partir de l'état lu dans la simulation. */
export interface PoseInput {
  action: number;
  /** Frame de l'action, éventuellement fractionnaire entre deux frames simulées. */
  frame: number;
  /** Emplacement de l'attaque ou de la projection en cours. */
  move: number;
  grounded: boolean;
  velY: number;
  /** Vitesse horizontale dans le sens du regard : positive si le combattant avance. */
  forward: number;
  /** Frames de charge accumulées par l'attaque en cours. */
  charge: number;
  /** Temps forts de l'action (frames actives d'une attaque, intangibilité d'une esquive). */
  start: number;
  end: number;
  /** Durée de l'action, ou 0 si elle n'en a pas de fixe. */
  total: number;
  /** Distance parcourue par une remontée de rebord, en hauteurs de combattant. */
  travel: number;
}

export function createPoseInput(): PoseInput {
  return {
    action: A_IDLE,
    frame: 0,
    move: 0,
    grounded: true,
    velY: 0,
    forward: 0,
    charge: 0,
    start: 0,
    end: 0,
    total: 0,
    travel: 0,
  };
}

/** Durées que la simulation garde pour elle ; reprises ici pour rythmer les poses. */
const SHIELD_DROP_FRAMES = 11;
const GRAB_RELEASE_FRAMES = 20;

/**
 * Remplit `start`, `end`, `total` et `travel` d'après les données du combattant. `swing` est le
 * coup de l'objet à frapper tenu, pour `A_ITEM_SWING` (module stages-items).
 */
export function actionTiming(
  def: FighterDef,
  action: number,
  move: number,
  out: PoseInput,
  swing?: MoveDef,
): void {
  out.start = 0;
  out.end = 0;
  out.total = 0;
  out.travel = 0;
  switch (action) {
    case A_ITEM_THROW:
      out.start = ITEM_THROW_RELEASE;
      out.end = ITEM_THROW_RELEASE;
      out.total = ITEM_THROW_FRAMES;
      return;
    case A_ITEM_SWING:
    case A_ATTACK: {
      const m = action === A_ITEM_SWING ? swing : def.moves[move];
      if (m === undefined) return;
      out.total = m.totalFrames;
      if (m.hits.length > 0) {
        let start = Infinity;
        let end = 0;
        for (let h = 0; h < m.hits.length; h++) {
          const hit = m.hits[h]!;
          if (hit.start < start) start = hit.start;
          if (hit.end > end) end = hit.end;
        }
        out.start = start;
        out.end = end;
      } else {
        // Sans hitbox, le temps fort est le départ du projectile, ou à défaut le tiers de l'attaque.
        const peak = m.spawn !== undefined ? m.spawn.frame : Math.ceil(m.totalFrames / 3);
        out.start = peak;
        out.end = peak;
      }
      return;
    }
    case A_GRAB:
      out.start = def.grab.start;
      out.end = def.grab.end;
      out.total = def.grab.totalFrames;
      return;
    case A_THROW: {
      const t = def.throws[move & 3]!;
      out.start = t.releaseFrame;
      out.end = t.releaseFrame;
      out.total = t.totalFrames;
      return;
    }
    case A_SPOTDODGE:
      out.start = def.spotDodge.invStart;
      out.end = def.spotDodge.invEnd;
      out.total = def.spotDodge.totalFrames;
      return;
    case A_ROLL:
      out.start = def.roll.invStart;
      out.end = def.roll.invEnd;
      out.total = def.roll.totalFrames;
      return;
    case A_AIRDODGE:
      out.start = def.airDodge.invStart;
      out.end = def.airDodge.invEnd;
      out.total = def.airDodge.totalFrames;
      return;
    case A_DASH:
      out.total = def.dashFrames;
      return;
    case A_BRAKE:
      out.total = def.brakeFrames;
      return;
    case A_TURN:
      out.total = def.turnFrames;
      return;
    case A_JUMPSQUAT:
      out.total = def.jumpSquatFrames;
      return;
    case A_LAND:
      out.total = def.landFrames;
      return;
    case A_TECH:
      out.total = def.techFrames;
      return;
    case A_DOWN:
      out.total = def.downFrames;
      return;
    case A_SHIELD_DROP:
      out.total = SHIELD_DROP_FRAMES;
      return;
    case A_GRAB_RELEASE:
      out.total = GRAB_RELEASE_FRAMES;
      return;
    case A_LEDGE_GETUP:
      out.total = def.ledgeGetupFrames;
      out.travel = (2 * fxToFloat(def.halfWidth)) / fxToFloat(def.height);
      return;
    case A_LEDGE_ROLL:
      out.total = def.ledgeRollFrames;
      out.travel = fxToFloat(def.halfWidth + def.ledgeRollDistance) / fxToFloat(def.height);
      return;
    default:
  }
}

/**
 * Frame à afficher entre deux frames simulées : `prev…` décrit la capture précédente, `action` et
 * `frame` la dernière. La frame avance avec `alpha` quand la simulation a avancé, reste figée
 * quand elle ne l'a pas fait (hitlag, attaque en charge) et repart de zéro pour une action neuve.
 */
export function displayFrame(
  prevAction: number,
  prevFrame: number,
  action: number,
  frame: number,
  alpha: number,
): number {
  if (action === prevAction) {
    if (frame === prevFrame) return frame;
    if (frame === prevFrame + 1) return prevFrame + alpha;
  }
  return frame > 0 ? frame - 1 + alpha : 0;
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Part écoulée de l'action, de 0 à 1 ; 1 pour une action sans durée. */
const progress = (input: PoseInput): number =>
  input.total > 0 ? clamp01(input.frame / input.total) : 1;

function limbs(
  out: Pose,
  torso: number,
  head: number,
  armF: number,
  foreF: number,
  armB: number,
  foreB: number,
  legF: number,
  shinF: number,
  legB: number,
  shinB: number,
): void {
  out.hipY = HIP_HEIGHT;
  out.offsetX = 0;
  out.offsetY = 0;
  out.offsetZ = 0;
  out.spin = 0;
  out.yaw = 0;
  out.torso = torso;
  out.head = head;
  out.armF = armF;
  out.foreF = foreF;
  out.armB = armB;
  out.foreB = foreB;
  out.legF = legF;
  out.shinF = shinF;
  out.legB = legB;
  out.shinB = shinB;
}

const reach = (leg: number, shin: number): number =>
  THIGH * Math.cos(leg) + SHIN * Math.cos(leg + shin);

/** Pose le pied le plus bas au sol : la hauteur du bassin découle des jambes. */
function plant(out: Pose): void {
  out.hipY = Math.max(reach(out.legF, out.shinF), reach(out.legB, out.shinB));
}

// Poses clés réutilisées par plusieurs actions.
const neutral = (out: Pose): void =>
  limbs(out, 0.05, 0, 0.15, 0.25, -0.2, 0.3, 0.15, -0.1, -0.15, -0.1);
const guard = (out: Pose): void => limbs(out, 0.2, 0.1, 1.5, 1.5, 1.2, 1.6, 0.55, -1.0, -0.1, -0.7);
const tuck = (out: Pose): void => limbs(out, 0.9, 0.5, 1.2, 1.6, 1.0, 1.6, 1.7, -2.3, 1.5, -2.3);
const hang = (out: Pose): void =>
  limbs(out, 0, -0.3, 2.95, 0.05, 2.85, 0.05, 0.1, -0.2, -0.05, -0.3);
const hold = (out: Pose): void => limbs(out, 0.15, 0, 1.4, 0.35, 1.3, 0.4, 0.35, -0.4, -0.3, -0.15);

// Poses de travail, créées une fois : `computePose` n'alloue rien.
const keyA = createPose();
const keyB = createPose();
const keyN = createPose();

/** Remplit la préparation `w` et le coup `s` de l'attaque `move`. */
function attackKeys(move: number, w: Pose, s: Pose): void {
  switch (move) {
    case M_JAB:
      limbs(w, 0, 0, -0.5, 1.3, -0.2, 0.6, 0.15, -0.1, -0.15, -0.1);
      limbs(s, 0.2, 0, 1.55, 0.05, -0.5, 0.9, 0.3, -0.25, -0.25, -0.1);
      return;
    case M_JAB2:
      limbs(w, 0, 0, 0.2, 0.6, -0.6, 1.3, 0.15, -0.1, -0.15, -0.1);
      limbs(s, 0.25, 0, -0.5, 0.9, 1.55, 0.05, 0.3, -0.25, -0.25, -0.1);
      return;
    case M_JAB3:
      limbs(w, -0.1, 0, 0.4, 0.6, -0.4, 0.6, -0.3, -1.2, -0.1, -0.1);
      limbs(s, -0.3, 0, -0.6, 0.5, 0.8, 0.5, 1.5, -0.05, -0.1, -0.2);
      return;
    case M_FTILT:
      limbs(w, 0.1, 0, 0.3, 0.8, -0.3, 0.8, -0.5, -1.0, 0, -0.1);
      limbs(s, -0.15, 0, -1.0, 0.3, 1.1, 0.3, 1.25, 0, -0.25, -0.3);
      return;
    case M_UTILT:
      limbs(w, 0.2, 0.2, -0.6, 0.8, -0.2, 0.4, 0.3, -0.6, -0.2, -0.3);
      limbs(s, -0.1, -0.4, 3.0, 0.05, -0.4, 0.5, 0.1, -0.05, -0.1, -0.05);
      return;
    case M_DTILT:
      limbs(w, 0.5, -0.2, 0.4, 0.9, 0.2, 0.9, 0.6, -2.0, 0.9, -2.0);
      limbs(s, 0.45, -0.2, 0.6, 0.8, -0.6, 0.8, 1.45, -0.1, 0.9, -2.1);
      return;
    case M_DASH_ATTACK:
      limbs(w, 0.5, -0.2, -0.8, 0.8, -0.9, 0.8, 0.6, -0.6, -0.5, -0.4);
      limbs(s, 0.85, -0.5, 1.9, 0.2, 1.8, 0.2, 0.4, -0.3, -0.8, -0.1);
      return;
    case M_FSMASH:
      limbs(w, -0.35, 0, -1.4, 1.6, 0.6, 0.6, -0.3, -0.3, 0.3, -0.4);
      limbs(s, 0.5, 0, 1.6, 0, -1.0, 0.8, 0.7, -0.6, -0.6, 0);
      return;
    case M_USMASH:
      limbs(w, 0.4, 0.2, -0.4, 0.4, -0.5, 0.4, 0.8, -1.6, 0.6, -1.6);
      limbs(s, -0.05, -0.5, 3.05, 0, 2.95, 0, 0.05, 0, -0.05, 0);
      return;
    case M_DSMASH:
      limbs(w, 0.3, 0, 0.6, 1.2, 0.4, 1.2, 0.5, -1.2, 0.3, -1.2);
      limbs(s, 0.15, 0, 1.2, 0.3, -1.2, 0.3, 1.35, -0.05, -1.35, -0.05);
      return;
    case M_NAIR:
      limbs(w, 0.3, 0.2, 0.8, 1.5, 0.6, 1.5, 1.2, -1.8, 1.0, -1.8);
      limbs(s, 0, 0, 1.7, 0, -1.7, 0, 0.8, 0, -0.8, 0);
      return;
    case M_FAIR:
      limbs(w, -0.3, -0.2, 2.9, 0.4, 2.6, 0.4, -0.3, -0.6, -0.5, -0.6);
      limbs(s, 0.5, 0.2, 1.1, 0.1, 0.9, 0.1, 0.5, -0.4, 0.1, -0.6);
      return;
    case M_BAIR:
      limbs(w, 0.3, 0, 0.6, 0.9, 0.4, 0.9, 0.9, -1.5, 0.6, -1.4);
      limbs(s, 0.6, 0.2, 1.2, 0.4, 0.8, 0.4, 0.5, -0.9, -1.6, 0);
      return;
    case M_UAIR:
      limbs(w, 0.2, 0.1, 0.3, 0.8, 0.1, 0.8, 0.9, -1.6, 0.5, -1.2);
      limbs(s, -0.6, -0.3, -0.8, 0.2, -1.0, 0.2, 2.5, 0, 2.2, -0.1);
      return;
    case M_DAIR:
      limbs(w, 0.1, 0, 1.0, 1.0, 0.8, 1.0, 1.0, -1.9, 0.9, -1.9);
      limbs(s, 0, 0.3, 2.6, 0.2, -2.6, 0.2, 0.05, 0, -0.05, 0);
      return;
    case M_NSPECIAL:
      limbs(w, -0.1, 0, 0.6, 1.6, -0.4, 0.8, 0.1, -0.1, -0.2, -0.1);
      limbs(s, 0.1, 0, 1.57, 0, 1.2, 1.2, 0.35, -0.3, -0.3, -0.1);
      return;
    // Spéciaux, ultime et suites (SPEC-fighters.md) : une pose générique par emplacement, commune
    // à tous les personnages.
    case M_SSPECIAL:
      // Fente : ramassé, puis tout le corps lancé vers l'avant.
      limbs(w, -0.25, 0.1, -0.7, 1.4, -0.5, 1.4, 0.6, -1.4, 0.3, -1.0);
      limbs(s, 0.75, -0.4, 1.65, 0.05, 1.3, 0.3, 0.9, -0.4, -0.9, -0.2);
      return;
    case M_USPECIAL:
      // Montée : accroupi, puis bras tendus au-dessus de la tête, corps droit.
      limbs(w, 0.4, 0.2, 0.9, 1.4, 0.7, 1.4, 1.3, -2.1, 1.1, -2.1);
      limbs(s, -0.1, -0.5, 2.95, 0.1, 2.75, 0.2, 0.25, -0.3, -0.15, -0.6);
      return;
    case M_DSPECIAL:
      // Garde ou appui au sol : bras croisés devant, jambes fléchies.
      limbs(w, 0.1, 0.1, 0.7, 1.7, 0.9, 1.7, 0.4, -0.7, -0.3, -0.5);
      limbs(s, -0.15, 0.2, 1.1, 1.9, 1.3, 1.8, 0.7, -1.4, -0.5, -0.9);
      return;
    case M_ULTIMATE:
      // Ultime : ramassé, puis bras et jambes grands ouverts.
      limbs(w, 0.5, 0.3, 1.0, 2.0, 0.8, 2.0, 1.0, -1.8, 0.8, -1.8);
      limbs(s, -0.25, -0.4, 2.3, 0.1, -2.3, 0.1, 0.9, -0.2, -0.9, -0.2);
      return;
    case M_EXTRA1:
    case M_EXTRA2:
      // Riposte : un coup droit appuyé.
      limbs(w, -0.3, 0, -0.9, 1.7, 0.4, 0.9, 0.2, -0.4, 0.1, -0.3);
      limbs(s, 0.45, -0.1, 1.6, 0, -0.9, 1.0, 0.75, -0.5, -0.65, -0.1);
      return;
    case M_LEDGE_ATTACK:
      limbs(w, 0.6, 0, 0.3, 0.9, 0.3, 0.9, 1.0, -1.9, 0.8, -1.9);
      limbs(s, 0.3, 0, 1.3, 0.2, 1.0, 0.4, 1.1, -0.1, -0.5, -0.6);
      return;
    default:
      // Attaques spéciales sans pose dédiée : un geste des deux bras vers l'avant.
      limbs(w, -0.2, 0, -0.6, 1.2, -0.7, 1.2, 0.15, -0.1, -0.15, -0.1);
      limbs(s, 0.3, 0, 1.57, 0, 1.4, 0, 0.4, -0.3, -0.3, -0.1);
  }
}

/** Remplit la préparation `w` et le lâcher `s` d'une projection : avant, arrière, haut, bas. */
function throwKeys(direction: number, w: Pose, s: Pose): void {
  switch (direction & 3) {
    case 0:
      limbs(w, -0.35, 0, -0.6, 1.0, -0.8, 1.0, -0.2, -0.1, 0.2, -0.3);
      limbs(s, 0.55, 0, 1.7, 0, 1.6, 0, 0.6, -0.5, -0.5, -0.1);
      return;
    case 1:
      hold(w);
      limbs(s, -0.5, -0.2, -2.2, 0.2, -2.0, 0.2, -0.4, -0.2, 0.5, -0.5);
      return;
    case 2:
      limbs(w, 0.3, 0, 1.0, 0.6, 0.9, 0.6, 0.6, -1.2, 0.4, -1.2);
      limbs(s, -0.05, -0.4, 3.0, 0, 2.9, 0, 0.1, -0.05, -0.1, -0.05);
      return;
    default:
      limbs(w, -0.1, 0, 2.6, 0.2, 2.5, 0.2, 0.1, -0.1, -0.1, -0.1);
      limbs(s, 0.9, 0.3, 0.5, 0.1, 0.4, 0.1, 0.7, -1.2, 0.3, -1.0);
  }
}

/** Part de la montée en puissance consacrée à la préparation ; le reste est le coup lui-même. */
const WINDUP_SHARE = 0.6;

/**
 * Enchaîne repos, préparation `w`, coup `s` tenu de `start` à `end`, puis retour au repos à
 * `total`. Le coup est en place à la frame `start`, celle où la simulation teste ses hitbox.
 */
function strike(input: PoseInput, w: Pose, s: Pose, out: Pose): void {
  const f = input.frame;
  const start = input.start;
  neutral(keyN);
  if (f < start) {
    const turn = start * WINDUP_SHARE;
    if (f < turn) lerpPose(keyN, w, smooth(f / turn), out);
    else lerpPose(w, s, smooth((f - turn) / (start - turn)), out);
  } else if (f <= input.end || input.total <= input.end) {
    copyPose(s, out);
  } else {
    lerpPose(s, keyN, smooth((f - input.end) / (input.total - input.end)), out);
  }
}

/** Calcule la pose de l'action décrite par `input`. N'alloue rien. */
export function computePose(input: PoseInput, out: Pose): void {
  const f = input.frame;
  switch (input.action) {
    case A_IDLE: {
      const breath = Math.sin(f * 0.09);
      neutral(out);
      out.torso += 0.02 * breath;
      out.head += 0.02 * breath;
      out.armF += 0.04 * breath;
      out.armB -= 0.04 * breath;
      plant(out);
      return;
    }
    case A_WALK: {
      const c = Math.sin(f * 0.24);
      limbs(
        out,
        0.08,
        0,
        -0.4 * c,
        0.3,
        0.4 * c,
        0.3,
        0.45 * c,
        -0.25 + 0.15 * c,
        -0.45 * c,
        -0.25 - 0.15 * c,
      );
      plant(out);
      return;
    }
    case A_DASH: {
      const c = Math.sin(f * 0.7);
      limbs(
        out,
        0.5,
        -0.2,
        -0.9,
        0.6,
        -1.1,
        0.6,
        0.9 * c,
        -0.6 + 0.3 * c,
        -0.9 * c,
        -0.6 - 0.3 * c,
      );
      plant(out);
      return;
    }
    case A_RUN: {
      const c = Math.sin(f * 0.55);
      limbs(
        out,
        0.38,
        -0.15,
        -0.9 * c,
        1.2,
        0.9 * c,
        1.2,
        0.85 * c,
        -0.7 + 0.35 * c,
        -0.85 * c,
        -0.7 - 0.35 * c,
      );
      plant(out);
      return;
    }
    case A_BRAKE:
      limbs(out, -0.3, 0.1, 0.9, 0.3, 0.5, 0.3, 0.75, -0.05, -0.25, -0.7);
      plant(out);
      return;
    case A_TURN:
      limbs(out, -0.2, 0, -0.9, 0.4, 1.0, 0.4, -0.45, -0.3, 0.55, -0.2);
      plant(out);
      return;
    case A_CROUCH:
      limbs(out, 0.55, -0.3, 0.5, 0.9, 0.2, 0.9, 1.15, -2.1, 0.95, -2.1);
      plant(out);
      return;
    case A_JUMPSQUAT: {
      const t = smooth(progress(input));
      limbs(
        out,
        0.05 + 0.3 * t,
        0,
        0.15 - t,
        0.25,
        -0.2 - 0.8 * t,
        0.3,
        0.15 + 0.6 * t,
        -0.1 - 1.2 * t,
        -0.15 + 0.5 * t,
        -0.1 - 1.2 * t,
      );
      plant(out);
      return;
    }
    case A_AIR: {
      // 1 en pleine montée, 0 en pleine chute.
      const up = clamp01(input.velY / 3.2 + 0.5);
      limbs(
        out,
        mix(-0.05, 0.12, up),
        mix(0.15, -0.1, up),
        mix(1.7, 2.6, up),
        0.2,
        mix(-1.4, 2.2, up),
        mix(0.2, 0.3, up),
        mix(0.35, 0.7, up),
        mix(-0.5, -1.2, up),
        mix(-0.3, -0.25, up),
        mix(-0.5, -0.4, up),
      );
      return;
    }
    case A_LAND: {
      const a = 1 - smooth(progress(input));
      limbs(
        out,
        0.05 + 0.35 * a,
        0.1 * a,
        0.15 + 0.9 * a,
        0.25,
        -0.2 + 1.1 * a,
        0.3,
        0.15 + 0.7 * a,
        -0.1 - 1.3 * a,
        -0.15 + 0.6 * a,
        -0.1 - 1.3 * a,
      );
      plant(out);
      return;
    }
    case A_ITEM_SWING:
    case A_ATTACK: {
      // Coup d'objet : la pose de l'attaque avant inclinée, objet au bout du bras.
      attackKeys(input.action === A_ITEM_SWING ? M_FTILT : input.move, keyA, keyB);
      strike(input, keyA, keyB, out);
      if (input.charge > 0) {
        out.torso += Math.sin(input.charge * 1.4) * 0.03;
        out.armF += Math.sin(input.charge * 1.9) * 0.05;
      }
      if (input.grounded) plant(out);
      return;
    }
    case A_HITSTUN: {
      const shake = Math.sin(f * 0.9) * 0.05;
      limbs(out, -0.5, -0.45, 1.5 + shake, 0.5, 1.1 - shake, 0.7, 0.7, -0.3, 0.35, -0.6);
      if (input.grounded) plant(out);
      return;
    }
    case A_TUMBLE:
      limbs(out, 0, -0.2, 2.2, 0.3, -2.0, 0.3, 0.8, -0.6, -0.7, -0.5);
      out.spin = -f * 0.22;
      return;
    case A_HELPLESS: {
      // Chute impuissante : corps relâché, bras levés qui flottent.
      const sway = Math.sin(f * 0.25) * 0.15;
      limbs(out, -0.25, 0.35, 2.5 + sway, 0.5, 2.1 - sway, 0.5, 0.2, -0.9, -0.35, -0.4);
      return;
    }
    case A_TECH: {
      const up = smooth(progress(input));
      limbs(out, 0.6, 0.3, 1.0, 1.4, 0.8, 1.4, 1.5, -2.0, 1.3, -2.0);
      out.spin = -HALF_PI * (1 - up);
      out.offsetY = -0.3 * (1 - up);
      return;
    }
    case A_DOWN:
      limbs(out, 0, 0.1, 0.5, 0.2, -0.5, 0.2, 0.2, -0.1, -0.1, -0.3);
      out.spin = -HALF_PI;
      out.offsetY = -0.38;
      return;
    case A_SHIELD:
      guard(out);
      plant(out);
      return;
    case A_SHIELDSTUN: {
      const shake = Math.sin(f * 2.2) * 0.05;
      limbs(out, -0.15 + shake, -0.2, 1.9, 1.2, 1.6, 1.3, 0.7, -0.9, -0.3, -0.5);
      plant(out);
      return;
    }
    case A_SHIELD_DROP:
      guard(keyA);
      neutral(keyB);
      lerpPose(keyA, keyB, smooth(progress(input)), out);
      plant(out);
      return;
    case A_SHIELD_BREAK:
      if (input.grounded) {
        // Étourdi : le corps oscille, la tête tombe.
        const sway = Math.sin(f * 0.13);
        limbs(out, 0.25 + 0.2 * sway, 0.5, 0.1, 0.1, -0.1, 0.1, 0.3, -0.2, -0.3, -0.2);
        out.offsetX = 0.05 * sway;
        plant(out);
      } else {
        limbs(out, -0.2, -0.4, 2.9, 0.1, -2.9, 0.1, 0.5, -0.8, -0.5, -0.8);
        out.spin = -f * 0.3;
      }
      return;
    case A_SPOTDODGE: {
      // Le combattant se dérobe vers le fond de la scène, puis revient.
      const a = Math.sin(Math.PI * progress(input));
      limbs(
        out,
        0.05 - 0.3 * a,
        0,
        0.15 - 0.6 * a,
        0.25,
        -0.2 - 0.5 * a,
        0.3,
        0.15,
        -0.1,
        -0.15,
        -0.1,
      );
      out.yaw = HALF_PI * a;
      out.offsetZ = -0.6 * a;
      plant(out);
      return;
    }
    case A_ROLL: {
      const t = progress(input);
      const a = smooth(4 * t) * smooth(4 * (1 - t));
      neutral(keyA);
      plant(keyA);
      tuck(keyB);
      lerpPose(keyA, keyB, a, out);
      out.spin = TAU * t * (input.forward < 0 ? -1 : 1);
      out.offsetY = -0.22 * a;
      return;
    }
    case A_AIRDODGE: {
      const t = progress(input);
      const a = smooth(4 * t) * smooth(4 * (1 - t));
      neutral(keyA);
      limbs(keyB, 0.2, -0.1, 2.9, 0.1, 2.7, 0.1, -0.3, -0.1, -0.5, -0.2);
      lerpPose(keyA, keyB, a, out);
      out.yaw = TAU * t;
      return;
    }
    case A_GRAB:
      limbs(keyA, -0.1, 0, -0.5, 0.9, -0.7, 0.9, 0.15, -0.1, -0.15, -0.1);
      limbs(keyB, 0.4, -0.1, 1.55, 0.05, 1.45, 0.1, 0.55, -0.5, -0.4, -0.1);
      strike(input, keyA, keyB, out);
      plant(out);
      return;
    case A_GRABBING:
      hold(out);
      out.armF += Math.sin(f * 0.2) * 0.03;
      plant(out);
      return;
    case A_GRABBED:
      limbs(out, -0.12, -0.35, 0.05, 0.1, -0.05, 0.1, 0.12, -0.25, 0.05, -0.3);
      out.offsetY = 0.08;
      return;
    // Lancer d'objet : mêmes poses que les projections, dans le même ordre de directions.
    case A_ITEM_THROW:
    case A_THROW:
      throwKeys(input.move, keyA, keyB);
      strike(input, keyA, keyB, out);
      plant(out);
      return;
    case A_GRAB_RELEASE: {
      const a = 1 - smooth(progress(input));
      limbs(
        out,
        0.05 - 0.45 * a,
        -0.2 * a,
        0.15 + 0.9 * a,
        0.25 + 0.3 * a,
        -0.2 + a,
        0.3 + 0.3 * a,
        0.15 + 0.5 * a,
        -0.1 - 0.1 * a,
        -0.15 - 0.25 * a,
        -0.1 - 0.4 * a,
      );
      plant(out);
      return;
    }
    case A_LEDGE: {
      const sway = Math.sin(f * 0.07) * 0.06;
      hang(out);
      out.legF += sway;
      out.legB += sway;
      return;
    }
    case A_LEDGE_GETUP: {
      // La simulation laisse le combattant suspendu jusqu'à la dernière frame, puis le pose sur
      // le stage : la pose fait le trajet, d'abord vers le haut, puis vers l'avant.
      const t = progress(input);
      hang(keyA);
      neutral(keyB);
      plant(keyB);
      lerpPose(keyA, keyB, smooth(t), out);
      out.offsetY = smooth(t / 0.6);
      out.offsetX = input.travel * smooth((t - 0.4) / 0.6);
      return;
    }
    case A_LEDGE_ROLL: {
      const t = progress(input);
      const forward = smooth((t - 0.4) / 0.6);
      hang(keyA);
      tuck(keyB);
      lerpPose(keyA, keyB, smooth(t / 0.4), out);
      neutral(keyA);
      plant(keyA);
      lerpPose(out, keyA, smooth((t - 0.8) / 0.2), out);
      out.spin = TAU * forward;
      out.offsetY = smooth(t / 0.6);
      out.offsetX = input.travel * forward;
      return;
    }
    default:
      // A_DEAD (le combattant est caché) et toute action inconnue.
      neutral(out);
      plant(out);
  }
}
