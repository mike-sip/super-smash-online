/**
 * Petits constructeurs qui rendent les données des personnages lisibles : on écrit en unités de
 * jeu (nombres ordinaires), la conversion en virgule fixe se fait ici, une seule fois, à la
 * construction du module.
 */
import {
  MOVE_SLOTS,
  fx,
  type CancelDef,
  type CapsuleDef,
  type DodgeDef,
  type HitDef,
  type MoveDef,
  type ThrowDef,
} from '@game/sim-core';

/** Cercle `[x, y, rayon]` ou capsule `[x1, y1, x2, y2, rayon]`, en unités de jeu, pieds pour origine. */
export type Shape =
  readonly [number, number, number] | readonly [number, number, number, number, number];

export interface HitSpec {
  /** Première et dernière frame actives, incluses. */
  readonly frames: readonly [start: number, end: number];
  readonly shape: Shape;
  /** Dégâts en pourcentage. */
  readonly damage: number;
  /** Angle d'éjection en degrés : 0 vers l'avant, 90 vers le haut. */
  readonly angle: number;
  /** Éjection de base. */
  readonly base: number;
  /** Croissance de l'éjection avec les dégâts ; 1 = 100 %. */
  readonly growth: number;
  /** Groupe de 0 à 3 : une cible n'est touchée qu'une fois par groupe. */
  readonly group?: number;
}

export function capsule(shape: Shape): CapsuleDef {
  const c =
    shape.length === 5 ? shape : ([shape[0], shape[1], shape[0], shape[1], shape[2]] as const);
  return { x1: fx(c[0]), y1: fx(c[1]), x2: fx(c[2]), y2: fx(c[3]), radius: fx(c[4]) };
}

export function hit(spec: HitSpec): HitDef {
  return {
    ...capsule(spec.shape),
    start: spec.frames[0],
    end: spec.frames[1],
    group: spec.group ?? 0,
    damage: fx(spec.damage),
    angle: spec.angle,
    baseKnockback: fx(spec.base),
    knockbackGrowth: fx(spec.growth),
  };
}

/** Options d'un coup, en unités de jeu. Voir `MoveDef` dans `sim-core` pour leur sens exact. */
export interface MoveSpec {
  readonly cancels?: readonly CancelDef[];
  readonly charge?: {
    readonly frame: number;
    readonly maxFrames: number;
    readonly maxScale: number;
  };
  readonly spawn?: {
    readonly frame: number;
    /** Projectile du personnage, numéroté à partir de 1 dans `Character.entities`. */
    readonly kind: number;
    readonly x: number;
    readonly y: number;
    readonly velX: number;
    readonly velY: number;
  };
  readonly landingLag?: number;
  readonly motion?: readonly {
    readonly start: number;
    readonly end: number;
    readonly velX?: number;
    readonly velY?: number;
  }[];
  readonly intangible?: readonly [start: number, end: number];
  readonly helpless?: boolean;
  readonly armor?: { readonly start: number; readonly end: number; readonly maxKnockback: number };
  readonly counter?: { readonly start: number; readonly end: number; readonly to: number };
}

export function move(
  name: string,
  totalFrames: number,
  hits: readonly HitSpec[],
  spec: MoveSpec = {},
): MoveDef {
  const def: {
    -readonly [K in keyof MoveDef]: MoveDef[K];
  } = { name, totalFrames, hits: hits.map(hit), cancels: spec.cancels ?? [] };
  if (spec.charge !== undefined)
    def.charge = { ...spec.charge, maxScale: fx(spec.charge.maxScale) };
  if (spec.spawn !== undefined) {
    const s = spec.spawn;
    def.spawn = {
      frame: s.frame,
      kind: s.kind,
      x: fx(s.x),
      y: fx(s.y),
      velX: fx(s.velX),
      velY: fx(s.velY),
    };
  }
  if (spec.landingLag !== undefined) def.landingLag = spec.landingLag;
  if (spec.motion !== undefined) {
    def.motion = spec.motion.map((m) => ({
      start: m.start,
      end: m.end,
      ...(m.velX === undefined ? {} : { velX: fx(m.velX) }),
      ...(m.velY === undefined ? {} : { velY: fx(m.velY) }),
    }));
  }
  if (spec.intangible !== undefined) {
    def.intangible = { start: spec.intangible[0], end: spec.intangible[1] };
  }
  if (spec.helpless !== undefined) def.helpless = spec.helpless;
  if (spec.armor !== undefined)
    def.armor = { ...spec.armor, maxKnockback: fx(spec.armor.maxKnockback) };
  if (spec.counter !== undefined) def.counter = { ...spec.counter };
  return def;
}

/** Tableau des coups indexé par emplacement (`M_*`), de longueur `MOVE_SLOTS`. */
export function moveset(
  entries: readonly (readonly [slot: number, def: MoveDef])[],
): (MoveDef | undefined)[] {
  const moves: (MoveDef | undefined)[] = new Array<MoveDef | undefined>(MOVE_SLOTS).fill(undefined);
  for (const [slot, def] of entries) {
    if (moves[slot] !== undefined) throw new Error(`Emplacement ${slot} rempli deux fois.`);
    moves[slot] = def;
  }
  return moves;
}

export interface ThrowSpec {
  readonly total: number;
  readonly release: number;
  readonly damage: number;
  readonly angle: number;
  readonly base: number;
  readonly growth: number;
}

export function throwDef(spec: ThrowSpec): ThrowDef {
  return {
    totalFrames: spec.total,
    releaseFrame: spec.release,
    damage: fx(spec.damage),
    angle: spec.angle,
    baseKnockback: fx(spec.base),
    knockbackGrowth: fx(spec.growth),
  };
}

/** Esquive : durée totale, intangibilité `[début, fin]`, vitesse de déplacement. */
export function dodge(total: number, inv: readonly [number, number], speed: number): DodgeDef {
  return { totalFrames: total, invStart: inv[0], invEnd: inv[1], speed: fx(speed) };
}

/**
 * Fige un objet et tout ce qu'il contient. Les données d'un personnage ne doivent pas changer
 * pendant un match : deux pairs qui les partagent doivent rester identiques.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** Vrai si l'objet et tout ce qu'il contient sont figés. */
export function isDeepFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  if (!Object.isFrozen(value)) return false;
  for (const key of Object.keys(value)) {
    if (!isDeepFrozen((value as Record<string, unknown>)[key])) return false;
  }
  return true;
}
