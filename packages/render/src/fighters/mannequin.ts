/**
 * Mannequin procédural : torse, tête, bras et jambes en formes simples, animés par `poses.ts`.
 *
 * Toutes les pièces de tous les combattants tiennent en deux objets dessinés par instances (les
 * boîtes, les têtes) : deux appels de dessin, quel que soit le nombre de joueurs.
 */
import { A_DEAD, fxToFloat } from '@game/sim-core';
import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  SphereGeometry,
} from 'three';
import { isTeleport } from '../interpolation.ts';
import {
  FOREARM,
  HEAD_RADIUS,
  SHIN,
  SPIN_PIVOT_Y,
  THIGH,
  TORSO,
  UPPER_ARM,
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
import { PLAYER_COLORS, type FighterVisualsFactory } from './visual.ts';

/** Boîtes par combattant : torse, visage, deux segments par bras et par jambe. */
const BOXES = 10;
/** Frames simulées sur lesquelles une nouvelle action se fond dans la pose précédente. */
const BLEND_FRAMES = 3;

// Dimensions des pièces, en hauteurs de combattant.
const TORSO_WIDTH = 0.14;
const TORSO_DEPTH = 0.22;
const ARM_THICKNESS = 0.07;
const LEG_THICKNESS = 0.085;
const ARM_SIDE = 0.15;
const LEG_SIDE = 0.065;
/** Les épaules sont un peu sous le haut du torse. */
const SHOULDER = TORSO - 0.04;
/** Part de blanc mêlée à la couleur d'un combattant intangible. */
const PALE_MIX = 0.7;
/** Assombrissement des membres du côté opposé à la caméra, pour lire la profondeur. */
const FAR_SHADE = 0.72;

interface Body {
  readonly anchor: Group;
  readonly height: number;
  readonly input: PoseInput;
  /** Pose affichée au moment du dernier changement d'action. */
  readonly from: Pose;
  readonly target: Pose;
  readonly shown: Pose;
  action: number;
  frame: number;
  move: number;
  prevAction: number;
  prevFrame: number;
  /** Frames capturées depuis le dernier changement d'action. */
  age: number;
  /** Vrai tant qu'aucune pose n'a été affichée : rien à fondre. */
  fresh: boolean;
  /** Vrai si le combattant est peint aux couleurs pâles de l'intangibilité. */
  pale: boolean;
}

const smooth = (t: number): number => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

export const createMannequins: FighterVisualsFactory = (config) => {
  const players = config.fighters.length;
  const root = new Group();
  root.name = 'fighters';

  const boxGeometry = new BoxGeometry(1, 1, 1);
  const headGeometry = new SphereGeometry(0.5, 16, 12);
  const material = new MeshLambertMaterial({ color: 0xffffff });
  const boxes = new InstancedMesh(boxGeometry, material, players * BOXES);
  const heads = new InstancedMesh(headGeometry, material, players);
  // Les instances bougent à chaque image : pas de test de visibilité sur une boîte englobante figée.
  boxes.frustumCulled = false;
  heads.frustumCulled = false;
  root.add(boxes, heads);

  const bodies: Body[] = [];
  const color = new Color();
  const white = new Color(0xffffff);
  for (let i = 0; i < players; i++) {
    const def = config.fighters[i]!;
    const anchor = new Group();
    anchor.name = `fighter-${i}`;
    anchor.visible = false;
    root.add(anchor);
    bodies.push({
      anchor,
      height: fxToFloat(def.height),
      input: createPoseInput(),
      from: createPose(),
      target: createPose(),
      shown: createPose(),
      action: -1,
      frame: 0,
      move: 0,
      prevAction: -1,
      prevFrame: 0,
      age: 0,
      fresh: true,
      pale: false,
    });
  }

  /** Peint le combattant à sa couleur de joueur, ou presque blanc s'il est intangible. */
  function paint(player: number, pale: boolean): void {
    const base = PLAYER_COLORS[player % PLAYER_COLORS.length]!;
    for (let b = 0; b < BOXES; b++) {
      // Ordre des boîtes : torse, visage, bras F (2), bras B (2), jambe F (2), jambe B (2).
      const far = b === 4 || b === 5 || b === 8 || b === 9;
      if (b === 1) color.setHex(0xf8fafc);
      else color.setHex(base).multiplyScalar(far ? FAR_SHADE : 1);
      if (pale) color.lerp(white, PALE_MIX);
      boxes.setColorAt(player * BOXES + b, color);
    }
    color.setHex(base);
    if (pale) color.lerp(white, PALE_MIX);
    heads.setColorAt(player, color);
    boxes.instanceColor!.needsUpdate = true;
    heads.instanceColor!.needsUpdate = true;
  }
  for (let i = 0; i < players; i++) paint(i, false);

  // Matrices de travail, créées une fois.
  const bodyMatrix = new Matrix4();
  const scratch = new Matrix4();
  const part = new Matrix4();
  const world = new Matrix4();

  /** Boîte de dimensions (width, length, depth), centrée en (x, y, z), tournée de `angle` autour de z. */
  function box(
    index: number,
    x: number,
    y: number,
    z: number,
    angle: number,
    width: number,
    length: number,
    depth: number,
  ): void {
    part.makeRotationZ(angle);
    const e = part.elements;
    e[0]! *= width;
    e[1]! *= width;
    e[4]! *= length;
    e[5]! *= length;
    e[10] = depth;
    e[12] = x;
    e[13] = y;
    e[14] = z;
    world.multiplyMatrices(bodyMatrix, part);
    boxes.setMatrixAt(index, world);
  }

  /** Membre de deux segments partant de (x, y) ; renvoie l'index de boîte suivant. */
  function limb(
    index: number,
    x: number,
    y: number,
    z: number,
    upper: number,
    lower: number,
    upperLength: number,
    lowerLength: number,
    thickness: number,
  ): void {
    const ux = Math.sin(upper);
    const uy = -Math.cos(upper);
    box(
      index,
      x + (ux * upperLength) / 2,
      y + (uy * upperLength) / 2,
      z,
      upper,
      thickness,
      upperLength,
      thickness,
    );
    const jx = x + ux * upperLength;
    const jy = y + uy * upperLength;
    const angle = upper + lower;
    const lx = Math.sin(angle);
    const ly = -Math.cos(angle);
    box(
      index + 1,
      jx + (lx * lowerLength) / 2,
      jy + (ly * lowerLength) / 2,
      z,
      angle,
      thickness,
      lowerLength,
      thickness,
    );
  }

  function hide(player: number): void {
    world.makeScale(0, 0, 0);
    for (let b = 0; b < BOXES; b++) boxes.setMatrixAt(player * BOXES + b, world);
    heads.setMatrixAt(player, world);
  }

  for (let i = 0; i < players; i++) hide(i);

  return {
    root,

    capture(player, view) {
      const body = bodies[player]!;
      const restarted =
        view.action !== body.action || view.actionFrame < body.frame || view.move !== body.move;
      if (restarted) {
        copyPose(body.shown, body.from);
        unwindPose(body.from);
        if (isTeleport(body.action, view.action)) {
          // La simulation vient de déplacer le combattant : le décalage de la pose a fait son temps.
          body.from.offsetX = 0;
          body.from.offsetY = 0;
          body.from.offsetZ = 0;
        }
        body.age = 0;
        body.prevAction = -1;
        actionTiming(config.fighters[player]!, view.action, view.move, body.input);
      } else {
        body.prevAction = body.action;
      }
      body.prevFrame = body.frame;
      body.action = view.action;
      body.frame = view.actionFrame;
      body.move = view.move;
      body.age++;
    },

    update(player, x, y, view, alpha) {
      const body = bodies[player]!;
      const anchor = body.anchor;
      anchor.position.set(x, y, 0);
      anchor.rotation.y = view.facing === 1 ? 0 : Math.PI;
      anchor.visible = view.action !== A_DEAD;
      boxes.instanceMatrix.needsUpdate = true;
      heads.instanceMatrix.needsUpdate = true;
      if (!anchor.visible) {
        hide(player);
        return;
      }
      // Les couleurs ne sont réécrites que lorsque l'intangibilité commence ou cesse.
      if (view.intangible !== body.pale) {
        body.pale = view.intangible;
        paint(player, body.pale);
      }

      const input = body.input;
      input.action = body.action;
      input.move = body.move;
      input.frame = displayFrame(body.prevAction, body.prevFrame, body.action, body.frame, alpha);
      input.grounded = view.grounded;
      input.velY = view.velY;
      input.forward = view.velX * view.facing;
      input.charge = view.charge;
      computePose(input, body.target);

      const pose = body.shown;
      if (body.fresh) {
        copyPose(body.target, body.from);
        body.fresh = false;
      }
      lerpPose(body.from, body.target, smooth((body.age - 1 + alpha) / BLEND_FRAMES), pose);

      // Repère du corps : ancre, échelle, décalages, rotation verticale, rotation autour du centre.
      anchor.updateMatrix();
      const h = body.height;
      bodyMatrix.copy(anchor.matrix);
      bodyMatrix.multiply(scratch.makeScale(h, h, h));
      scratch.makeRotationY(pose.yaw).setPosition(pose.offsetX, pose.offsetY, pose.offsetZ);
      bodyMatrix.multiply(scratch);
      const sinSpin = Math.sin(pose.spin);
      const cosSpin = Math.cos(pose.spin);
      scratch
        .makeRotationZ(-pose.spin)
        .setPosition(-SPIN_PIVOT_Y * sinSpin, SPIN_PIVOT_Y * (1 - cosSpin), 0);
      bodyMatrix.multiply(scratch);

      const first = player * BOXES;
      const upX = Math.sin(pose.torso);
      const upY = Math.cos(pose.torso);
      const hipY = pose.hipY;
      box(
        first,
        (upX * TORSO) / 2,
        hipY + (upY * TORSO) / 2,
        0,
        -pose.torso,
        TORSO_WIDTH,
        TORSO,
        TORSO_DEPTH,
      );

      const neck = pose.torso + pose.head;
      const headX = upX * TORSO + Math.sin(neck) * HEAD_RADIUS;
      const headY = hipY + upY * TORSO + Math.cos(neck) * HEAD_RADIUS;
      part
        .makeScale(HEAD_RADIUS * 2, HEAD_RADIUS * 2, HEAD_RADIUS * 2)
        .setPosition(headX, headY, 0);
      world.multiplyMatrices(bodyMatrix, part);
      heads.setMatrixAt(player, world);
      // Visage : une visière à l'avant de la tête, pour lire l'orientation.
      box(
        first + 1,
        headX + Math.cos(neck) * HEAD_RADIUS * 0.8,
        headY - Math.sin(neck) * HEAD_RADIUS * 0.8,
        0,
        -neck,
        HEAD_RADIUS * 0.6,
        HEAD_RADIUS * 0.5,
        HEAD_RADIUS * 1.5,
      );

      const shoulderX = upX * SHOULDER;
      const shoulderY = hipY + upY * SHOULDER;
      limb(
        first + 2,
        shoulderX,
        shoulderY,
        ARM_SIDE,
        pose.armF,
        pose.foreF,
        UPPER_ARM,
        FOREARM,
        ARM_THICKNESS,
      );
      limb(
        first + 4,
        shoulderX,
        shoulderY,
        -ARM_SIDE,
        pose.armB,
        pose.foreB,
        UPPER_ARM,
        FOREARM,
        ARM_THICKNESS,
      );
      limb(first + 6, 0, hipY, LEG_SIDE, pose.legF, pose.shinF, THIGH, SHIN, LEG_THICKNESS);
      limb(first + 8, 0, hipY, -LEG_SIDE, pose.legB, pose.shinB, THIGH, SHIN, LEG_THICKNESS);
    },

    dispose() {
      boxGeometry.dispose();
      headGeometry.dispose();
      material.dispose();
      boxes.dispose();
      heads.dispose();
    },
  };
};
