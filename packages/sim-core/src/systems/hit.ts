/**
 * Détection des coups.
 *
 * Deux passes : d'abord on relève tous les contacts de la frame, ensuite on les applique.
 * Ainsi, quand deux joueurs se frappent à la même frame, les deux coups portent, quel que soit
 * l'ordre des joueurs.
 */
import { A_ATTACK, A_DEAD, A_ITEM_SWING } from '../actions.ts';
import type { CapsuleDef, FighterDef } from '../defs.ts';
import { EV_HIT, EV_PARRY, EV_SHIELD, emit } from '../events.ts';
import { FX_ONE, fxMul } from '../fixed.ts';
import { capsulesOverlap } from '../geometry.ts';
import { G_PLAYERS, MAX_ENTITIES, MAX_PLAYERS, type SimState } from '../state.ts';
import type { Sim } from '../step.ts';
import { PARRY_ATTACKER_LAG, blockHit, isParrying, isShielding, parryHit } from './defense.ts';
import { ITEM_MODE_THROWN, heldSwing, itemHitFighter } from './items.ts';
import { applyHit, hitlagFrames, knockback } from './knockback.ts';

/** Tableaux de travail d'une frame. Hors de l'état : entièrement recalculés à chaque `step`. */
export interface HitScratch {
  /** Attaquants ayant touché ce joueur à cette frame, un bit par attaquant. */
  readonly hitBy: Int32Array;
  /** Sens du recul infligé par le coup retenu : 1 vers la droite, -1 vers la gauche. */
  readonly pushDir: Int32Array;
  /** 1 si le joueur est gelé par le hitlag à cette frame. */
  readonly frozen: Uint8Array;
  readonly damage: Int32Array;
  /** Plus forte éjection reçue à cette frame, ou -1 si le joueur n'a pas été touché. */
  readonly kb: Int32Array;
  readonly angle: Int32Array;
  readonly targetLag: Int32Array;
  readonly attackerLag: Int32Array;
  /** Touché par une entité à cette frame : index de son propriétaire + 1, 0 sinon, -1 sans propriétaire. */
  readonly byEntity: Int32Array;
  /** Cible visée par la saisie de chaque joueur à cette frame, ou -1. */
  readonly grabWant: Int32Array;
}

export function createHitScratch(): HitScratch {
  return {
    hitBy: new Int32Array(MAX_PLAYERS),
    pushDir: new Int32Array(MAX_PLAYERS),
    frozen: new Uint8Array(MAX_PLAYERS),
    damage: new Int32Array(MAX_PLAYERS),
    kb: new Int32Array(MAX_PLAYERS),
    angle: new Int32Array(MAX_PLAYERS),
    targetLag: new Int32Array(MAX_PLAYERS),
    attackerLag: new Int32Array(MAX_PLAYERS),
    byEntity: new Int32Array(MAX_PLAYERS),
    grabWant: new Int32Array(MAX_PLAYERS),
  };
}

/** Vrai si la capsule `hit`, portée par le joueur `i`, touche une hurtbox de `j`. */
/** Vrai si la capsule donnée, en coordonnées du terrain, touche une hurtbox de `j`. */
export function overlapsHurtboxes(
  s: SimState,
  j: number,
  target: FighterDef,
  h1x: number,
  h1y: number,
  h2x: number,
  h2y: number,
  radius: number,
): boolean {
  const tFacing = s.facing[j]!;
  const tx = s.posX[j]!;
  const ty = s.posY[j]!;
  const boxes: readonly CapsuleDef[] = target.hurtboxes;
  for (let b = 0; b < boxes.length; b++) {
    const box = boxes[b]!;
    if (
      capsulesOverlap(
        h1x,
        h1y,
        h2x,
        h2y,
        radius,
        tx + tFacing * box.x1,
        ty + box.y1,
        tx + tFacing * box.x2,
        ty + box.y2,
        box.radius,
      )
    ) {
      return true;
    }
  }
  return false;
}

export function touches(
  s: SimState,
  i: number,
  hit: CapsuleDef,
  j: number,
  target: FighterDef,
): boolean {
  const facing = s.facing[i]!;
  const ax = s.posX[i]!;
  const ay = s.posY[i]!;
  return overlapsHurtboxes(
    s,
    j,
    target,
    ax + facing * hit.x1,
    ay + hit.y1,
    ax + facing * hit.x2,
    ay + hit.y2,
    hit.radius,
  );
}

export function resolveHits(sim: Sim): void {
  const s = sim.state;
  const fighters = sim.config.fighters;
  const sc = sim.scratch;
  const players = s.g[G_PLAYERS]!;
  const team = sim.team;
  const allies = !sim.teamAttack;

  for (let j = 0; j < players; j++) {
    sc.damage[j] = 0;
    sc.kb[j] = -1;
    sc.hitBy[j] = 0;
    sc.byEntity[j] = 0;
    sc.attackerLag[j] = 0;
  }

  // Passe 1 : relever les contacts.
  for (let i = 0; i < players; i++) {
    if (sc.frozen[i] === 1) continue;
    const action = s.action[i]!;
    // Une attaque, ou le coup de l'objet à frapper tenu (module stages-items).
    const move =
      action === A_ATTACK
        ? fighters[i]!.moves[s.move[i]!]!
        : action === A_ITEM_SWING
          ? heldSwing(sim, i)
          : undefined;
    if (move === undefined) continue;
    const hits = move.hits;
    const moveFrame = s.actionFrame[i]! + 1;
    const facing = s.facing[i]!;

    for (let j = 0; j < players; j++) {
      if (j === i || s.action[j] === A_DEAD || s.intangible[j]! > 0 || s.invincible[j]! > 0) {
        continue;
      }
      if (allies && team[i] === team[j]) continue;
      for (let h = 0; h < hits.length; h++) {
        const hit = hits[h]!;
        if (moveFrame < hit.start || moveFrame > hit.end) continue;
        const bit = 1 << (hit.group * MAX_PLAYERS + j);
        if ((s.hitMask[i]! & bit) !== 0) continue;
        if (!touches(s, i, hit, j, fighters[j]!)) continue;

        s.hitMask[i] = s.hitMask[i]! | bit;
        s.connected[i] = 1;

        let damage: number = hit.damage;
        const charge = move.charge;
        if (charge !== undefined && s.charge[i]! > 0) {
          const bonus = (((charge.maxScale - FX_ONE) * s.charge[i]!) / charge.maxFrames) | 0;
          damage = fxMul(damage, FX_ONE + bonus);
        }
        const kb = knockback(
          s.damage[j]! + damage,
          damage,
          fighters[j]!.weight,
          hit.baseKnockback,
          hit.knockbackGrowth,
        );
        const lag = hitlagFrames(damage);

        // Frappé par plusieurs attaquants : les dégâts s'additionnent, la plus forte éjection
        // l'emporte, et à égalité le premier attaquant par index (comparaison stricte).
        sc.damage[j] = sc.damage[j]! + damage;
        if (kb > sc.kb[j]!) {
          sc.kb[j] = kb;
          sc.angle[j] = facing === 1 ? hit.angle : 180 - hit.angle;
          sc.targetLag[j] = lag;
          sc.pushDir[j] = facing;
        }
        if (lag > sc.attackerLag[i]!) sc.attackerLag[i] = lag;
        sc.hitBy[j] = sc.hitBy[j]! | (1 << i);
        // Les hitbox sont listées par priorité : la première qui touche l'emporte.
        break;
      }
    }
  }

  // Passe 1 bis : entités. Elles frappent comme une attaque, sans gel pour leur propriétaire.
  for (let e = 0; e < MAX_ENTITIES; e++) {
    const kind = s.eKind[e]!;
    if (kind === 0) continue;
    const def = sim.entityDefs[kind - 1]!;
    const hit = def.hit;
    if (hit === undefined) continue;
    // Un objet ne frappe que lancé.
    if (def.item !== undefined && s.eMode[e] !== ITEM_MODE_THROWN) continue;
    const owner = s.eOwner[e]! - 1;
    const ex = s.ePosX[e]!;
    const ey = s.ePosY[e]!;
    // Capsule verticale pour une entité qui a une hauteur (jet de geyser), cercle sinon.
    const eyTop = def.height ?? 0;
    const dir = s.eVelX[e]! >= 0 ? 1 : -1;

    for (let j = 0; j < players; j++) {
      if (j === owner || s.action[j] === A_DEAD || s.intangible[j]! > 0 || s.invincible[j]! > 0) {
        continue;
      }
      if (allies && owner >= 0 && team[owner] === team[j]) continue;
      const bit = 1 << j;
      if ((s.eHitMask[e]! & bit) !== 0) continue;
      if (!overlapsHurtboxes(s, j, fighters[j]!, ex, ey, ex, ey + eyTop, def.radius)) continue;

      s.eHitMask[e] = s.eHitMask[e]! | bit;
      const kb = knockback(
        s.damage[j]! + hit.damage,
        hit.damage,
        fighters[j]!.weight,
        hit.baseKnockback,
        hit.knockbackGrowth,
      );
      sc.damage[j] = sc.damage[j]! + hit.damage;
      if (kb > sc.kb[j]!) {
        sc.kb[j] = kb;
        sc.angle[j] = dir === 1 ? hit.angle : 180 - hit.angle;
        sc.targetLag[j] = hitlagFrames(hit.damage);
        sc.pushDir[j] = dir;
      }
      sc.byEntity[j] = owner >= 0 ? owner + 1 : -1;
      if (def.item !== undefined) {
        itemHitFighter(sim, e);
        break;
      }
      if (def.destroyOnHit) {
        s.eKind[e] = 0;
        break;
      }
    }
  }

  // Passe 2 : appliquer.
  for (let j = 0; j < players; j++) {
    if (sc.kb[j]! < 0) continue;
    let outcome = EV_HIT;
    if (isShielding(s.action[j]!)) {
      outcome = EV_SHIELD;
      blockHit(sim, j, sc.damage[j]!, sc.targetLag[j]!, sc.pushDir[j]!);
    } else if (isParrying(sim, j)) {
      outcome = EV_PARRY;
      parryHit(sim, j);
    } else {
      applyHit(sim, j, sc.damage[j]!, sc.kb[j]!, sc.angle[j]!, sc.targetLag[j]!);
    }
    const by = sc.hitBy[j]!;
    for (let i = 0; i < players; i++) {
      if ((by & (1 << i)) === 0) continue;
      emit(sim.events, outcome, i, j);
      // Un attaquant paré reste gelé plus longtemps : c'est l'ouverture offerte au défenseur.
      if (outcome === EV_PARRY) sc.attackerLag[i] = sc.attackerLag[i]! + PARRY_ATTACKER_LAG;
    }
    const entityOwner = sc.byEntity[j]!;
    if (entityOwner !== 0) emit(sim.events, outcome, entityOwner > 0 ? entityOwner - 1 : -1, j);
  }
  for (let i = 0; i < players; i++) {
    if (sc.attackerLag[i]! > s.hitlag[i]!) s.hitlag[i] = sc.attackerLag[i]!;
  }
}
