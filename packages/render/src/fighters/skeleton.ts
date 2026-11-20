/**
 * Squelette de la figurine (SPEC-visuals.md, phase 3). Il reprend exactement la géométrie des
 * poses du mannequin (`poses.ts`, `mannequin.ts`) : mêmes longueurs, mêmes pivots, mêmes angles.
 * La vue technique et les hitbox, qui viennent de la simulation, restent donc alignées.
 *
 * En pose de référence, bras et jambes pendent, légèrement écartés du corps : leurs volumes ne
 * touchent pas le tronc et le maillage ne les soude pas. La pose affichée les ramène dans le plan
 * du profil.
 */
import { Bone, Group, Skeleton } from 'three';
import { HAND_BOOST, handJoints } from './body.ts';
import { LEG_SIDE, SHOULDER, type Dims } from './mannequin.ts';
import { HIP_HEIGHT, TORSO, type Pose } from './poses.ts';
import { BONES, type BoneName } from './sdf.ts';

/** Écartement des bras et des jambes en pose de référence, en radians. */
const ARM_SPREAD = 0.42;
const LEG_SPREAD = 0.12;
/** Repli des doigts et du pouce, poing serré, en radians. */
const FINGER_CURL = 1.7;
const THUMB_CURL = 0.9;
/** Part de la flexion de la jambe que le pied compense pour rester à plat. */
const FOOT_LEVEL = 0.85;

export interface Rig {
  /** Repère du corps (déjà mis à l'échelle) : il porte les os et le maillage. */
  readonly root: Group;
  readonly bones: readonly Bone[];
  readonly skeleton: Skeleton;
  /** Matrice de référence de chaque os dans le repère du corps, dans l'ordre de `BONES`. */
  readonly bind: readonly Float64Array[];
  bone(name: BoneName): Bone;
  /**
   * Oriente les os selon `pose`. `headTurn` tourne en plus la tête autour de la verticale (vers la
   * caméra), sans changer la silhouette du corps. N'alloue rien.
   */
  apply(pose: Pose, headTurn: number): void;
  /**
   * Fermeture des mains, de 0 (ouverte) à 1 (poing serré), côté caméra et côté opposé
   * (SPEC-finition.md, phase 2).
   */
  setHands(front: number, back: number): void;
}

export function createRig(d: Dims): Rig {
  const root = new Group();
  root.name = 'rig';
  const bones = BONES.map((name) => {
    const b = new Bone();
    b.name = name;
    return b;
  });
  const by = (name: BoneName): Bone => bones[BONES.indexOf(name)]!;
  const hips = by('hips');
  const spine = by('spine');
  const neck = by('neck');
  const head = by('head');
  root.add(hips);
  hips.add(spine);
  spine.add(neck);
  neck.add(head);
  hips.position.set(0, HIP_HEIGHT * d.legScale, 0);
  neck.position.set(0, TORSO, 0);

  for (const side of ['F', 'B'] as const) {
    const sign = side === 'F' ? 1 : -1;
    const upper = by(`upperArm${side}`);
    const fore = by(`forearm${side}`);
    const hand = by(`hand${side}`);
    spine.add(upper);
    upper.add(fore);
    fore.add(hand);
    upper.position.set(0, SHOULDER, d.armSide * sign);
    fore.position.set(0, -d.upperArm, 0);
    hand.position.set(0, -d.forearm, 0);
    // Doigts aux jointures, pouce sur le côté de la paume (main agrandie autour du poignet).
    const joints = handJoints(d);
    const fingers = by(`fingers${side}`);
    const thumb = by(`thumb${side}`);
    hand.add(fingers, thumb);
    fingers.position.set(0, joints.knuckle * HAND_BOOST, 0);
    thumb.position.set(
      joints.thumb[0] * HAND_BOOST,
      joints.thumb[1] * HAND_BOOST,
      joints.thumb[2] * HAND_BOOST,
    );

    const thigh = by(`thigh${side}`);
    const shin = by(`shin${side}`);
    const foot = by(`foot${side}`);
    hips.add(thigh);
    thigh.add(shin);
    shin.add(foot);
    thigh.position.set(0, 0, LEG_SIDE * sign);
    shin.position.set(0, -d.thigh, 0);
    foot.position.set(0, -d.shin, 0);
  }

  // Os secondaires (cheveux, pans de tissu, jupe), orientés par les ressorts de dynamics.ts : à
  // l'arrière du crâne, entre les omoplates, à la taille.
  const r = d.headRadius;
  const tail1 = by('tail1');
  const tail2 = by('tail2');
  const cloth1 = by('cloth1');
  const cloth2 = by('cloth2');
  head.add(tail1);
  tail1.add(tail2);
  spine.add(cloth1);
  cloth1.add(cloth2);
  hips.add(by('skirt'));
  tail1.position.set(-r * 0.7, r * 1.45, 0);
  tail2.position.set(0, -r, 0);
  cloth1.position.set(-d.torsoWidth * 0.45, SHOULDER, 0);
  cloth2.position.set(0, -0.12, 0);
  by('skirt').position.set(0, 0.04, 0);

  // Pose de référence : membres écartés, le reste droit.
  by('upperArmF').rotation.x = -ARM_SPREAD;
  by('upperArmB').rotation.x = ARM_SPREAD;
  by('thighF').rotation.x = -LEG_SPREAD;
  by('thighB').rotation.x = LEG_SPREAD;
  root.updateMatrixWorld(true);
  const bind = bones.map((b) => Float64Array.from(b.matrixWorld.elements));
  const skeleton = new Skeleton(bones);

  const upperArmF = by('upperArmF');
  const upperArmB = by('upperArmB');
  const forearmF = by('forearmF');
  const forearmB = by('forearmB');
  const thighF = by('thighF');
  const thighB = by('thighB');
  const shinF = by('shinF');
  const shinB = by('shinB');
  const footF = by('footF');
  const footB = by('footB');
  const fingersF = by('fingersF');
  const fingersB = by('fingersB');
  const thumbF = by('thumbF');
  const thumbB = by('thumbB');

  return {
    root,
    bones,
    skeleton,
    bind,
    bone: by,
    apply(p, headTurn) {
      hips.position.y = p.hipY * d.legScale;
      spine.rotation.z = -p.torso;
      neck.rotation.z = -p.head;
      head.rotation.y = headTurn;
      upperArmF.rotation.set(0, 0, p.armF);
      upperArmB.rotation.set(0, 0, p.armB);
      forearmF.rotation.z = p.foreF;
      forearmB.rotation.z = p.foreB;
      thighF.rotation.set(0, 0, p.legF);
      thighB.rotation.set(0, 0, p.legB);
      shinF.rotation.z = p.shinF;
      shinB.rotation.z = p.shinB;
      footF.rotation.z = -(p.legF + p.shinF) * FOOT_LEVEL;
      footB.rotation.z = -(p.legB + p.shinB) * FOOT_LEVEL;
    },
    setHands(front, back) {
      // Les doigts se replient vers la paume, tournée vers le corps : sens opposés des deux côtés.
      fingersF.rotation.x = front * FINGER_CURL;
      fingersB.rotation.x = -back * FINGER_CURL;
      thumbF.rotation.x = front * THUMB_CURL;
      thumbB.rotation.x = -back * THUMB_CURL;
    },
  };
}
