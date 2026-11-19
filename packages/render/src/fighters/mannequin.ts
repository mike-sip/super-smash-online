/**
 * Mannequin procédural : torse, tête, bras et jambes en formes simples, animés par `poses.ts`.
 *
 * Toutes les pièces de tous les combattants tiennent en deux objets dessinés par instances (les
 * boîtes, les têtes) : deux appels de dessin, quel que soit le nombre de joueurs.
 *
 * Un style facultatif par joueur (`MannequinStyle`) donne à chaque personnage ses couleurs, ses
 * proportions et quelques pièces ajoutées (épaulières, coiffe…), sans appel de dessin de plus : les
 * pièces ajoutées sont des boîtes de plus dans le même objet.
 */
import { A_DEAD, fxToFloat } from '@game/sim-core';
import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import { isTeleport } from '../interpolation.ts';
import {
  FOREARM,
  HEAD_RADIUS,
  HIP_HEIGHT,
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

/** Couleur d'une pièce : couleur du style, couleur du joueur, ou couleur fixe 0xRRGGBB. */
export type MannequinColor = 'primary' | 'secondary' | 'player' | number;

/**
 * Pièce ajoutée : une boîte portée par la tête, le torse ou le bassin, qu'elle suit. Position et
 * dimensions en hauteurs de combattant, combattant de profil tourné vers +x, `z` vers la caméra.
 */
export interface MannequinPart {
  readonly anchor: 'head' | 'torso' | 'hips';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** Rotation autour de l'axe de profondeur, en radians, positive vers l'avant. */
  readonly angle: number;
  readonly color: MannequinColor;
  /** Si vrai, une copie symétrique est placée de l'autre côté du corps. */
  readonly mirror?: boolean;
}

/** Style d'un mannequin. Le module `fighters` en fournit un par personnage (`FighterLook`). */
export interface MannequinStyle {
  /** Torse et jambes. */
  readonly primary: number;
  /** Bras et tête. */
  readonly secondary: number;
  /** Proportions relatives au mannequin standard (1 = inchangé). La taille totale est conservée. */
  readonly build: {
    readonly torsoWidth: number;
    readonly limbThickness: number;
    readonly headSize: number;
    readonly legLength: number;
    readonly armLength: number;
    readonly shoulderWidth: number;
  };
  readonly parts: readonly MannequinPart[];
}

/** Boîtes par combattant : torse, visage, deux segments par bras et par jambe. */
const BOXES = 10;
/** Pièces ajoutées par combattant au plus, copies symétriques comprises. */
export const MAX_PARTS = 8;
/** Frames simulées sur lesquelles une nouvelle action se fond dans la pose précédente. */
const BLEND_FRAMES = 3;

// Dimensions des pièces, en hauteurs de combattant.
const TORSO_WIDTH = 0.14;
const TORSO_DEPTH = 0.22;
const ARM_THICKNESS = 0.07;
const LEG_THICKNESS = 0.085;
const ARM_SIDE = 0.15;
export const LEG_SIDE = 0.065;
/** Les épaules sont un peu sous le haut du torse. */
export const SHOULDER = TORSO - 0.04;
/** Part de blanc mêlée à la couleur d'un combattant intangible. */
const PALE_MIX = 0.7;
/** Assombrissement des membres du côté opposé à la caméra, pour lire la profondeur. */
const FAR_SHADE = 0.72;
const VISOR_COLOR = 0xf8fafc;

const ANCHOR_HEAD = 0;
const ANCHOR_TORSO = 1;
const ANCHOR_HIPS = 2;

/** Dimensions d'un mannequin, déduites de son style. */
export interface Dims {
  readonly torsoWidth: number;
  readonly torsoDepth: number;
  readonly armThickness: number;
  readonly legThickness: number;
  readonly armSide: number;
  readonly headRadius: number;
  readonly headScale: number;
  readonly upperArm: number;
  readonly forearm: number;
  readonly thigh: number;
  readonly shin: number;
  /** Les poses sont calculées pour des jambes standard : la hauteur du bassin suit leur longueur. */
  readonly legScale: number;
  /** Facteur qui ramène la taille totale à celle du combattant. */
  readonly normalize: number;
}

export function dimsOf(style: MannequinStyle | undefined): Dims {
  const b = style?.build;
  const torso = b?.torsoWidth ?? 1;
  const limb = b?.limbThickness ?? 1;
  const head = b?.headSize ?? 1;
  const leg = b?.legLength ?? 1;
  const arm = b?.armLength ?? 1;
  const shoulders = b?.shoulderWidth ?? 1;
  const standard = HIP_HEIGHT + TORSO + 2 * HEAD_RADIUS;
  return {
    torsoWidth: TORSO_WIDTH * torso,
    torsoDepth: TORSO_DEPTH * shoulders,
    armThickness: ARM_THICKNESS * limb,
    legThickness: LEG_THICKNESS * limb,
    armSide: ARM_SIDE * shoulders,
    headRadius: HEAD_RADIUS * head,
    headScale: head,
    upperArm: UPPER_ARM * arm,
    forearm: FOREARM * arm,
    thigh: THIGH * leg,
    shin: SHIN * leg,
    legScale: leg,
    normalize: standard / (HIP_HEIGHT * leg + TORSO + 2 * HEAD_RADIUS * head),
  };
}

/** Pièce prête à dessiner : copies symétriques développées, ancre en entier. */
interface Part {
  readonly anchor: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly angle: number;
  readonly color: MannequinColor;
}

function partsOf(style: MannequinStyle | undefined): Part[] {
  const parts: Part[] = [];
  for (const p of style?.parts ?? []) {
    const anchor =
      p.anchor === 'head' ? ANCHOR_HEAD : p.anchor === 'torso' ? ANCHOR_TORSO : ANCHOR_HIPS;
    const base = { ...p, anchor };
    parts.push(base);
    if (p.mirror === true) parts.push({ ...base, z: -p.z });
  }
  if (parts.length > MAX_PARTS) {
    throw new Error(
      `Un mannequin porte au plus ${MAX_PARTS} pièces ajoutées (reçu ${parts.length}).`,
    );
  }
  return parts;
}

interface Body {
  readonly anchor: Group;
  readonly height: number;
  readonly style: MannequinStyle | undefined;
  readonly dims: Dims;
  readonly parts: readonly Part[];
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

/**
 * Mannequins stylés : `styleOf(player)` donne le style de chaque joueur, ou `undefined` pour le
 * mannequin standard aux couleurs du joueur.
 */
export function createStyledMannequins(
  styleOf: (player: number) => MannequinStyle | undefined,
): FighterVisualsFactory {
  return (config) => {
    const players = config.fighters.length;
    const root = new Group();
    root.name = 'fighters';
    // Coup de l'objet à frapper (module stages-items), pour rythmer sa pose.
    const swing = config.entities?.find((def) => def.item?.swing !== undefined)?.item?.swing;

    const boxGeometry = new BoxGeometry(1, 1, 1);
    const headGeometry = new SphereGeometry(0.5, 16, 12);
    const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 });
    // Boîtes du corps de tous les joueurs d'abord, puis leurs pièces ajoutées.
    const boxes = new InstancedMesh(boxGeometry, material, players * (BOXES + MAX_PARTS));
    const heads = new InstancedMesh(headGeometry, material, players);
    // Les instances bougent à chaque image : pas de test de visibilité sur une boîte englobante figée.
    boxes.frustumCulled = false;
    heads.frustumCulled = false;
    root.add(boxes, heads);
    const partIndex = (player: number, k: number): number =>
      players * BOXES + player * MAX_PARTS + k;

    const bodies: Body[] = [];
    const color = new Color();
    const white = new Color(0xffffff);
    for (let i = 0; i < players; i++) {
      const def = config.fighters[i]!;
      const style = styleOf(i);
      const anchor = new Group();
      anchor.name = `fighter-${i}`;
      anchor.visible = false;
      root.add(anchor);
      bodies.push({
        anchor,
        height: fxToFloat(def.height),
        style,
        dims: dimsOf(style),
        parts: partsOf(style),
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

    function resolve(c: MannequinColor, style: MannequinStyle, player: number): number {
      if (c === 'primary') return style.primary;
      if (c === 'secondary') return style.secondary;
      if (c === 'player') return PLAYER_COLORS[player % PLAYER_COLORS.length]!;
      return c;
    }

    /** Peint le combattant à ses couleurs, ou presque blanc s'il est intangible. */
    function paint(player: number, pale: boolean): void {
      const body = bodies[player]!;
      const style = body.style;
      const playerColor = PLAYER_COLORS[player % PLAYER_COLORS.length]!;
      for (let b = 0; b < BOXES; b++) {
        // Ordre des boîtes : torse, visage, bras F (2), bras B (2), jambe F (2), jambe B (2).
        const far = b === 4 || b === 5 || b === 8 || b === 9;
        const arm = b >= 2 && b <= 5;
        let hex = playerColor;
        if (style !== undefined) hex = arm ? style.secondary : style.primary;
        if (b === 1) color.setHex(VISOR_COLOR);
        else color.setHex(hex).multiplyScalar(far ? FAR_SHADE : 1);
        if (pale) color.lerp(white, PALE_MIX);
        boxes.setColorAt(player * BOXES + b, color);
      }
      if (style !== undefined) {
        for (let k = 0; k < body.parts.length; k++) {
          color.setHex(resolve(body.parts[k]!.color, style, player));
          if (pale) color.lerp(white, PALE_MIX);
          boxes.setColorAt(partIndex(player, k), color);
        }
      }
      color.setHex(style === undefined ? playerColor : style.secondary);
      if (pale) color.lerp(white, PALE_MIX);
      heads.setColorAt(player, color);
      boxes.instanceColor!.needsUpdate = true;
      heads.instanceColor!.needsUpdate = true;
    }
    for (let i = 0; i < players; i++) {
      for (let k = 0; k < MAX_PARTS; k++) boxes.setColorAt(partIndex(i, k), white);
      paint(i, false);
    }

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

    /** Membre de deux segments partant de (x, y). */
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

    /** Pièce ajoutée `k`, dans le repère (ox, oy) tourné de `rot` de la partie qui la porte. */
    function attached(
      player: number,
      k: number,
      ox: number,
      oy: number,
      rot: number,
      scale: number,
    ): void {
      const p = bodies[player]!.parts[k]!;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const x = p.x * scale;
      const y = p.y * scale;
      box(
        partIndex(player, k),
        ox + x * cos - y * sin,
        oy + x * sin + y * cos,
        p.z * scale,
        rot - p.angle,
        p.width * scale,
        p.height * scale,
        p.depth * scale,
      );
    }

    function hide(player: number): void {
      world.makeScale(0, 0, 0);
      for (let b = 0; b < BOXES; b++) boxes.setMatrixAt(player * BOXES + b, world);
      for (let k = 0; k < MAX_PARTS; k++) boxes.setMatrixAt(partIndex(player, k), world);
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
          actionTiming(config.fighters[player]!, view.action, view.move, body.input, swing);
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
        const d = body.dims;
        anchor.updateMatrix();
        const h = body.height * d.normalize;
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
        const hipY = pose.hipY * d.legScale;
        box(
          first,
          (upX * TORSO) / 2,
          hipY + (upY * TORSO) / 2,
          0,
          -pose.torso,
          d.torsoWidth,
          TORSO,
          d.torsoDepth,
        );

        const r = d.headRadius;
        const neck = pose.torso + pose.head;
        const headX = upX * TORSO + Math.sin(neck) * r;
        const headY = hipY + upY * TORSO + Math.cos(neck) * r;
        part.makeScale(r * 2, r * 2, r * 2).setPosition(headX, headY, 0);
        world.multiplyMatrices(bodyMatrix, part);
        heads.setMatrixAt(player, world);
        // Visage : une visière à l'avant de la tête, pour lire l'orientation.
        box(
          first + 1,
          headX + Math.cos(neck) * r * 0.8,
          headY - Math.sin(neck) * r * 0.8,
          0,
          -neck,
          r * 0.6,
          r * 0.5,
          r * 1.5,
        );

        const shoulderX = upX * SHOULDER;
        const shoulderY = hipY + upY * SHOULDER;
        limb(
          first + 2,
          shoulderX,
          shoulderY,
          d.armSide,
          pose.armF,
          pose.foreF,
          d.upperArm,
          d.forearm,
          d.armThickness,
        );
        limb(
          first + 4,
          shoulderX,
          shoulderY,
          -d.armSide,
          pose.armB,
          pose.foreB,
          d.upperArm,
          d.forearm,
          d.armThickness,
        );
        limb(first + 6, 0, hipY, LEG_SIDE, pose.legF, pose.shinF, d.thigh, d.shin, d.legThickness);
        limb(first + 8, 0, hipY, -LEG_SIDE, pose.legB, pose.shinB, d.thigh, d.shin, d.legThickness);

        const parts = body.parts;
        for (let k = 0; k < parts.length; k++) {
          const a = parts[k]!.anchor;
          if (a === ANCHOR_HEAD) attached(player, k, headX, headY, -neck, d.headScale);
          else if (a === ANCHOR_TORSO) attached(player, k, 0, hipY, -pose.torso, 1);
          else attached(player, k, 0, hipY, 0, 1);
        }
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
}

/** Mannequins standard, aux couleurs des joueurs. */
export const createMannequins: FighterVisualsFactory = createStyledMannequins(() => undefined);
