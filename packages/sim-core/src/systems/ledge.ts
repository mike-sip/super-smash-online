/**
 * Rebords : les deux coins supérieurs de chaque bloc plein.
 *
 * Un combattant qui tombe à portée d'un rebord libre s'y accroche. Il y est brièvement intangible,
 * de moins en moins à chaque nouvelle accroche sans avoir retouché le sol, puis choisit comment
 * remonter.
 */
import {
  A_AIR,
  A_HELPLESS,
  A_IDLE,
  A_LEDGE,
  A_LEDGE_GETUP,
  A_LEDGE_ROLL,
  A_TUMBLE,
  setAction,
} from '../actions.ts';
import { EV_LEDGE, emit } from '../events.ts';
import { fx } from '../fixed.ts';
import { inputStickX, inputStickY } from '../input.ts';
import { M_LEDGE_ATTACK } from '../moves.ts';
import { G_PLAYERS } from '../state.ts';
import type { Sim } from '../step.ts';
import { STICK_HOLD_DOWN, findSurface } from './collision.ts';
import { dropHeld } from './items.ts';
import { forceMove, updateMovement } from './movement.ts';

/** Intangibilité à la première accroche, et ce que chaque accroche suivante lui retire. */
export const LEDGE_INVULN_FRAMES = 40;
export const LEDGE_INVULN_LOSS = 20;
/** Délai avant de pouvoir se raccrocher après avoir quitté un rebord. */
export const LEDGE_COOLDOWN_FRAMES = 30;
/** Frames à attendre, une fois accroché, avant de pouvoir choisir une option. */
export const LEDGE_MIN_HANG_FRAMES = 8;
/** Au-delà, le combattant lâche prise tout seul. */
export const LEDGE_MAX_HANG_FRAMES = 300;
/** Portée horizontale de l'accroche, mesurée depuis le rebord vers l'extérieur du stage. */
const LEDGE_REACH_X = fx(9);
/** Le rebord doit se trouver entre cette hauteur au-dessus des pieds et un peu au-dessus de la tête. */
const LEDGE_REACH_BELOW = fx(3);
const LEDGE_REACH_ABOVE = fx(4);
const STICK_OPTION = 64;

const isOnLedge = (action: number): boolean =>
  action === A_LEDGE || action === A_LEDGE_GETUP || action === A_LEDGE_ROLL;

function leaveLedge(sim: Sim, i: number): void {
  sim.state.ledge[i] = 0;
  sim.state.ledgeCooldown[i] = LEDGE_COOLDOWN_FRAMES;
}

/** Pose le combattant sur le stage, à `inward` du rebord qu'il tenait. */
function climbOnto(sim: Sim, i: number, inward: number): void {
  const s = sim.state;
  const geo = sim.geo;
  const l = s.ledge[i]! - 1;
  const x = geo.ledgeX[l]! - geo.ledgeSide[l]! * inward;
  const y = geo.ledgeY[l]!;
  s.posX[i] = x;
  s.posY[i] = y;
  s.velX[i] = 0;
  s.velY[i] = 0;
  s.grounded[i] = 1;
  s.surface[i] = findSurface(geo, x, y);
  s.ledgeGrabs[i] = 0;
  leaveLedge(sim, i);
}

/** Décisions d'un combattant accroché. Appelé à la place de `updateMovement`. */
export function updateLedge(sim: Sim, i: number): void {
  const s = sim.state;
  const def = sim.config.fighters[i]!;
  const action = s.action[i]!;
  const frames = s.actionFrame[i]!;

  if (action === A_LEDGE_GETUP) {
    if (frames >= def.ledgeGetupFrames) {
      climbOnto(sim, i, def.halfWidth);
      setAction(s, i, A_IDLE);
      updateMovement(sim, i);
    }
    return;
  }
  if (action === A_LEDGE_ROLL) {
    if (frames >= def.ledgeRollFrames) {
      climbOnto(sim, i, def.ledgeRollDistance);
      setAction(s, i, A_IDLE);
      updateMovement(sim, i);
    }
    return;
  }

  // A_LEDGE : suspendu.
  const left = s.ledgeTimer[i]! - 1;
  s.ledgeTimer[i] = left;
  if (left <= 0) {
    leaveLedge(sim, i);
    setAction(s, i, A_AIR);
    return;
  }
  if (frames < LEDGE_MIN_HANG_FRAMES) return;

  if (s.bufJump[i]! > 0) {
    s.bufJump[i] = 0;
    s.velY[i] = def.jumpVelocity;
    leaveLedge(sim, i);
    setAction(s, i, A_AIR);
    return;
  }
  if (s.bufAttack[i]! > 0 && def.moves[M_LEDGE_ATTACK] !== undefined) {
    s.bufAttack[i] = 0;
    climbOnto(sim, i, def.halfWidth);
    forceMove(s, i, M_LEDGE_ATTACK);
    return;
  }
  if (s.bufShield[i]! > 0) {
    s.bufShield[i] = 0;
    s.intangible[i] = def.ledgeRollFrames - 10;
    setAction(s, i, A_LEDGE_ROLL);
    return;
  }

  // Les options au stick demandent un geste franc : un stick déjà incliné à l'accroche ne compte pas.
  const input = s.input[i]!;
  const prev = s.prevInput[i]!;
  const facing = s.facing[i]!;
  const toward = inputStickX(input) * facing;
  const towardBefore = inputStickX(prev) * facing;
  const y = inputStickY(input);
  const yBefore = inputStickY(prev);

  if (
    (toward >= STICK_OPTION && towardBefore < STICK_OPTION) ||
    (y >= STICK_OPTION && yBefore < STICK_OPTION)
  ) {
    s.intangible[i] = def.ledgeGetupFrames - 5;
    setAction(s, i, A_LEDGE_GETUP);
    return;
  }
  if (
    (toward <= -STICK_OPTION && towardBefore > -STICK_OPTION) ||
    (y <= -STICK_OPTION && yBefore > -STICK_OPTION)
  ) {
    leaveLedge(sim, i);
    setAction(s, i, A_AIR);
  }
}

/** Vrai si un autre joueur occupe déjà le rebord `l`. */
function occupied(sim: Sim, l: number, players: number): boolean {
  for (let k = 0; k < players; k++) {
    if (sim.state.ledge[k] === l + 1) return true;
  }
  return false;
}

/**
 * Accroches de la frame, après le déplacement. Si deux joueurs atteignent le même rebord à la
 * même frame, le plus petit index l'obtient.
 */
export function resolveLedges(sim: Sim): void {
  const s = sim.state;
  const geo = sim.geo;
  const players = s.g[G_PLAYERS]!;

  for (let i = 0; i < players; i++) {
    // Délogé par un coup ou une saisie : le rebord est libéré.
    if (s.ledge[i] !== 0 && !isOnLedge(s.action[i]!)) leaveLedge(sim, i);
  }

  for (let i = 0; i < players; i++) {
    const action = s.action[i]!;
    if (action !== A_AIR && action !== A_TUMBLE && action !== A_HELPLESS) continue;
    if (sim.scratch.frozen[i] === 1 || s.ledgeCooldown[i]! > 0 || s.velY[i]! > 0) continue;
    if (inputStickY(s.input[i]!) <= STICK_HOLD_DOWN) continue;
    const def = sim.config.fighters[i]!;
    const x = s.posX[i]!;
    const y = s.posY[i]!;

    for (let l = 0; l < geo.ledgeCount; l++) {
      const side = geo.ledgeSide[l]!;
      const out = (x - geo.ledgeX[l]!) * side;
      if (out < 0 || out > LEDGE_REACH_X) continue;
      const up = geo.ledgeY[l]! - y;
      if (up < LEDGE_REACH_BELOW || up > def.height + LEDGE_REACH_ABOVE) continue;
      if (occupied(sim, l, players)) continue;

      const grabs = s.ledgeGrabs[i]!;
      const invuln = LEDGE_INVULN_FRAMES - LEDGE_INVULN_LOSS * grabs;
      s.ledge[i] = l + 1;
      s.ledgeGrabs[i] = grabs + 1;
      s.ledgeTimer[i] = LEDGE_MAX_HANG_FRAMES;
      s.intangible[i] = invuln > 0 ? invuln : 0;
      s.posX[i] = geo.ledgeX[l]! + side * def.halfWidth;
      s.posY[i] = geo.ledgeY[l]! - def.height;
      s.velX[i] = 0;
      s.velY[i] = 0;
      s.facing[i] = -side;
      s.fastFall[i] = 0;
      s.floatFrames[i] = 0;
      s.airDodged[i] = 0;
      s.tumble[i] = 0;
      s.jumpsLeft[i] = def.airJumps;
      setAction(s, i, A_LEDGE);
      // On ne s'accroche pas un objet à la main : il tombe.
      dropHeld(sim, i);
      emit(sim.events, EV_LEDGE, i, l);
      break;
    }
  }
}
