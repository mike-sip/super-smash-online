/**
 * Lecture des coups d'un combattant (SPEC-finition.md, phase 6) : portée, démarrage et puissance
 * de chaque emplacement, tirés de ses données frame par frame (les mêmes que la simulation). Le
 * bot choisit ses coups d'après ces chiffres, comme un joueur qui connaît son personnage.
 * Logique pure.
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
  M_NAIR,
  M_NSPECIAL,
  M_SSPECIAL,
  M_UAIR,
  M_USMASH,
  M_USPECIAL,
  M_ULTIMATE,
  M_UTILT,
  fxToFloat,
  type FighterDef,
} from '@game/sim-core';

/** Comment le coup se lance : au sol, en l'air, ou spécial (au sol comme en l'air). */
export type MoveKind = 'ground' | 'air' | 'special';

export interface MoveInfo {
  readonly slot: number;
  readonly kind: MoveKind;
  /** Première frame active. */
  readonly startup: number;
  /** Dernière frame active et durée totale. */
  readonly activeEnd: number;
  readonly total: number;
  /** Boîte couverte par ses coups, dans le repère du combattant tourné vers la droite. */
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  /** Dégâts du coup le plus fort, et sa puissance d'éjection à 100 % de dégâts. */
  readonly damage: number;
  readonly power: number;
  /** Lance un projectile : utile de loin. */
  readonly projectile: boolean;
  /** Smash : à garder pour finir. */
  readonly smash: boolean;
  /** Distance horizontale parcourue par l'élan propre du coup, vers l'avant (unités de jeu). */
  readonly travel: number;
}

/** Emplacements que le bot sait lancer, et leur genre. */
const SLOTS: readonly (readonly [number, MoveKind])[] = [
  [M_JAB, 'ground'],
  [M_FTILT, 'ground'],
  [M_UTILT, 'ground'],
  [M_DTILT, 'ground'],
  [M_DASH_ATTACK, 'ground'],
  [M_FSMASH, 'ground'],
  [M_USMASH, 'ground'],
  [M_DSMASH, 'ground'],
  [M_NAIR, 'air'],
  [M_FAIR, 'air'],
  [M_BAIR, 'air'],
  [M_UAIR, 'air'],
  [M_DAIR, 'air'],
  [M_NSPECIAL, 'special'],
  [M_SSPECIAL, 'special'],
  [M_DSPECIAL, 'special'],
];

/** Attaque ultime du combattant (portée, démarrage), ou `null` s'il n'en a pas. */
export function analyzeUltimate(def: FighterDef): MoveInfo | null {
  return analyzeSlots(def, [[M_ULTIMATE, 'special']])[0] ?? null;
}

/** Coups d'un combattant, emplacements absents écartés. La remontée (spécial haut) est à part. */
export function analyzeMoves(def: FighterDef): MoveInfo[] {
  return analyzeSlots(def, SLOTS);
}

function analyzeSlots(
  def: FighterDef,
  slots: readonly (readonly [number, MoveKind])[],
): MoveInfo[] {
  const out: MoveInfo[] = [];
  for (const [slot, kind] of slots) {
    const move = def.moves[slot];
    if (move === undefined) continue;
    const projectile = move.spawn !== undefined;
    if (move.hits.length === 0 && !projectile) continue;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let startup = Infinity;
    let activeEnd = 0;
    let damage = 0;
    let power = 0;
    for (const h of move.hits) {
      const r = fxToFloat(h.radius);
      const x1 = fxToFloat(h.x1);
      const x2 = fxToFloat(h.x2);
      const y1 = fxToFloat(h.y1);
      const y2 = fxToFloat(h.y2);
      minX = Math.min(minX, x1 - r, x2 - r);
      maxX = Math.max(maxX, x1 + r, x2 + r);
      minY = Math.min(minY, y1 - r, y2 - r);
      maxY = Math.max(maxY, y1 + r, y2 + r);
      startup = Math.min(startup, h.start);
      activeEnd = Math.max(activeEnd, h.end);
      damage = Math.max(damage, fxToFloat(h.damage));
      power = Math.max(power, fxToFloat(h.baseKnockback) + fxToFloat(h.knockbackGrowth) * 100);
    }
    if (projectile) {
      // Projectile : il porte loin devant, à hauteur de buste.
      const height = fxToFloat(def.height);
      minX = Math.min(minX, 0);
      maxX = Math.max(maxX, 90);
      minY = Math.min(minY, height * 0.2);
      maxY = Math.max(maxY, height * 0.9);
      startup = Math.min(startup, move.spawn!.frame);
      activeEnd = Math.max(activeEnd, move.spawn!.frame);
      damage = Math.max(damage, 6);
    }
    // Élan propre : somme de la vitesse sur chaque fenêtre (frames incluses).
    let travel = 0;
    for (const w of move.motion ?? []) {
      travel += fxToFloat(w.velX ?? 0) * (w.end - w.start + 1);
    }
    out.push({
      travel,
      slot,
      kind,
      startup,
      activeEnd,
      total: move.totalFrames,
      minX,
      maxX,
      minY,
      maxY,
      damage,
      power,
      projectile,
      smash: slot === M_FSMASH || slot === M_USMASH || slot === M_DSMASH,
    });
  }
  return out;
}

/** Vrai si le combattant a une remontée (spécial haut). */
export const hasRecovery = (def: FighterDef): boolean => def.moves[M_USPECIAL] !== undefined;

/**
 * Hauteur gagnée par la remontée (spécial haut), d'après son élan propre ; 25 unités par défaut
 * (élan donné par un autre mécanisme).
 */
export function recoveryRise(def: FighterDef): number {
  const move = def.moves[M_USPECIAL];
  if (move === undefined) return 0;
  let rise = 0;
  for (const w of move.motion ?? []) rise += fxToFloat(w.velY ?? 0) * (w.end - w.start + 1);
  return rise > 0 ? rise : 25;
}
