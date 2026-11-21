/**
 * Pilotage de la pose d'un combattant, commun au mannequin et à la figurine : repère les
 * changements d'action à chaque frame capturée, calcule la pose cible de l'action et la fond avec
 * la précédente. Ne dépend que de l'état lu dans la simulation : la pose reste juste en pause, au
 * ralenti, image par image et après un rollback.
 */
import {
  A_ATTACK,
  A_DASH,
  A_GRABBED,
  A_HITSTUN,
  A_IDLE,
  A_LAND,
  A_RUN,
  A_SHIELD,
  A_WALK,
  fxToFloat,
  type FighterDef,
  type FighterView,
  type MoveDef,
} from '@game/sim-core';
import { isTeleport } from '../interpolation.ts';
import {
  actionTiming,
  computePose,
  copyPose,
  createPose,
  createPoseInput,
  displayFrame,
  lerpPose,
  unwindPose,
  type Pose,
  type PoseInput,
} from './poses.ts';

/**
 * Frames simulées sur lesquelles une nouvelle action se fond dans la pose précédente : presque rien
 * vers un coup, un choc ou une garde (la réaction doit se voir tout de suite), davantage vers le
 * repos, la marche ou l'atterrissage (le corps se pose).
 */
export function blendFrames(action: number): number {
  if (action === A_ATTACK || action === A_HITSTUN || action === A_GRABBED || action === A_SHIELD) {
    return 1.5;
  }
  if (action === A_IDLE || action === A_WALK || action === A_LAND) return 5;
  return 3;
}

/** Actions dont le cycle des jambes suit la distance parcourue. */
const isStride = (action: number): boolean =>
  action === A_WALK || action === A_RUN || action === A_DASH;

const smooth = (t: number): number => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

export interface PoseDriver {
  /** À chaque frame simulée capturée. N'alloue rien. */
  capture(view: FighterView): void;
  /** Pose à afficher à l'instant `alpha` entre les deux dernières frames. N'alloue rien. */
  update(view: FighterView, alpha: number): Pose;
  /** Action et frame d'action retenues à la dernière capture. */
  readonly action: number;
  readonly frame: number;
  /** Entrée de la dernière pose calculée : frame affichée, temps forts et durée de l'action. */
  readonly input: Readonly<PoseInput>;
}

export function createPoseDriver(def: FighterDef, swing: MoveDef | undefined): PoseDriver {
  const input = createPoseInput();
  const from = createPose();
  const target = createPose();
  const shown = createPose();
  let action = -1;
  let frame = 0;
  let move = 0;
  let prevAction = -1;
  let prevFrame = 0;
  let age = 0;
  let fresh = true;
  let blend = blendFrames(A_IDLE);
  // Distance parcourue (hauteurs de combattant) depuis le début de la marche ou de la course.
  const height = fxToFloat(def.height);
  let stride = 0;
  let prevStride = 0;

  return {
    get action() {
      return action;
    },
    input,
    get frame() {
      return frame;
    },
    capture(view) {
      const restarted = view.action !== action || view.actionFrame < frame || view.move !== move;
      if (restarted) {
        copyPose(shown, from);
        unwindPose(from);
        if (isTeleport(action, view.action)) {
          // La simulation vient de déplacer le combattant : le décalage de la pose a fait son temps.
          from.offsetX = 0;
          from.offsetY = 0;
          from.offsetZ = 0;
        }
        age = 0;
        prevAction = -1;
        blend = blendFrames(view.action);
        if (!(isStride(view.action) && isStride(action))) {
          stride = 0;
          prevStride = 0;
        }
        actionTiming(def, view.action, view.move, input, swing);
      } else {
        prevAction = action;
      }
      prevStride = stride;
      if (isStride(view.action)) stride += Math.abs(view.velX) / height;
      prevFrame = frame;
      action = view.action;
      frame = view.actionFrame;
      move = view.move;
      age++;
    },
    update(view, alpha) {
      input.action = action;
      input.move = move;
      input.frame = displayFrame(prevAction, prevFrame, action, frame, alpha);
      input.grounded = view.grounded;
      input.velY = view.velY;
      input.forward = view.velX * view.facing;
      input.charge = view.charge;
      input.stride = prevStride + (stride - prevStride) * alpha;
      computePose(input, target);
      if (fresh) {
        copyPose(target, from);
        fresh = false;
      }
      lerpPose(from, target, smooth((age - 1 + alpha) / blend), shown);
      return shown;
    },
  };
}
