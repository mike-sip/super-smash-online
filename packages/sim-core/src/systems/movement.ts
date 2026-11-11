/**
 * Décisions de déplacement : lit l'input du joueur, change d'action et fixe les vitesses.
 * Le déplacement lui-même et les collisions sont appliqués ensuite par `collision.ts`.
 */
import {
  A_AIR,
  A_BRAKE,
  A_CROUCH,
  A_DASH,
  A_DEAD,
  A_IDLE,
  A_JUMPSQUAT,
  A_LAND,
  A_RUN,
  A_TURN,
  A_WALK,
  setAction,
} from '../actions.ts';
import type { FighterDef } from '../defs.ts';
import { BTN_JUMP, STICK_MAX, inputPressed, inputStickX, inputStickY } from '../input.ts';
import type { SimState } from '../state.ts';
import type { Sim } from '../step.ts';
import { STICK_HOLD_DOWN } from './collision.ts';

/** En dessous, le stick horizontal est considéré au neutre. */
const STICK_DEADZONE = 20;
/** Inclinaison à atteindre pour déclencher un dash. */
const STICK_DASH = 96;
/** Le dash ne part que si cette inclinaison est atteinte en si peu de frames (coup de stick). */
const DASH_WINDOW = 3;
/** Inclinaison minimale pour entretenir la course. */
const STICK_RUN = 64;
/** Coup de stick vers le bas : chute rapide en l'air, descente à travers une plateforme. */
const STICK_FLICK_DOWN = -100;

/** Rapproche `v` de `target` d'au plus `delta`, sans le dépasser. */
function approach(v: number, target: number, delta: number): number {
  if (v < target) return v + delta > target ? target : v + delta;
  return v - delta < target ? target : v - delta;
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

export function updateMovement(sim: Sim, i: number): void {
  const s = sim.state;
  const def = sim.config.fighters[i]!;
  const input = s.input[i]!;
  const prev = s.prevInput[i]!;
  const stickX = inputStickX(input);
  const stickY = inputStickY(input);
  const absX = stickX < 0 ? -stickX : stickX;
  const dir = absX < STICK_DEADZONE ? 0 : stickX > 0 ? 1 : -1;

  // Depuis combien de frames le stick est incliné de ce côté : distingue coup de stick et inclinaison lente.
  const tiltBefore = s.tilt[i]!;
  const tilt =
    dir === 0
      ? 0
      : dir > 0
        ? tiltBefore > 0
          ? tiltBefore + 1
          : 1
        : tiltBefore < 0
          ? tiltBefore - 1
          : -1;
  s.tilt[i] = tilt;

  const dashInput = absX >= STICK_DASH && tilt * dir <= DASH_WINDOW;
  const jumpPressed = inputPressed(input, prev, BTN_JUMP);
  const flickDown = stickY <= STICK_FLICK_DOWN && inputStickY(prev) > STICK_FLICK_DOWN;
  const action = s.action[i]!;
  const frames = s.actionFrame[i]!;

  if (action === A_DEAD) return;

  if (action === A_AIR) {
    if (jumpPressed && s.jumpsLeft[i]! > 0) {
      s.jumpsLeft[i] = s.jumpsLeft[i]! - 1;
      s.velY[i] = def.doubleJumpVelocity;
      s.fastFall[i] = 0;
      // Le double saut permet de repartir franchement dans la direction du stick.
      if (dir !== 0) s.velX[i] = Math.trunc((def.airSpeed * stickX) / STICK_MAX);
    } else if (flickDown && s.velY[i]! < 0) {
      s.fastFall[i] = 1;
    }
    if (dir !== 0) {
      const target = Math.trunc((def.airSpeed * stickX) / STICK_MAX);
      s.velX[i] = approach(s.velX[i]!, target, def.airAccel);
    } else {
      s.velX[i] = approach(s.velX[i]!, 0, def.airFriction);
    }
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
    if (frames >= def.landFrames) setAction(s, i, A_IDLE);
    return;
  }

  // Toutes les actions au sol restantes peuvent être annulées par un saut.
  if (jumpPressed) {
    setAction(s, i, A_JUMPSQUAT);
    return;
  }

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
      if (dashInput) {
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
      if (dashInput && dir === -facing) {
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
      if (dashInput) {
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
