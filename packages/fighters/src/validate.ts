/**
 * Validation des données d'un personnage (SPEC-fighters.md, « Règles de validation »).
 *
 * Chaque problème nomme le champ fautif par un chemin lisible (`def.moves[M_JAB] « jab ».hits[0]`)
 * et dit ce qui était attendu. Les calculs flottants faits ici (distances) ne servent qu'au
 * diagnostic : rien n'en revient dans la simulation.
 */
import {
  FX_ONE,
  MOVE_SLOTS,
  M_ULTIMATE,
  fxToFloat,
  type CapsuleDef,
  type DodgeDef,
  type EntityDef,
  type FighterDef,
  type HitDef,
  type MoveDef,
} from '@game/sim-core';
import { isDeepFrozen } from './build.ts';
import type { Character, FighterLook } from './character.ts';
import { AERIAL_SLOTS, REQUIRED_SLOTS, SLOTS } from './slots.ts';

export interface Issue {
  /** Identifiant du personnage. */
  readonly character: string;
  /** Chemin du champ fautif dans le personnage. */
  readonly path: string;
  readonly message: string;
}

export function formatIssue(issue: Issue): string {
  return `${issue.character} › ${issue.path} : ${issue.message}`;
}

/** Portée maximale d'une extrémité de hitbox, en hauteurs du personnage, depuis ses pieds. */
const MAX_REACH = 2.5;
const MAX_HIT_DAMAGE = 60;
/** Bornes des proportions du mannequin. */
const MAX_BUILD = 4;

/** Valeurs de mouvement qui doivent être strictement positives (grandeurs en virgule fixe). */
const POSITIVE_UNITS: readonly (keyof FighterDef)[] = [
  'weight',
  'shieldMax',
  'halfWidth',
  'height',
  'walkSpeed',
  'walkAccel',
  'friction',
  'dashSpeed',
  'runSpeed',
  'runAccel',
  'jumpVelocity',
  'shortHopVelocity',
  'doubleJumpVelocity',
  'airSpeed',
  'airAccel',
  'airFriction',
  'gravity',
  'maxFallSpeed',
  'fastFallSpeed',
  'ledgeRollDistance',
];
/** Durées qui doivent valoir au moins une frame. */
const POSITIVE_FRAMES: readonly (keyof FighterDef)[] = [
  'dashFrames',
  'brakeFrames',
  'turnFrames',
  'jumpSquatFrames',
  'techFrames',
  'downFrames',
  'ledgeGetupFrames',
  'ledgeRollFrames',
];
/** Durées et nombres qui peuvent valoir zéro. */
const NON_NEGATIVE: readonly (keyof FighterDef)[] = [
  'landFrames',
  'airDodgeLandingLag',
  'airJumps',
];

class Collector {
  readonly issues: Issue[] = [];
  private readonly character: string;

  constructor(character: string) {
    this.character = character;
  }

  add(path: string, message: string): void {
    this.issues.push({ character: this.character, path, message });
  }

  atLeast(path: string, value: number, min: number, what = String(min)): void {
    if (value < min) this.add(path, `doit être au moins ${what} (reçu ${value})`);
  }

  atMost(path: string, value: number, max: number, what = String(max)): void {
    if (value > max) this.add(path, `doit être au plus ${what} (reçu ${value})`);
  }

  positive(path: string, value: number): void {
    if (!(value > 0)) this.add(path, `doit être strictement positif (reçu ${value})`);
  }

  /** Fenêtre `[start, end]` dans une action de `total` frames. */
  window(path: string, start: number, end: number, total: number): void {
    this.atLeast(`${path}.start`, start, 1);
    this.atLeast(`${path}.end`, end, start, `start (${start})`);
    this.atMost(`${path}.end`, end, total, `totalFrames (${total})`);
  }
}

/** Chaque nombre doit être un entier fini : virgule fixe exacte, frames entières. */
function checkIntegers(col: Collector, value: unknown, path: string, skip?: string): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      col.add(path, `doit être un entier fini (reçu ${value})`);
    }
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => checkIntegers(col, v, `${path}[${i}]`));
    return;
  }
  for (const [key, v] of Object.entries(value)) {
    if (key !== skip) checkIntegers(col, v, path === '' ? key : `${path}.${key}`);
  }
}

const movePath = (slot: number, move: MoveDef): string =>
  `def.moves[${SLOTS[slot]?.code ?? `#${slot}`}] « ${move.name} »`;

function checkCapsuleReach(col: Collector, path: string, c: CapsuleDef, height: number): void {
  col.positive(`${path}.radius`, c.radius);
  const reach = MAX_REACH * fxToFloat(height);
  for (const [x, y] of [
    [c.x1, c.y1],
    [c.x2, c.y2],
  ] as const) {
    const d = Math.hypot(fxToFloat(x), fxToFloat(y));
    if (d > reach) {
      col.add(path, `extrémité à ${d.toFixed(1)} unités des pieds, au-delà de ${reach.toFixed(1)}`);
    }
  }
}

function checkHit(col: Collector, path: string, h: HitDef, total: number, height: number): void {
  col.window(path, h.start, h.end, total);
  checkCapsuleReach(col, path, h, height);
  col.atLeast(`${path}.group`, h.group, 0);
  col.atMost(`${path}.group`, h.group, 3);
  col.atLeast(`${path}.angle`, h.angle, 0);
  col.atMost(`${path}.angle`, h.angle, 360);
  col.atLeast(`${path}.damage`, fxToFloat(h.damage), 0);
  col.atMost(`${path}.damage`, fxToFloat(h.damage), MAX_HIT_DAMAGE);
  col.atLeast(`${path}.baseKnockback`, fxToFloat(h.baseKnockback), 0);
  col.atLeast(`${path}.knockbackGrowth`, fxToFloat(h.knockbackGrowth), 0);
}

function checkMove(col: Collector, c: Character, slot: number, move: MoveDef): void {
  const def = c.def;
  const path = movePath(slot, move);
  const total = move.totalFrames;
  col.atLeast(`${path}.totalFrames`, total, 1);
  move.hits.forEach((h, k) => checkHit(col, `${path}.hits[${k}]`, h, total, def.height));

  move.cancels.forEach((cancel, k) => {
    const p = `${path}.cancels[${k}]`;
    col.window(p, cancel.start, cancel.end, total);
    if (def.moves[cancel.to] === undefined)
      col.add(`${p}.to`, `renvoie à un emplacement vide (${cancel.to})`);
    if (!(cancel.on >= 0 && cancel.on < MOVE_SLOTS))
      col.add(`${p}.on`, `emplacement inconnu (${cancel.on})`);
  });

  const firstHit = move.hits.reduce((min, h) => Math.min(min, h.start), Infinity);
  if (move.charge !== undefined) {
    const p = `${path}.charge`;
    col.atLeast(`${p}.frame`, move.charge.frame, 1);
    if (move.charge.frame >= firstHit) {
      col.add(
        `${p}.frame`,
        `doit précéder la première hitbox (frame ${firstHit}) (reçu ${move.charge.frame})`,
      );
    }
    col.atLeast(`${p}.maxFrames`, move.charge.maxFrames, 1);
    col.atLeast(`${p}.maxScale`, move.charge.maxScale, FX_ONE, 'fx(1)');
  }

  if (move.spawn !== undefined) {
    const p = `${path}.spawn`;
    col.atLeast(`${p}.frame`, move.spawn.frame, 1);
    col.atMost(`${p}.frame`, move.spawn.frame, total, `totalFrames (${total})`);
    if (move.charge !== undefined && move.spawn.frame === move.charge.frame) {
      col.add(`${p}.frame`, `ne doit pas être la frame de charge (${move.charge.frame})`);
    }
    if (!(move.spawn.kind >= 1 && move.spawn.kind <= c.entities.length)) {
      col.add(
        `${p}.kind`,
        `projectile inconnu (${move.spawn.kind}) : le personnage en a ${c.entities.length}`,
      );
    }
  }

  if (move.landingLag !== undefined) col.atLeast(`${path}.landingLag`, move.landingLag, 0);
  move.motion?.forEach((m, k) => col.window(`${path}.motion[${k}]`, m.start, m.end, total));
  if (move.intangible !== undefined) {
    col.window(`${path}.intangible`, move.intangible.start, move.intangible.end, total);
  }
  if (move.armor !== undefined) {
    col.window(`${path}.armor`, move.armor.start, move.armor.end, total);
    col.atLeast(`${path}.armor.maxKnockback`, move.armor.maxKnockback, 0);
  }
  if (move.counter !== undefined) {
    const p = `${path}.counter`;
    col.window(p, move.counter.start, move.counter.end, total);
    if (move.counter.to === slot || def.moves[move.counter.to] === undefined) {
      col.add(`${p}.to`, `renvoie à un emplacement vide ou à lui-même (${move.counter.to})`);
    }
  }
}

function checkDodge(col: Collector, path: string, d: DodgeDef): void {
  col.atLeast(`${path}.totalFrames`, d.totalFrames, 1);
  col.atLeast(`${path}.invStart`, d.invStart, 1);
  col.atLeast(`${path}.invEnd`, d.invEnd, d.invStart, `invStart (${d.invStart})`);
  col.atMost(`${path}.invEnd`, d.invEnd, d.totalFrames, `totalFrames (${d.totalFrames})`);
  col.atLeast(`${path}.speed`, d.speed, 0);
}

function checkEntity(col: Collector, path: string, e: EntityDef): void {
  col.positive(`${path}.radius`, e.radius);
  col.atLeast(`${path}.lifetime`, e.lifetime, 1);
  col.atLeast(`${path}.stageCollision`, e.stageCollision, 0);
  col.atMost(`${path}.stageCollision`, e.stageCollision, 2);
  if (e.hit !== undefined) {
    col.atLeast(`${path}.hit.damage`, fxToFloat(e.hit.damage), 0);
    col.atMost(`${path}.hit.damage`, fxToFloat(e.hit.damage), MAX_HIT_DAMAGE);
    col.atLeast(`${path}.hit.angle`, e.hit.angle, 0);
    col.atMost(`${path}.hit.angle`, e.hit.angle, 360);
    col.atLeast(`${path}.hit.baseKnockback`, e.hit.baseKnockback, 0);
    col.atLeast(`${path}.hit.knockbackGrowth`, e.hit.knockbackGrowth, 0);
  }
}

function checkColor(col: Collector, path: string, color: unknown): void {
  if (color === 'primary' || color === 'secondary' || color === 'player') return;
  if (typeof color !== 'number' || !(color >= 0 && color <= 0xffffff)) {
    col.add(path, `couleur attendue entre 0x000000 et 0xFFFFFF (reçu ${String(color)})`);
  }
}

function checkLook(col: Collector, look: FighterLook): void {
  checkColor(col, 'look.primary', look.primary);
  checkColor(col, 'look.secondary', look.secondary);
  for (const [key, value] of Object.entries(look.build)) {
    if (!(value > 0 && value <= MAX_BUILD)) {
      col.add(`look.build.${key}`, `proportion attendue dans ]0, ${MAX_BUILD}] (reçu ${value})`);
    }
  }
  look.parts.forEach((part, k) => {
    const p = `look.parts[${k}]`;
    col.positive(`${p}.width`, part.width);
    col.positive(`${p}.height`, part.height);
    col.positive(`${p}.depth`, part.depth);
    for (const key of ['x', 'y', 'z', 'angle'] as const) {
      if (!Number.isFinite(part[key]))
        col.add(`${p}.${key}`, `doit être un nombre fini (reçu ${part[key]})`);
    }
    checkColor(col, `${p}.color`, part.color);
  });
}

/** Problèmes trouvés dans les données de `c` ; liste vide si elles sont valides. */
export function validateCharacter(c: Character): Issue[] {
  const col = new Collector(c.id);
  const def = c.def;

  if (!isDeepFrozen(c)) col.add('', 'les données doivent être figées en profondeur');

  // Rien de non fini.
  checkIntegers(col, def, 'def', 'moves');
  def.moves.forEach((move, slot) => {
    if (move !== undefined) checkIntegers(col, move, movePath(slot, move));
  });
  c.entities.forEach((e, k) => checkIntegers(col, e, `entities[${k}] « ${e.name} »`));

  // Moveset complet.
  for (const slot of REQUIRED_SLOTS) {
    if (def.moves[slot] === undefined)
      col.add(`def.moves[${SLOTS[slot]!.code}]`, 'emplacement vide');
  }
  if (def.moves.length > MOVE_SLOTS) col.add('def.moves', `au plus ${MOVE_SLOTS} emplacements`);
  for (const slot of AERIAL_SLOTS) {
    const move = def.moves[slot];
    if (move !== undefined && move.landingLag === undefined) {
      col.add(
        `${movePath(slot, move)}.landingLag`,
        'une aérienne doit avoir un lag d’atterrissage',
      );
    }
  }
  const ultimate = def.moves[M_ULTIMATE];
  if (ultimate !== undefined && ultimate.intangible === undefined) {
    col.add(
      `${movePath(M_ULTIMATE, ultimate)}.intangible`,
      'l’ultime doit avoir une fenêtre d’invincibilité',
    );
  }

  // Frames cohérentes et hitbox dans des bornes, coup par coup.
  def.moves.forEach((move, slot) => {
    if (move !== undefined) checkMove(col, c, slot, move);
  });

  def.hurtboxes.forEach((box, k) => {
    const p = `def.hurtboxes[${k}]`;
    col.positive(`${p}.radius`, box.radius);
    const low = Math.min(box.y1, box.y2) - box.radius;
    const high = Math.max(box.y1, box.y2) + box.radius;
    if (low < 0 || high > def.height) {
      col.add(
        p,
        `doit tenir entre les pieds et la tête (0 à ${fxToFloat(def.height)}) (reçu ${fxToFloat(low)} à ${fxToFloat(high)})`,
      );
    }
  });
  if (def.hurtboxes.length === 0) col.add('def.hurtboxes', 'au moins une hurtbox');

  checkDodge(col, 'def.spotDodge', def.spotDodge);
  checkDodge(col, 'def.roll', def.roll);
  checkDodge(col, 'def.airDodge', def.airDodge);

  const grab = def.grab;
  col.window('def.grab', grab.start, grab.end, grab.totalFrames);
  checkCapsuleReach(col, 'def.grab.box', grab.box, def.height);
  col.positive('def.grab.holdX', grab.holdX);
  col.atLeast('def.grab.pummelDamage', grab.pummelDamage, 0);
  col.atLeast('def.grab.pummelFrames', grab.pummelFrames, 1);
  def.throws.forEach((t, k) => {
    const p = `def.throws[${k}]`;
    col.atLeast(`${p}.releaseFrame`, t.releaseFrame, 1);
    col.atMost(
      `${p}.releaseFrame`,
      t.releaseFrame,
      t.totalFrames,
      `totalFrames (${t.totalFrames})`,
    );
    col.atLeast(`${p}.damage`, t.damage, 0);
    col.atLeast(`${p}.angle`, t.angle, 0);
    col.atMost(`${p}.angle`, t.angle, 360);
    col.atLeast(`${p}.baseKnockback`, t.baseKnockback, 0);
    col.atLeast(`${p}.knockbackGrowth`, t.knockbackGrowth, 0);
  });

  // Mouvement plausible.
  for (const key of POSITIVE_UNITS) col.positive(`def.${key}`, def[key] as number);
  for (const key of POSITIVE_FRAMES) col.atLeast(`def.${key}`, def[key] as number, 1);
  for (const key of NON_NEGATIVE) col.atLeast(`def.${key}`, def[key] as number, 0);
  if (def.shortHopVelocity >= def.jumpVelocity) {
    col.add('def.shortHopVelocity', 'le petit saut doit être moins haut que le grand');
  }
  if (def.fastFallSpeed <= def.maxFallSpeed) {
    col.add('def.fastFallSpeed', 'la chute rapide doit être plus rapide que la chute maximale');
  }
  if (def.runSpeed < def.walkSpeed)
    col.add('def.runSpeed', 'la course doit être au moins aussi rapide que la marche');

  c.entities.forEach((e, k) => checkEntity(col, `entities[${k}] « ${e.name} »`, e));
  checkLook(col, c.look);
  return col.issues;
}
