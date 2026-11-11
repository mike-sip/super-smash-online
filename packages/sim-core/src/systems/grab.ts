/**
 * Saisies et projections.
 *
 * Une saisie ignore le bouclier : c'est sa raison d'être. Elle ne touche pas un combattant
 * intangible, ni quelqu'un qui tient ou subit déjà une saisie.
 */
import {
  A_AIR,
  A_DEAD,
  A_GRAB,
  A_GRABBED,
  A_GRABBING,
  A_GRAB_RELEASE,
  A_IDLE,
  A_THROW,
  setAction,
} from '../actions.ts';
import { EV_GRAB, EV_HIT, emit } from '../events.ts';
import { FX_SHIFT, fx } from '../fixed.ts';
import { inputStickX, inputStickY } from '../input.ts';
import { G_PLAYERS, type SimState } from '../state.ts';
import type { Sim } from '../step.ts';
import { touches } from './hit.ts';
import { applyHit, knockback } from './knockback.ts';
import { updateMovement } from './movement.ts';
import { approach } from './util.ts';

export const THROW_FORWARD = 0;
export const THROW_BACK = 1;
export const THROW_UP = 2;
export const THROW_DOWN = 3;

/** Durée de prise à 0 %, puis une demi-frame de plus par point de dégâts de la victime. */
export const GRAB_HOLD_BASE_FRAMES = 60;
export const GRAB_HOLD_MAX_FRAMES = 180;
/** Frames retirées à la prise par chaque appui de la victime qui se débat. */
export const GRAB_MASH_FRAMES = 6;
export const GRAB_RELEASE_FRAMES = 20;
const GRAB_RELEASE_PUSH = fx(1);
const STICK_THROW = 64;

/** Sépare les deux combattants : chacun recule, sans dégâts. */
function releasePair(s: SimState, grabber: number, target: number): void {
  const facing = s.facing[grabber]!;
  s.grabTarget[grabber] = 0;
  s.grabbedBy[target] = 0;
  s.velX[grabber] = -facing * GRAB_RELEASE_PUSH;
  s.velX[target] = facing * GRAB_RELEASE_PUSH;
  setAction(s, grabber, A_GRAB_RELEASE);
  setAction(s, target, A_GRAB_RELEASE);
}

/** Maintient la victime devant celui qui la tient. */
function holdInPlace(sim: Sim, grabber: number, target: number): void {
  const s = sim.state;
  const facing = s.facing[grabber]!;
  s.posX[target] = s.posX[grabber]! + facing * sim.config.fighters[grabber]!.grab.holdX;
  s.posY[target] = s.posY[grabber]!;
  s.velX[target] = 0;
  s.velY[target] = 0;
  s.grounded[target] = s.grounded[grabber]!;
  s.surface[target] = s.surface[grabber]!;
  s.facing[target] = -facing;
}

function throwTarget(sim: Sim, grabber: number, target: number): void {
  const s = sim.state;
  const t = sim.config.fighters[grabber]!.throws[s.move[grabber]!]!;
  const kb = knockback(
    s.damage[target]! + t.damage,
    t.damage,
    sim.config.fighters[target]!.weight,
    t.baseKnockback,
    t.knockbackGrowth,
  );
  s.grabTarget[grabber] = 0;
  s.grabbedBy[target] = 0;
  // Une frame de gel : le temps pour la victime d'orienter sa trajectoire.
  applyHit(sim, target, t.damage, kb, s.facing[grabber] === 1 ? t.angle : 180 - t.angle, 1);
  emit(sim.events, EV_HIT, grabber, target);
}

/** Décisions des actions de saisie. Appelé à la place de `updateMovement` pour ces actions. */
export function updateGrab(sim: Sim, i: number): void {
  const s = sim.state;
  const def = sim.config.fighters[i]!;
  const input = s.input[i]!;
  const action = s.action[i]!;
  const frames = s.actionFrame[i]!;

  switch (action) {
    case A_GRAB: {
      s.velX[i] = approach(s.velX[i]!, 0, def.friction);
      if (frames >= def.grab.totalFrames) {
        setAction(s, i, A_IDLE);
        updateMovement(sim, i);
      }
      return;
    }

    case A_GRABBING: {
      s.velX[i] = 0;
      const target = s.grabTarget[i]! - 1;
      if (target < 0) return;
      // Le temps de prise s'écoule ici ; son expiration est constatée dans `resolveGrabs`.
      s.grabTimer[i] = s.grabTimer[i]! - 1;
      const stickX = inputStickX(input);
      const stickY = inputStickY(input);
      const absX = stickX < 0 ? -stickX : stickX;
      const absY = stickY < 0 ? -stickY : stickY;
      if (absX >= STICK_THROW || absY >= STICK_THROW) {
        if (absX >= absY) {
          s.move[i] = (stickX > 0 ? 1 : -1) === s.facing[i] ? THROW_FORWARD : THROW_BACK;
        } else {
          s.move[i] = stickY > 0 ? THROW_UP : THROW_DOWN;
        }
        setAction(s, i, A_THROW);
        return;
      }
      if (s.pummelCd[i]! > 0) {
        s.pummelCd[i] = s.pummelCd[i]! - 1;
      } else if (s.bufAttack[i]! > 0) {
        s.bufAttack[i] = 0;
        s.pummelCd[i] = def.grab.pummelFrames;
        s.damage[target] = s.damage[target]! + def.grab.pummelDamage;
        emit(sim.events, EV_HIT, i, target);
      }
      return;
    }

    case A_GRABBED: {
      // Se débattre : chaque bouton nouvellement enfoncé écourte la prise.
      const grabber = s.grabbedBy[i]! - 1;
      const pressed = (input & ~s.prevInput[i]!) >>> 16;
      if (grabber >= 0 && pressed !== 0) {
        s.grabTimer[grabber] = s.grabTimer[grabber]! - GRAB_MASH_FRAMES;
      }
      return;
    }

    case A_THROW: {
      // La victime est lâchée dans `resolveGrabs`, à la frame `releaseFrame`.
      if (frames >= def.throws[s.move[i]!]!.totalFrames) {
        setAction(s, i, A_IDLE);
        updateMovement(sim, i);
      }
      return;
    }

    case A_GRAB_RELEASE: {
      const grounded = s.grounded[i] === 1;
      s.velX[i] = approach(s.velX[i]!, 0, grounded ? def.friction : def.airFriction);
      if (frames >= GRAB_RELEASE_FRAMES) {
        setAction(s, i, grounded ? A_IDLE : A_AIR);
        updateMovement(sim, i);
      }
      return;
    }
  }
}

const isHolding = (action: number): boolean => action === A_GRABBING || action === A_THROW;

/** Vrai si `j` peut être saisi à cette frame. */
function grabbable(s: SimState, j: number): boolean {
  const action = s.action[j]!;
  return (
    action !== A_DEAD &&
    action !== A_GRABBED &&
    action !== A_GRABBING &&
    action !== A_THROW &&
    s.intangible[j] === 0
  );
}

/**
 * Résolution des saisies de la frame, après les coups : un combattant frappé à cette frame n'est
 * déjà plus en train de saisir.
 *
 * Tout ce qui change l'état de l'autre combattant (prise, lâcher, projection) se passe ici et non
 * dans `updateGrab` : sinon le résultat dépendrait de l'ordre dans lequel les deux joueurs sont
 * traités pendant la frame.
 */
export function resolveGrabs(sim: Sim): void {
  const s = sim.state;
  const fighters = sim.config.fighters;
  const want = sim.scratch.grabWant;
  const players = s.g[G_PLAYERS]!;

  // 1. Prises en cours : rompues si l'un des deux a été frappé ou tué, sinon maintenues.
  for (let i = 0; i < players; i++) {
    const j = s.grabTarget[i]! - 1;
    if (j < 0) continue;
    const holding = isHolding(s.action[i]!);
    const held = s.action[j] === A_GRABBED && s.grabbedBy[j] === i + 1;
    if (holding && held) {
      if (s.action[i] === A_THROW) {
        const release = fighters[i]!.throws[s.move[i]!]!.releaseFrame;
        if (s.actionFrame[i]! + 1 === release) {
          throwTarget(sim, i, j);
          continue;
        }
      } else if (s.grabTimer[i]! <= 0) {
        releasePair(s, i, j);
        continue;
      }
      holdInPlace(sim, i, j);
      continue;
    }
    s.grabTarget[i] = 0;
    if (holding) setAction(s, i, A_GRAB_RELEASE);
    if (held) {
      s.grabbedBy[j] = 0;
      setAction(s, j, A_GRAB_RELEASE);
    }
  }
  for (let j = 0; j < players; j++) {
    if (s.action[j] !== A_GRABBED) continue;
    const i = s.grabbedBy[j]! - 1;
    if (i < 0 || s.grabTarget[i] !== j + 1) {
      s.grabbedBy[j] = 0;
      setAction(s, j, A_GRAB_RELEASE);
    }
  }

  // 2. Nouvelles tentatives : chacun vise la cible la plus proche à sa portée.
  for (let i = 0; i < players; i++) {
    want[i] = -1;
    if (s.action[i] !== A_GRAB || sim.scratch.frozen[i] === 1) continue;
    const grab = fighters[i]!.grab;
    const frame = s.actionFrame[i]! + 1;
    if (frame < grab.start || frame > grab.end) continue;
    let best = -1;
    let bestGap = 0;
    for (let j = 0; j < players; j++) {
      if (j === i || !grabbable(s, j)) continue;
      if (!touches(s, i, grab.box, j, fighters[j]!)) continue;
      const dx = s.posX[j]! - s.posX[i]!;
      const gap = dx < 0 ? -dx : dx;
      if (best < 0 || gap < bestGap) {
        best = j;
        bestGap = gap;
      }
    }
    want[i] = best;
  }

  // 3. Arbitrage, indépendant de l'ordre des joueurs sauf égalité parfaite de distance.
  for (let i = 0; i < players; i++) {
    const j = want[i]!;
    if (j < 0) continue;

    if (want[j] === i) {
      // Saisie mutuelle : personne ne l'emporte, les deux reculent.
      if (i < j) {
        releasePair(s, i, j);
        s.velX[j] = -s.facing[j]! * GRAB_RELEASE_PUSH;
      }
      continue;
    }

    // Plusieurs prétendants sur la même cible : le plus proche gagne, puis le plus petit index.
    const dxi = s.posX[j]! - s.posX[i]!;
    const gapI = dxi < 0 ? -dxi : dxi;
    let wins = true;
    for (let k = 0; k < players; k++) {
      if (k === i || want[k] !== j) continue;
      const dxk = s.posX[j]! - s.posX[k]!;
      const gapK = dxk < 0 ? -dxk : dxk;
      if (gapK < gapI || (gapK === gapI && k < i)) wins = false;
    }
    if (!wins) continue;

    const hold = GRAB_HOLD_BASE_FRAMES + (s.damage[j]! >> (FX_SHIFT + 1));
    s.grabTarget[i] = j + 1;
    s.grabbedBy[j] = i + 1;
    s.grabTimer[i] = hold > GRAB_HOLD_MAX_FRAMES ? GRAB_HOLD_MAX_FRAMES : hold;
    s.pummelCd[i] = 0;
    s.hitlag[j] = 0;
    s.launchPending[j] = 0;
    s.stun[j] = 0;
    s.fastFall[j] = 0;
    setAction(s, i, A_GRABBING);
    setAction(s, j, A_GRABBED);
    holdInPlace(sim, i, j);
    emit(sim.events, EV_GRAB, i, j);
  }
}
