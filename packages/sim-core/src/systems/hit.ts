/**
 * Détection des coups.
 *
 * Deux passes : d'abord on relève tous les contacts de la frame, ensuite on les applique.
 * Ainsi, quand deux joueurs se frappent à la même frame, les deux coups portent, quel que soit
 * l'ordre des joueurs.
 */
import { A_ATTACK, A_DEAD } from '../actions.ts';
import type { CapsuleDef, FighterDef, HitDef } from '../defs.ts';
import { EV_HIT, emit } from '../events.ts';
import { FX_ONE, fxMul } from '../fixed.ts';
import { capsulesOverlap } from '../geometry.ts';
import { G_PLAYERS, MAX_PLAYERS, type SimState } from '../state.ts';
import type { Sim } from '../step.ts';
import { applyHit, hitlagFrames, knockback } from './knockback.ts';

/** Tableaux de travail d'une frame. Hors de l'état : entièrement recalculés à chaque `step`. */
export interface HitScratch {
  /** 1 si le joueur est gelé par le hitlag à cette frame. */
  readonly frozen: Uint8Array;
  readonly damage: Int32Array;
  /** Plus forte éjection reçue à cette frame, ou -1 si le joueur n'a pas été touché. */
  readonly kb: Int32Array;
  readonly angle: Int32Array;
  readonly targetLag: Int32Array;
  readonly attackerLag: Int32Array;
}

export function createHitScratch(): HitScratch {
  return {
    frozen: new Uint8Array(MAX_PLAYERS),
    damage: new Int32Array(MAX_PLAYERS),
    kb: new Int32Array(MAX_PLAYERS),
    angle: new Int32Array(MAX_PLAYERS),
    targetLag: new Int32Array(MAX_PLAYERS),
    attackerLag: new Int32Array(MAX_PLAYERS),
  };
}

/** Vrai si la hitbox de l'attaquant `i` touche une hurtbox de `j`. */
function touches(s: SimState, i: number, hit: HitDef, j: number, target: FighterDef): boolean {
  const facing = s.facing[i]!;
  const ax = s.posX[i]!;
  const ay = s.posY[i]!;
  const h1x = ax + facing * hit.x1;
  const h1y = ay + hit.y1;
  const h2x = ax + facing * hit.x2;
  const h2y = ay + hit.y2;

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
        hit.radius,
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

export function resolveHits(sim: Sim): void {
  const s = sim.state;
  const fighters = sim.config.fighters;
  const sc = sim.scratch;
  const players = s.g[G_PLAYERS]!;

  for (let j = 0; j < players; j++) {
    sc.damage[j] = 0;
    sc.kb[j] = -1;
    sc.attackerLag[j] = 0;
  }

  // Passe 1 : relever les contacts.
  for (let i = 0; i < players; i++) {
    if (s.action[i] !== A_ATTACK || sc.frozen[i] === 1) continue;
    const move = fighters[i]!.moves[s.move[i]!]!;
    const hits = move.hits;
    const moveFrame = s.actionFrame[i]! + 1;
    const facing = s.facing[i]!;

    for (let j = 0; j < players; j++) {
      if (j === i || s.action[j] === A_DEAD) continue;
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
        }
        if (lag > sc.attackerLag[i]!) sc.attackerLag[i] = lag;
        emit(sim.events, EV_HIT, i, j);
        // Les hitbox sont listées par priorité : la première qui touche l'emporte.
        break;
      }
    }
  }

  // Passe 2 : appliquer.
  for (let j = 0; j < players; j++) {
    if (sc.kb[j]! >= 0) {
      applyHit(sim, j, sc.damage[j]!, sc.kb[j]!, sc.angle[j]!, sc.targetLag[j]!);
    }
  }
  for (let i = 0; i < players; i++) {
    if (sc.attackerLag[i]! > s.hitlag[i]!) s.hitlag[i] = sc.attackerLag[i]!;
  }
}
