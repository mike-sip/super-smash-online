/**
 * Animation par clés, écrite à la main (outil d'export : voir `bake-character.ts`).
 *
 * Une clé donne la valeur de quelques canaux à un instant ; les canaux absents reprennent ceux de
 * la clé précédente, comme une pose qu'on modifie dans un logiciel d'animation. Entre deux clés,
 * la courbe `ease` de la clé d'arrivée règle l'accélération.
 *
 * Les instants s'écrivent en frames ou par rapport à la frame data du coup, pour que l'animation
 * suive l'équilibrage sans être retouchée :
 * - `'s'` : première frame active (le coup doit être en place), `'e'` : dernière frame active ;
 * - `'t'` : fin de l'action, `'c'` : frame de charge d'un smash ;
 * - décalages et fractions : `'s-3'`, `'e+2'`, `'t*0.5'`, `'s*0.4'`.
 *
 * Canaux : ceux du mannequin (`Pose`, angles en radians dans le plan du profil) et des canaux 3D
 * en plus (rotation des épaules et du bassin, inclinaison, poignets, ouverture des bras, mains).
 */
import { HIP_HEIGHT, type Pose } from '../../src/fighters/poses.ts';

export interface Channels extends Pose {
  /** Rotation du buste autour de la colonne (positive : l'épaule côté caméra avance). */
  twist: number;
  /** Rotation du bassin autour de la verticale (positive : la hanche côté caméra avance). */
  hipTwist: number;
  /** Inclinaison latérale du buste (positive : vers la caméra). */
  lean: number;
  /** Inclinaison latérale de la tête (positive : vers la caméra). */
  tilt: number;
  /** Rotation de la tête (positive : le visage se tourne vers la caméra). */
  turn: number;
  /** Rotation des poignets dans le plan du profil. */
  wristF: number;
  wristB: number;
  /** Écartement des bras hors du plan du profil (positif : vers l'extérieur). */
  spreadF: number;
  spreadB: number;
  /** Fermeture des mains : 0 ouverte, 1 poing serré. */
  handF: number;
  handB: number;
}

export type Channel = keyof Channels;
export type Posture = Partial<Channels>;

export type Ease = 'linear' | 'in' | 'out' | 'inOut' | 'snap' | 'settle' | 'back' | 'step';

/** Instant d'une clé : frame, ou expression relative à la frame data (voir l'en-tête). */
export type At = number | string;

export interface Key {
  readonly at: At;
  readonly pose: Posture;
  /** Courbe depuis la clé précédente (par défaut `inOut`). */
  readonly ease?: Ease;
}

export interface ClipDef {
  readonly name: string;
  readonly keys: readonly Key[];
  /** Clip en boucle : la dernière clé revient sur la première à cette période (frames). */
  readonly loop?: number;
  /** Durée quand la simulation n'en donne pas (frames). */
  readonly frames?: number;
  /** Vitesse du corps (unités par frame, avant, haut) : elle anime le bandeau et la tunique. */
  readonly vel?: readonly [number, number];
  /** Pose de départ dont héritent les clés (par défaut la garde du personnage). */
  readonly from?: Posture;
}

/** Repères temporels d'une action, tirés de la frame data. */
export interface Timing {
  readonly start: number;
  readonly end: number;
  readonly total: number;
  readonly charge: number;
}

const EXPR = /^([secst])(?:\s*([*+-])\s*([\d.]+))?$/;

/** Frame d'un instant de clé. */
export function resolveAt(at: At, timing: Timing): number {
  if (typeof at === 'number') return at;
  const m = EXPR.exec(at.trim());
  if (m === null) throw new Error(`Instant de clé illisible : « ${at} »`);
  const base = { s: timing.start, e: timing.end, t: timing.total, c: timing.charge }[
    m[1] as 's' | 'e' | 't' | 'c'
  ];
  if (m[2] === undefined) return base;
  const n = Number(m[3]);
  return m[2] === '*' ? base * n : m[2] === '+' ? base + n : base - n;
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

export function ease(kind: Ease, t: number): number {
  const x = clamp01(t);
  switch (kind) {
    case 'linear':
      return x;
    case 'in':
      return x * x;
    case 'out':
      return 1 - (1 - x) * (1 - x);
    case 'snap':
      // Départ sec, arrivée freinée : le membre claque.
      return 1 - Math.pow(1 - x, 2.6);
    case 'settle':
      return 1 - Math.pow(1 - x, 3);
    case 'back': {
      // Dépassement léger puis retour (rebond d'une pose qui s'installe).
      const s = 1.6;
      const y = x - 1;
      return 1 + (s + 1) * y * y * y + s * y * y;
    }
    case 'step':
      return x < 1 ? 0 : 1;
    default:
      return x * x * (3 - 2 * x);
  }
}

/** Clés résolues : instants en frames, poses complètes. */
export interface Track {
  readonly frames: readonly number[];
  readonly poses: readonly Channels[];
  readonly eases: readonly Ease[];
  readonly length: number;
}

export function compile(clip: ClipDef, guard: Channels, timing: Timing): Track {
  let current: Channels = { ...guard, ...clip.from };
  const frames: number[] = [];
  const poses: Channels[] = [];
  const eases: Ease[] = [];
  let length = clip.loop ?? clip.frames ?? timing.total;
  for (const key of clip.keys) {
    // Une frame data serrée peut rapprocher deux repères (`'e+3'` au-delà de `'t'`) : les clés
    // restent dans l'ordre et dans la durée de l'action.
    let f = resolveAt(key.at, timing);
    if (frames.length > 0) f = Math.max(f, frames[frames.length - 1]!);
    if (length > 0 && clip.loop === undefined) f = Math.min(f, length);
    current = { ...current, ...key.pose };
    frames.push(f);
    poses.push(current);
    eases.push(key.ease ?? 'inOut');
  }
  if (frames.length === 0) throw new Error(`${clip.name} : aucune clé`);
  if (clip.loop !== undefined) {
    // La boucle se referme sur la première clé.
    frames.push(clip.loop);
    poses.push(poses[0]!);
    eases.push(clip.keys[0]!.ease ?? 'inOut');
  }
  if (!(length > 0)) length = frames[frames.length - 1]!;
  return { frames, poses, eases, length };
}

/** Pose à la frame `f` (fractionnaire). */
export function sample(track: Track, f: number, out: Channels): Channels {
  const { frames, poses, eases } = track;
  if (f <= frames[0]!) return Object.assign(out, poses[0]);
  const last = frames.length - 1;
  if (f >= frames[last]!) return Object.assign(out, poses[last]);
  let i = 0;
  while (frames[i + 1]! <= f) i++;
  const span = frames[i + 1]! - frames[i]!;
  const t = span <= 0 ? 1 : ease(eases[i + 1]!, (f - frames[i]!) / span);
  const a = poses[i]!;
  const b = poses[i + 1]!;
  for (const k of Object.keys(a) as Channel[]) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** Toutes les valeurs à zéro, bassin à hauteur jambes tendues, mains à demi fermées. */
export const REST: Channels = {
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
  twist: 0,
  hipTwist: 0,
  lean: 0,
  tilt: 0,
  turn: 0,
  wristF: 0,
  wristB: 0,
  spreadF: 0,
  spreadB: 0,
  handF: 0.45,
  handB: 0.45,
};
