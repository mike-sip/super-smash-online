/**
 * Bouclier et esquives.
 *
 * Les constantes sont communes à tous les combattants ; ce qui varie d'un personnage à l'autre
 * (résistance du bouclier, durées des esquives) est dans `FighterDef`.
 */
import {
  A_AIR,
  A_AIRDODGE,
  A_GRAB,
  A_IDLE,
  A_JUMPSQUAT,
  A_LEDGE,
  A_ROLL,
  A_SHIELD,
  A_SHIELDSTUN,
  A_SHIELD_BREAK,
  A_SHIELD_DROP,
  A_SPOTDODGE,
  setAction,
} from '../actions.ts';
import type { DodgeDef } from '../defs.ts';
import { EV_SHIELD_BREAK, emit } from '../events.ts';
import { FX_SHIFT, fx, fxMul } from '../fixed.ts';
import { BTN_SHIELD, STICK_MAX, inputStickX, inputStickY } from '../input.ts';
import type { Sim } from '../step.ts';
import { updateGrab } from './grab.ts';
import { updateLedge } from './ledge.ts';
import { updateMovement } from './movement.ts';
import { approach } from './util.ts';

/** Usure du bouclier par frame tant qu'il est levé. */
export const SHIELD_DRAIN = fx(0.15);
/** Régénération par frame quand il est baissé. */
export const SHIELD_REGEN = fx(0.08);
/** Durée minimale d'un bouclier, même sur un appui bref. */
export const SHIELD_MIN_FRAMES = 3;
/** Durée de l'abaissement du bouclier. */
export const SHIELD_DROP_FRAMES = 11;
/** Un coup reçu pendant les premières frames de l'abaissement est paré. */
export const PARRY_WINDOW_FRAMES = 5;
/** Gel supplémentaire infligé à l'attaquant paré : c'est l'ouverture offerte au défenseur. */
export const PARRY_ATTACKER_LAG = 11;
/** Étourdissement au sol après un bouclier brisé. */
export const SHIELD_BREAK_FRAMES = 180;
/** Résistance rendue au bouclier à la fin de l'étourdissement. */
export const SHIELD_BREAK_RESTORE = fx(15);
const SHIELD_BREAK_POP = fx(2.2);
const SHIELDSTUN_BASE = 2;
const SHIELDSTUN_PER_DAMAGE = fx(0.8);
const PUSHBACK_BASE = fx(0.3);
const PUSHBACK_PER_DAMAGE = fx(0.03);

/** Chaque esquive rapprochée ajoute ce lag à la suivante et lui retire cette intangibilité. */
const STALE_EXTRA_LAG = 3;
const STALE_LOST_INVULN = 2;
const STALE_MAX = 5;
/** Sans esquive pendant ce délai, un niveau d'usure disparaît. */
const STALE_DECAY_FRAMES = 90;

const STICK_DODGE = 96;
const FLICK_WINDOW = 3;
const STICK_FLICK_DOWN = -100;
/** Inclinaison minimale pour qu'une esquive aérienne soit directionnelle. */
const STICK_AIRDODGE_DIR = 40;
/** Frames sans gravité au début d'une esquive aérienne directionnelle. */
const AIRDODGE_FLOAT_FRAMES = 12;

function breakShield(sim: Sim, i: number): void {
  const s = sim.state;
  s.shield[i] = 0;
  s.stun[i] = SHIELD_BREAK_FRAMES;
  s.velX[i] = 0;
  s.velY[i] = SHIELD_BREAK_POP;
  s.grounded[i] = 0;
  s.surface[i] = 0;
  setAction(s, i, A_SHIELD_BREAK);
  emit(sim.events, EV_SHIELD_BREAK, i, 0);
}

/** Vrai si un coup reçu maintenant serait bloqué par le bouclier. */
export const isShielding = (action: number): boolean =>
  action === A_SHIELD || action === A_SHIELDSTUN;

/** Vrai si un coup reçu maintenant serait paré. */
export function isParrying(sim: Sim, i: number): boolean {
  const s = sim.state;
  return s.action[i] === A_SHIELD_DROP && s.actionFrame[i]! < PARRY_WINDOW_FRAMES;
}

/** Le bouclier encaisse `damage` : usure, recul, et blocage forcé pendant quelques frames. */
export function blockHit(
  sim: Sim,
  i: number,
  damage: number,
  hitlag: number,
  pushDir: number,
): void {
  const s = sim.state;
  const left = s.shield[i]! - damage;
  if (left <= 0) {
    breakShield(sim, i);
    return;
  }
  s.shield[i] = left;
  s.stun[i] = SHIELDSTUN_BASE + (fxMul(damage, SHIELDSTUN_PER_DAMAGE) >> FX_SHIFT);
  s.hitlag[i] = hitlag;
  s.velX[i] = pushDir * (PUSHBACK_BASE + fxMul(damage, PUSHBACK_PER_DAMAGE));
  setAction(s, i, A_SHIELDSTUN);
}

/** Parade : le défenseur ne subit rien et redevient libre immédiatement. */
export function parryHit(sim: Sim, i: number): void {
  setAction(sim.state, i, A_IDLE);
}

function startDodge(sim: Sim, i: number, action: number, dodge: DodgeDef): void {
  const s = sim.state;
  const stale = s.dodgeStale[i]!;
  const invuln = dodge.invEnd - dodge.invStart + 1 - STALE_LOST_INVULN * stale;
  s.dodgeTotal[i] = dodge.totalFrames + STALE_EXTRA_LAG * stale;
  s.dodgeInv[i] = invuln > 0 ? invuln : 0;
  s.dodgeStale[i] = stale < STALE_MAX ? stale + 1 : STALE_MAX;
  s.dodgeTimer[i] = STALE_DECAY_FRAMES;
  setAction(s, i, action);
}

/** Fait décroître l'usure des esquives. À appeler une fois par frame. */
export function tickDodgeStale(sim: Sim, i: number): void {
  const s = sim.state;
  const timer = s.dodgeTimer[i]!;
  if (timer === 0) return;
  if (timer > 1) {
    s.dodgeTimer[i] = timer - 1;
    return;
  }
  const stale = s.dodgeStale[i]! - 1;
  s.dodgeStale[i] = stale > 0 ? stale : 0;
  s.dodgeTimer[i] = stale > 0 ? STALE_DECAY_FRAMES : 0;
}

/** Depuis une action libre au sol : saisie sur appui, bouclier si le bouton est tenu. */
export function tryGroundDefense(sim: Sim, i: number): boolean {
  const s = sim.state;
  if (s.bufGrab[i]! > 0) {
    s.bufGrab[i] = 0;
    setAction(s, i, A_GRAB);
    return true;
  }
  if (((s.input[i]! >>> 16) & BTN_SHIELD) === 0) return false;
  s.bufShield[i] = 0;
  setAction(s, i, A_SHIELD);
  return true;
}

/** En l'air : esquive aérienne sur appui bouclier, une seule fois par envol. */
export function tryAirDodge(sim: Sim, i: number, stickX: number, stickY: number): boolean {
  const s = sim.state;
  if (s.bufShield[i] === 0 || s.airDodged[i] === 1) return false;
  const dodge = sim.config.fighters[i]!.airDodge;
  s.bufShield[i] = 0;
  s.airDodged[i] = 1;
  s.fastFall[i] = 0;
  startDodge(sim, i, A_AIRDODGE, dodge);

  const absX = stickX < 0 ? -stickX : stickX;
  const absY = stickY < 0 ? -stickY : stickY;
  if (absX >= STICK_AIRDODGE_DIR || absY >= STICK_AIRDODGE_DIR) {
    // Directionnelle : élan franc dans la direction du stick, sans gravité au début.
    s.velX[i] = ((dodge.speed * stickX) / STICK_MAX) | 0;
    s.velY[i] = ((dodge.speed * stickY) / STICK_MAX) | 0;
    s.floatFrames[i] = AIRDODGE_FLOAT_FRAMES;
    s.dodgeDir[i] = 1;
  } else {
    // Neutre : l'élan et la gravité sont conservés.
    s.dodgeDir[i] = 0;
  }
  return true;
}

export function updateDefense(sim: Sim, i: number): void {
  const s = sim.state;
  const def = sim.config.fighters[i]!;
  const input = s.input[i]!;
  const action = s.action[i]!;
  if (action >= A_LEDGE) {
    updateLedge(sim, i);
    return;
  }
  if (action >= A_GRAB) {
    updateGrab(sim, i);
    return;
  }
  const frames = s.actionFrame[i]!;
  const held = ((input >>> 16) & BTN_SHIELD) !== 0;

  switch (action) {
    case A_SHIELD: {
      s.velX[i] = approach(s.velX[i]!, 0, def.friction);
      if (s.bufJump[i]! > 0) {
        s.bufJump[i] = 0;
        setAction(s, i, A_JUMPSQUAT);
        return;
      }
      // Attaque sous bouclier = saisie.
      if (s.bufGrab[i]! > 0 || s.bufAttack[i]! > 0) {
        s.bufGrab[i] = 0;
        s.bufAttack[i] = 0;
        setAction(s, i, A_GRAB);
        return;
      }
      const stickX = inputStickX(input);
      const absX = stickX < 0 ? -stickX : stickX;
      const tilt = s.tilt[i]!;
      if (absX >= STICK_DODGE && (tilt < 0 ? -tilt : tilt) <= FLICK_WINDOW) {
        s.dodgeDir[i] = stickX > 0 ? 1 : -1;
        startDodge(sim, i, A_ROLL, def.roll);
        return;
      }
      if (
        inputStickY(input) <= STICK_FLICK_DOWN &&
        inputStickY(s.prevInput[i]!) > STICK_FLICK_DOWN
      ) {
        startDodge(sim, i, A_SPOTDODGE, def.spotDodge);
        return;
      }
      const left = s.shield[i]! - SHIELD_DRAIN;
      if (left <= 0) {
        breakShield(sim, i);
        return;
      }
      s.shield[i] = left;
      if (!held && frames >= SHIELD_MIN_FRAMES) setAction(s, i, A_SHIELD_DROP);
      return;
    }

    case A_SHIELDSTUN: {
      s.velX[i] = approach(s.velX[i]!, 0, def.friction);
      const left = s.stun[i]! - 1;
      s.stun[i] = left;
      if (left <= 0) setAction(s, i, held ? A_SHIELD : A_SHIELD_DROP);
      return;
    }

    case A_SHIELD_DROP: {
      s.velX[i] = approach(s.velX[i]!, 0, def.friction);
      if (frames >= SHIELD_DROP_FRAMES) {
        setAction(s, i, A_IDLE);
        updateMovement(sim, i);
      }
      return;
    }

    case A_SHIELD_BREAK: {
      // En l'air après le bris : seule la gravité agit. L'étourdissement commence au sol.
      if (s.grounded[i] === 0) return;
      s.velX[i] = approach(s.velX[i]!, 0, def.friction);
      const left = s.stun[i]! - 1;
      s.stun[i] = left;
      if (left <= 0) {
        s.shield[i] = SHIELD_BREAK_RESTORE;
        setAction(s, i, A_IDLE);
      }
      return;
    }

    case A_SPOTDODGE:
    case A_ROLL:
    case A_AIRDODGE: {
      const dodge =
        action === A_SPOTDODGE ? def.spotDodge : action === A_ROLL ? def.roll : def.airDodge;
      if (frames >= s.dodgeTotal[i]!) {
        if (action === A_ROLL) s.facing[i] = -s.dodgeDir[i]!;
        setAction(s, i, action === A_AIRDODGE ? A_AIR : A_IDLE);
        updateMovement(sim, i);
        return;
      }
      const moveFrame = frames + 1;
      if (moveFrame === dodge.invStart) s.intangible[i] = s.dodgeInv[i]!;

      if (action === A_SPOTDODGE) {
        s.velX[i] = approach(s.velX[i]!, 0, def.friction);
      } else if (action === A_ROLL) {
        // La roulade ne se déplace que pendant sa phase intangible.
        const moving = moveFrame >= dodge.invStart && moveFrame <= dodge.invEnd;
        s.velX[i] = moving ? s.dodgeDir[i]! * dodge.speed : 0;
      } else if (s.dodgeDir[i] === 1) {
        const brake = def.airFriction * 4;
        s.velX[i] = approach(s.velX[i]!, 0, brake);
        if (s.floatFrames[i]! > 0) s.velY[i] = approach(s.velY[i]!, 0, brake);
      }
      return;
    }
  }
}
