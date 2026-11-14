/**
 * Décisions du combattant : lit l'input du joueur, change d'action et fixe les vitesses.
 * Le déplacement lui-même et les collisions sont appliqués ensuite par `collision.ts`.
 */
import {
  A_AIR,
  A_ATTACK,
  A_BRAKE,
  A_CROUCH,
  A_DASH,
  A_DEAD,
  A_DOWN,
  A_HITSTUN,
  A_IDLE,
  A_ITEM_SWING,
  A_ITEM_THROW,
  A_JUMPSQUAT,
  A_LAND,
  A_RUN,
  A_SHIELD,
  A_TECH,
  A_TUMBLE,
  A_TURN,
  A_WALK,
  setAction,
} from '../actions.ts';
import type { FighterDef } from '../defs.ts';
import { fx } from '../fixed.ts';
import {
  BTN_ATTACK,
  BTN_CSTICK_DOWN,
  BTN_CSTICK_LEFT,
  BTN_CSTICK_RIGHT,
  BTN_CSTICK_UP,
  BTN_JUMP,
  STICK_MAX,
  inputStickX,
  inputStickY,
} from '../input.ts';
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
  M_UTILT,
} from '../moves.ts';
import type { SimState } from '../state.ts';
import type { Sim } from '../step.ts';
import { C_DOWN, C_LEFT, C_UP } from './buffer.ts';
import { STICK_HOLD_DOWN } from './collision.ts';
import { tryAirDodge, tryGroundDefense, updateDefense } from './defense.ts';
import { spawnEntity } from './entities.ts';
import { ITEM_THROW_RELEASE, itemActionFrames, releaseThrow, tryItemAction } from './items.ts';
import { approach } from './util.ts';

/** En dessous, le stick est considéré au neutre. */
const STICK_DEADZONE = 20;
/** Inclinaison minimale pour qu'une attaque soit dirigée plutôt que neutre. */
const STICK_TILT = 40;
/** Inclinaison à atteindre pour un dash ou une attaque smash. */
const STICK_SMASH = 96;
/** Un coup de stick : l'inclinaison smash est atteinte en si peu de frames. */
const FLICK_WINDOW = 3;
/** Inclinaison minimale pour entretenir la course. */
const STICK_RUN = 64;
/** Coup de stick vers le bas : chute rapide en l'air, descente à travers une plateforme. */
const STICK_FLICK_DOWN = -100;
/** Décélération horizontale pendant le hitstun en l'air. */
const KNOCKBACK_DECAY = fx(0.03);

const CHARGE_BUTTONS =
  BTN_ATTACK | BTN_CSTICK_UP | BTN_CSTICK_DOWN | BTN_CSTICK_LEFT | BTN_CSTICK_RIGHT;

const FROM_ATTACK = 1;
const FROM_SPECIAL = 2;
const FROM_CSTICK = 3;

// Résultat de la dernière sélection d'attaque. Variables de travail, écrasées à chaque appel.
let wantSlot = -1;
let wantFacing = 0;
let wantFrom = 0;

/** Compte les frames consécutives d'inclinaison du même côté, signées par la direction. */
function trackTilt(before: number, value: number): number {
  if (value >= STICK_DEADZONE) return before > 0 ? before + 1 : 1;
  if (value <= -STICK_DEADZONE) return before < 0 ? before - 1 : -1;
  return 0;
}

/**
 * Détermine l'attaque que l'input en tampon désigne, sans la lancer.
 * `running` : le combattant est en dash ou en course (attaque de dash).
 */
function selectMove(
  s: SimState,
  i: number,
  grounded: boolean,
  running: boolean,
  stickX: number,
  stickY: number,
): void {
  wantSlot = -1;
  wantFacing = 0;
  wantFrom = 0;
  const facing = s.facing[i]!;
  const absX = stickX < 0 ? -stickX : stickX;
  const absY = stickY < 0 ? -stickY : stickY;
  const dirX = stickX > 0 ? 1 : -1;
  const vertical = absY > absX && absY >= STICK_TILT;
  const horizontal = !vertical && absX >= STICK_TILT;

  const c = s.bufC[i]!;
  if (c !== 0) {
    const cDir = c >> 8;
    wantFrom = FROM_CSTICK;
    if (grounded) {
      if (cDir === C_UP) wantSlot = M_USMASH;
      else if (cDir === C_DOWN) wantSlot = M_DSMASH;
      else {
        wantSlot = M_FSMASH;
        wantFacing = cDir === C_LEFT ? -1 : 1;
      }
    } else if (cDir === C_UP) wantSlot = M_UAIR;
    else if (cDir === C_DOWN) wantSlot = M_DAIR;
    else wantSlot = (cDir === C_LEFT ? -1 : 1) === facing ? M_FAIR : M_BAIR;
    return;
  }

  if (s.bufAttack[i]! > 0) {
    wantFrom = FROM_ATTACK;
    if (!grounded) {
      if (vertical) wantSlot = stickY > 0 ? M_UAIR : M_DAIR;
      else if (horizontal) wantSlot = dirX === facing ? M_FAIR : M_BAIR;
      else wantSlot = M_NAIR;
    } else if (running) {
      wantSlot = M_DASH_ATTACK;
    } else if (vertical) {
      const tiltY = s.tiltY[i]!;
      const flick = absY >= STICK_SMASH && (tiltY < 0 ? -tiltY : tiltY) <= FLICK_WINDOW;
      if (stickY > 0) wantSlot = flick ? M_USMASH : M_UTILT;
      else wantSlot = flick ? M_DSMASH : M_DTILT;
    } else if (horizontal) {
      const tilt = s.tilt[i]!;
      const flick = absX >= STICK_SMASH && (tilt < 0 ? -tilt : tilt) <= FLICK_WINDOW;
      wantSlot = flick ? M_FSMASH : M_FTILT;
      wantFacing = dirX;
    } else {
      wantSlot = M_JAB;
    }
    return;
  }

  if (s.bufSpecial[i]! > 0) {
    wantFrom = FROM_SPECIAL;
    if (vertical) wantSlot = stickY > 0 ? M_USPECIAL : M_DSPECIAL;
    else if (horizontal) {
      wantSlot = M_SSPECIAL;
      wantFacing = dirX;
    } else wantSlot = M_NSPECIAL;
  }
}

/** Lance l'emplacement `slot` et consomme l'input qui l'a demandé. */
function startMove(s: SimState, i: number, slot: number): void {
  if (wantFrom === FROM_ATTACK) s.bufAttack[i] = 0;
  else if (wantFrom === FROM_SPECIAL) s.bufSpecial[i] = 0;
  else if (wantFrom === FROM_CSTICK) s.bufC[i] = 0;
  if (wantFacing !== 0) s.facing[i] = wantFacing;
  s.move[i] = slot;
  s.charge[i] = 0;
  s.hitMask[i] = 0;
  s.connected[i] = 0;
  setAction(s, i, A_ATTACK);
}

/** Lance une attaque sans passer par un input (attaque de remontée depuis un rebord). */
export function forceMove(s: SimState, i: number, slot: number): void {
  wantFrom = 0;
  wantFacing = 0;
  startMove(s, i, slot);
}

/** Lance l'attaque demandée si le combattant en possède une. Renvoie vrai si elle est partie. */
function tryAttack(
  s: SimState,
  def: FighterDef,
  i: number,
  grounded: boolean,
  running: boolean,
  stickX: number,
  stickY: number,
): boolean {
  selectMove(s, i, grounded, running, stickX, stickY);
  if (wantSlot < 0 || def.moves[wantSlot] === undefined) return false;
  startMove(s, i, wantSlot);
  return true;
}

function startDash(s: SimState, def: FighterDef, i: number, dir: number): void {
  s.facing[i] = dir;
  s.velX[i] = dir * def.dashSpeed;
  setAction(s, i, A_DASH);
}

function leaveGround(s: SimState, def: FighterDef, i: number): void {
  s.grounded[i] = 0;
  s.surface[i] = 0;
  s.jumpsLeft[i] = def.airJumps;
  setAction(s, i, A_AIR);
}

/** Dérive horizontale et chute rapide, communes à la chute libre et aux attaques aériennes. */
function airControl(
  s: SimState,
  def: FighterDef,
  i: number,
  stickX: number,
  dir: number,
  flickDown: boolean,
): void {
  if (flickDown && s.velY[i]! < 0) s.fastFall[i] = 1;
  if (dir !== 0) {
    const target = Math.trunc((def.airSpeed * stickX) / STICK_MAX);
    s.velX[i] = approach(s.velX[i]!, target, def.airAccel);
  } else {
    s.velX[i] = approach(s.velX[i]!, 0, def.airFriction);
  }
}

export function updateMovement(sim: Sim, i: number): void {
  const s = sim.state;
  const def = sim.config.fighters[i]!;
  const input = s.input[i]!;
  const stickX = inputStickX(input);
  const stickY = inputStickY(input);
  const absX = stickX < 0 ? -stickX : stickX;
  const dir = absX < STICK_DEADZONE ? 0 : stickX > 0 ? 1 : -1;
  const action = s.action[i]!;
  const frames = s.actionFrame[i]!;
  const grounded = s.grounded[i] === 1;

  if (action === A_DEAD) return;
  if (action === A_ITEM_THROW || action === A_ITEM_SWING) {
    // Lancer ou coup d'objet (module stages-items) : numérotés hors des plages ci-dessous.
    if (action === A_ITEM_THROW && frames + 1 === ITEM_THROW_RELEASE) releaseThrow(sim, i);
    if (frames >= itemActionFrames(sim, i)) {
      setAction(s, i, grounded ? A_IDLE : A_AIR);
      updateMovement(sim, i);
      return;
    }
    if (grounded) s.velX[i] = approach(s.velX[i]!, 0, def.friction);
    else airControl(s, def, i, stickX, dir, false);
    return;
  }
  if (action >= A_SHIELD) {
    // Bouclier, esquives, saisies, rebords : chacun a son propre système.
    updateDefense(sim, i);
    return;
  }

  const tilt = s.tilt[i]!;
  const flickX = absX >= STICK_SMASH && tilt * dir <= FLICK_WINDOW;
  const flickDown = stickY <= STICK_FLICK_DOWN && inputStickY(s.prevInput[i]!) > STICK_FLICK_DOWN;

  if (action === A_HITSTUN) {
    const left = s.stun[i]! - 1;
    s.stun[i] = left;
    s.velX[i] = approach(s.velX[i]!, 0, grounded ? def.friction : KNOCKBACK_DECAY);
    if (left <= 0) {
      if (grounded) setAction(s, i, A_IDLE);
      else setAction(s, i, s.tumble[i] === 1 ? A_TUMBLE : A_AIR);
    }
    return;
  }

  if (action === A_TECH) {
    s.velX[i] = 0;
    if (frames >= def.techFrames) {
      setAction(s, i, A_IDLE);
      updateMovement(sim, i);
    }
    return;
  }

  if (action === A_DOWN) {
    s.velX[i] = approach(s.velX[i]!, 0, def.friction);
    if (frames >= def.downFrames) {
      setAction(s, i, A_IDLE);
      updateMovement(sim, i);
    }
    return;
  }

  if (action === A_ATTACK) {
    const move = def.moves[s.move[i]!]!;
    if (frames >= move.totalFrames) {
      // Fin de l'attaque : le combattant est libre dès cette frame.
      setAction(s, i, grounded ? A_IDLE : A_AIR);
      updateMovement(sim, i);
      return;
    }
    const moveFrame = frames + 1;

    const cancels = move.cancels;
    for (let c = 0; c < cancels.length; c++) {
      const cancel = cancels[c]!;
      if (moveFrame < cancel.start || moveFrame > cancel.end) continue;
      if (cancel.requiresHit && s.connected[i] === 0) continue;
      selectMove(s, i, grounded, false, stickX, stickY);
      if (wantSlot === cancel.on && def.moves[cancel.to] !== undefined) {
        startMove(s, i, cancel.to);
        return;
      }
    }

    const spawn = move.spawn;
    if (spawn !== undefined && moveFrame === spawn.frame) {
      const facing = s.facing[i]!;
      spawnEntity(
        sim,
        spawn.kind,
        i,
        s.posX[i]! + facing * spawn.x,
        s.posY[i]! + spawn.y,
        facing * spawn.velX,
        spawn.velY,
      );
    }

    const charge = move.charge;
    if (
      charge !== undefined &&
      moveFrame === charge.frame &&
      s.charge[i]! < charge.maxFrames &&
      ((input >>> 16) & CHARGE_BUTTONS) !== 0
    ) {
      s.charge[i] = s.charge[i]! + 1;
      s.chargeHold[i] = 1;
    }

    if (grounded) s.velX[i] = approach(s.velX[i]!, 0, def.friction);
    else airControl(s, def, i, stickX, dir, flickDown);
    return;
  }

  if (action === A_AIR || action === A_TUMBLE) {
    if (s.bufJump[i]! > 0 && s.jumpsLeft[i]! > 0) {
      s.bufJump[i] = 0;
      s.jumpsLeft[i] = s.jumpsLeft[i]! - 1;
      s.velY[i] = def.doubleJumpVelocity;
      s.fastFall[i] = 0;
      // Le double saut permet de repartir franchement dans la direction du stick.
      if (dir !== 0) s.velX[i] = Math.trunc((def.airSpeed * stickX) / STICK_MAX);
      if (action === A_TUMBLE) setAction(s, i, A_AIR);
    } else if (tryItemAction(sim, i, false)) {
      // Lancer ou coup d'objet en l'air : le contrôle aérien reste actif ci-dessous.
    } else if (tryAttack(s, def, i, false, false, stickX, stickY)) {
      // L'attaque aérienne démarre : le contrôle aérien reste actif ci-dessous.
    } else if (action === A_AIR && tryAirDodge(sim, i, stickX, stickY)) {
      // En chute désordonnée, le bouton bouclier est réservé au rétablissement : il faut d'abord
      // en sortir (saut, attaque, coup de stick) pour pouvoir esquiver.
      return;
    } else if (action === A_TUMBLE && flickX) {
      // Un coup de stick latéral suffit à sortir de la chute désordonnée.
      setAction(s, i, A_AIR);
    }
    airControl(s, def, i, stickX, dir, flickDown);
    return;
  }

  if (action === A_JUMPSQUAT) {
    if (frames >= def.jumpSquatFrames) {
      const held = (input >>> 16) & BTN_JUMP;
      s.velY[i] = held !== 0 ? def.jumpVelocity : def.shortHopVelocity;
      leaveGround(s, def, i);
    }
    return;
  }

  if (action === A_LAND) {
    s.velX[i] = approach(s.velX[i]!, 0, def.friction);
    if (frames >= s.landLag[i]!) {
      setAction(s, i, A_IDLE);
      updateMovement(sim, i);
    }
    return;
  }

  // Toutes les actions au sol restantes peuvent être annulées par un saut ou une attaque.
  if (s.bufJump[i]! > 0) {
    s.bufJump[i] = 0;
    setAction(s, i, A_JUMPSQUAT);
    return;
  }
  if (tryItemAction(sim, i, true)) return;
  if (tryAttack(s, def, i, true, action === A_DASH || action === A_RUN, stickX, stickY)) {
    return;
  }
  if (tryGroundDefense(sim, i)) return;

  switch (action) {
    case A_IDLE:
    case A_WALK:
    case A_CROUCH: {
      const onPlatform = sim.geo.surfPass[s.surface[i]! - 1] === 1;
      if (onPlatform && flickDown) {
        leaveGround(s, def, i);
        return;
      }
      if (stickY <= STICK_HOLD_DOWN) {
        if (action !== A_CROUCH) setAction(s, i, A_CROUCH);
        s.velX[i] = approach(s.velX[i]!, 0, def.friction);
        return;
      }
      if (flickX) {
        startDash(s, def, i, dir);
        return;
      }
      if (dir !== 0) {
        if (action !== A_WALK) setAction(s, i, A_WALK);
        s.facing[i] = dir;
        const target = Math.trunc((def.walkSpeed * stickX) / STICK_MAX);
        s.velX[i] = approach(s.velX[i]!, target, def.walkAccel);
        return;
      }
      if (action !== A_IDLE) setAction(s, i, A_IDLE);
      s.velX[i] = approach(s.velX[i]!, 0, def.friction);
      return;
    }

    case A_DASH: {
      const facing = s.facing[i]!;
      if (flickX && dir === -facing) {
        startDash(s, def, i, dir);
        return;
      }
      if (frames >= def.dashFrames) {
        setAction(s, i, dir === facing && absX >= STICK_RUN ? A_RUN : A_BRAKE);
        return;
      }
      s.velX[i] = facing * def.dashSpeed;
      return;
    }

    case A_RUN: {
      const facing = s.facing[i]!;
      if (absX >= STICK_RUN && dir === -facing) {
        setAction(s, i, A_TURN);
        return;
      }
      if (absX < STICK_RUN) {
        setAction(s, i, A_BRAKE);
        return;
      }
      s.velX[i] = approach(s.velX[i]!, facing * def.runSpeed, def.runAccel);
      return;
    }

    case A_BRAKE: {
      if (flickX) {
        startDash(s, def, i, dir);
        return;
      }
      s.velX[i] = approach(s.velX[i]!, 0, def.friction);
      if (frames >= def.brakeFrames) setAction(s, i, A_IDLE);
      return;
    }

    case A_TURN: {
      s.velX[i] = approach(s.velX[i]!, 0, def.friction * 2);
      if (frames >= def.turnFrames) {
        const facing = -s.facing[i]!;
        s.facing[i] = facing;
        setAction(s, i, dir === facing && absX >= STICK_RUN ? A_RUN : A_IDLE);
      }
      return;
    }
  }
}

/** Met à jour les compteurs d'inclinaison du stick. À appeler à chaque frame, même en hitlag. */
export function trackStick(sim: Sim, i: number): void {
  const s = sim.state;
  const input = s.input[i]!;
  s.tilt[i] = trackTilt(s.tilt[i]!, inputStickX(input));
  s.tiltY[i] = trackTilt(s.tiltY[i]!, inputStickY(input));
}
