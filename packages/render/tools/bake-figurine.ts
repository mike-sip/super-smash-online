/**
 * Exporte la figurine procédurale d'un personnage en modèle glTF animé (`.glb`), au format attendu
 * par `createGltfFighters` (docs : `assets/fighters/README.md`).
 *
 * Deux usages :
 * - vérifier le pipeline de bout en bout, avec un modèle dont chaque clip est connu ;
 * - donner aux artistes un point de départ dans Blender : squelette, proportions, noms des clips
 *   et durées exactes (en frames) de chaque attaque, tirés de la frame data du personnage.
 *
 * Usage, depuis la racine du dépôt : `node packages/render/tools/bake-figurine.ts <id> [sortie]`
 * (sortie par défaut : `assets/fighters/<id>/model.glb`).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  A_AIR,
  A_AIRDODGE,
  A_ATTACK,
  A_BRAKE,
  A_CROUCH,
  A_DASH,
  A_DOWN,
  A_GRAB,
  A_GRABBED,
  A_GRABBING,
  A_GRAB_RELEASE,
  A_HELPLESS,
  A_HITSTUN,
  A_IDLE,
  A_ITEM_THROW,
  A_JUMPSQUAT,
  A_LAND,
  A_LEDGE,
  A_LEDGE_GETUP,
  A_LEDGE_ROLL,
  A_ROLL,
  A_RUN,
  A_SHIELD,
  A_SHIELDSTUN,
  A_SHIELD_BREAK,
  A_SHIELD_DROP,
  A_SPOTDODGE,
  A_TECH,
  A_THROW,
  A_TUMBLE,
  A_TURN,
  A_WALK,
  M_BAIR,
  M_DAIR,
  M_FAIR,
  M_NAIR,
  M_UAIR,
  type FighterDef,
} from '@game/sim-core';
import {
  AnimationClip,
  Bone,
  BufferAttribute,
  Color,
  Group,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  QuaternionKeyframeTrack,
  Scene,
  Skeleton,
  SkinnedMesh,
  Vector3,
  VectorKeyframeTrack,
} from 'three';
import { character, isFighterId } from '../../fighters/src/index.ts';
import { paletteOf } from '../src/fighters/body.ts';
import { MOVE_CLIPS, THROW_CLIPS } from '../src/fighters/clips.ts';
import { figurineBody, handCurl } from '../src/fighters/figurine.ts';
import {
  RUN_CYCLE_LENGTH,
  SPIN_PIVOT_Y,
  WALK_CYCLE_LENGTH,
  actionTiming,
  computePose,
  createPose,
  createPoseInput,
} from '../src/fighters/poses.ts';
import { ZONES } from '../src/fighters/sdf.ts';
import { bakeFace, writeGlb } from './gltf-bake.ts';

const FPS = 60;
const AERIALS = new Set([M_NAIR, M_FAIR, M_BAIR, M_UAIR, M_DAIR]);

/** Un clip à échantillonner : action de la simulation et réglage de l'entrée des poses. */
interface Spec {
  readonly name: string;
  readonly action: number;
  readonly move?: number;
  readonly grounded?: boolean;
  readonly velY?: number;
  readonly forward?: number;
  /** Clip en boucle : période en frames (fractionnaire : la boucle se referme sans saut). */
  readonly loop?: number;
  /** Cycle de pas : distance d'un cycle, en hauteurs de combattant. */
  readonly stride?: number;
  /** Durée en frames quand la simulation n'en donne pas. */
  readonly frames?: number;
  /** Smash en charge : frame figée de l'attaque. */
  readonly chargeFrame?: number;
}

function specs(def: FighterDef): Spec[] {
  const list: Spec[] = [
    { name: 'idle', action: A_IDLE, loop: (2 * Math.PI) / 0.09 },
    { name: 'walk', action: A_WALK, stride: WALK_CYCLE_LENGTH, forward: 1 },
    { name: 'run', action: A_RUN, stride: RUN_CYCLE_LENGTH, forward: 2 },
    { name: 'dash', action: A_DASH, forward: 2 },
    { name: 'brake', action: A_BRAKE },
    { name: 'turn', action: A_TURN },
    { name: 'crouch', action: A_CROUCH, loop: 60 },
    { name: 'jumpsquat', action: A_JUMPSQUAT },
    { name: 'jump', action: A_AIR, grounded: false, velY: 1, frames: 30 },
    { name: 'fall', action: A_AIR, grounded: false, velY: -1, loop: 60 },
    { name: 'land', action: A_LAND },
    { name: 'hitstun', action: A_HITSTUN, grounded: false, frames: 40 },
    { name: 'tumble', action: A_TUMBLE, grounded: false, loop: (2 * Math.PI) / 0.22 },
    { name: 'tech', action: A_TECH },
    { name: 'down', action: A_DOWN },
    { name: 'shield', action: A_SHIELD, loop: 60 },
    { name: 'shieldstun', action: A_SHIELDSTUN, frames: 12 },
    { name: 'shield_drop', action: A_SHIELD_DROP },
    { name: 'shield_break', action: A_SHIELD_BREAK, frames: 60 },
    { name: 'spotdodge', action: A_SPOTDODGE },
    { name: 'roll', action: A_ROLL },
    { name: 'airdodge', action: A_AIRDODGE, grounded: false },
    { name: 'grab', action: A_GRAB },
    { name: 'grab_hold', action: A_GRABBING, loop: 60 },
    { name: 'grabbed', action: A_GRABBED, loop: 60 },
    { name: 'grab_release', action: A_GRAB_RELEASE },
    { name: 'ledge', action: A_LEDGE, grounded: false, loop: 60 },
    { name: 'ledge_getup', action: A_LEDGE_GETUP },
    { name: 'ledge_roll', action: A_LEDGE_ROLL },
    { name: 'item_throw', action: A_ITEM_THROW },
    { name: 'helpless', action: A_HELPLESS, grounded: false, loop: (2 * Math.PI) / 0.25 },
  ];
  THROW_CLIPS.forEach((name, k) => list.push({ name, action: A_THROW, move: k }));
  def.moves.forEach((m, slot) => {
    if (m === undefined || m.totalFrames <= 0) return;
    const name = MOVE_CLIPS[slot]!;
    const grounded = !AERIALS.has(slot);
    list.push({ name, action: A_ATTACK, move: slot, grounded });
    if (m.charge !== undefined) {
      list.push({
        name: `${name}_charge`,
        action: A_ATTACK,
        move: slot,
        grounded,
        loop: 60,
        chargeFrame: m.charge.frame,
      });
    }
  });
  return list;
}

async function main(): Promise<void> {
  const id = process.argv[2];
  if (id === undefined || !isFighterId(id)) {
    console.error('Usage : node packages/render/tools/bake-figurine.ts <id> [sortie.glb]');
    process.exit(1);
  }
  // Un personnage animé à la main (tools/characters/<id>.ts) a déjà son modèle à cet endroit :
  // la figurine ne l'écrase que sur une sortie donnée explicitement.
  const authored = existsSync(new URL(`./characters/${id}.ts`, import.meta.url));
  if (authored && process.argv[3] === undefined) {
    console.error(
      `${id} a un modèle animé à la main : donnez un fichier de sortie pour ne pas l'écraser.`,
    );
    process.exit(1);
  }
  const out = resolve(process.argv[3] ?? `assets/fighters/${id}/model.glb`);
  const c = character(id);
  const style = c.look;
  const def = c.def;
  const { rig, geometry, dims } = figurineBody(style);

  // Couleurs : celles de la figurine (palette par zone), en couleurs de sommets.
  const palette = paletteOf(style, 0, 0).map((hex) => new Color(hex));
  const zone = geometry.getAttribute('aZone');
  const zone2 = geometry.getAttribute('aZone2');
  const mix = geometry.getAttribute('aZoneMix');
  const colors = new Float32Array(zone.count * 3);
  const tmp = new Color();
  for (let v = 0; v < zone.count; v++) {
    const a = palette[Math.round(zone.getX(v))]!;
    const b = palette[Math.round(zone2.getX(v))]!;
    tmp.copy(a).lerp(b, mix.getX(v));
    colors.set([tmp.r, tmp.g, tmp.b], v * 3);
  }
  geometry.deleteAttribute('aZone');
  geometry.deleteAttribute('aZone2');
  geometry.deleteAttribute('aZoneMix');
  geometry.setAttribute('color', new BufferAttribute(colors, 3));

  // Os racine au-dessus des hanches : il porte les décalages, la rotation et la vrille des poses.
  const top = new Bone();
  top.name = 'root';
  const hips = rig.bone('hips');
  rig.root.remove(hips);
  top.add(hips);
  rig.root.add(top);
  // Le corps de la figurine regarde vers +x ; les modèles glTF regardent vers +z.
  rig.root.rotation.y = -Math.PI / 2;
  const holder = new Group();
  holder.name = c.name;
  holder.add(rig.root);
  holder.updateMatrixWorld(true);

  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
  material.name = 'body';
  const mesh = new SkinnedMesh(geometry, material);
  mesh.name = 'body';
  rig.root.add(mesh);
  holder.updateMatrixWorld(true);
  const bones = [...rig.bones, top];
  const skeleton = new Skeleton(bones, [...rig.skeleton.boneInverses, new Matrix4()]);
  mesh.bind(skeleton, mesh.matrixWorld);
  skeleton.calculateInverses();
  const hair = paletteOf(style, 0, 0)[ZONES.indexOf('hair')]!;
  bakeFace(rig.bone('head'), dims.headRadius, hair);
  const rest = bones.map((bone) => ({
    position: bone.position.clone(),
    quaternion: bone.quaternion.clone(),
    scale: bone.scale.clone(),
  }));

  // Échantillonnage des clips, une image par frame simulée.
  const input = createPoseInput();
  const pose = createPose();
  const yaw = new Matrix4();
  const spin = new Matrix4();
  const pos = new Vector3();
  const quat = new Quaternion();
  const scl = new Vector3();
  const clips: AnimationClip[] = [];
  for (const spec of specs(def)) {
    input.action = spec.action;
    input.move = spec.move ?? 0;
    input.grounded = spec.grounded ?? true;
    input.velY = spec.velY ?? 0;
    input.forward = spec.forward ?? 0;
    input.charge = 0;
    input.stride = 0;
    actionTiming(def, spec.action, input.move, input);
    const span = spec.loop ?? spec.frames ?? input.total;
    if (!(span > 0) && spec.stride === undefined) {
      console.warn(`  ${spec.name} : aucune durée, ignoré.`);
      continue;
    }
    const keys = spec.stride !== undefined ? 48 : Math.max(2, Math.ceil(span));
    const length = spec.stride !== undefined ? keys : span;
    const times = new Float32Array(keys + 1);
    const values = bones.map(() => ({
      p: new Float32Array((keys + 1) * 3),
      q: new Float32Array((keys + 1) * 4),
    }));
    for (let k = 0; k <= keys; k++) {
      const f = (k / keys) * length;
      times[k] = f / FPS;
      input.frame = spec.chargeFrame ?? f;
      if (spec.chargeFrame !== undefined) input.charge = 1 + f;
      if (spec.stride !== undefined) input.stride = 1e-6 + (k / keys) * spec.stride;
      computePose(input, pose);
      rig.apply(pose, 0);
      const curl = handCurl(spec.action);
      rig.setHands(curl, curl);
      // Même repère que la figurine en combat (figurine.ts) : décalage et rotation, puis vrille.
      const s = Math.sin(pose.spin);
      const cs = Math.cos(pose.spin);
      yaw.makeRotationY(pose.yaw).setPosition(pose.offsetX, pose.offsetY, pose.offsetZ);
      spin.makeRotationZ(-pose.spin).setPosition(-SPIN_PIVOT_Y * s, SPIN_PIVOT_Y * (1 - cs), 0);
      yaw.multiply(spin).decompose(pos, quat, scl);
      top.position.copy(pos);
      top.quaternion.copy(quat);
      bones.forEach((bone, b) => {
        bone.position.toArray(values[b]!.p, k * 3);
        bone.quaternion.toArray(values[b]!.q, k * 4);
      });
    }
    const tracks = bones.flatMap((bone, b) => [
      new VectorKeyframeTrack(`${bone.name}.position`, times, values[b]!.p).optimize(),
      new QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values[b]!.q).optimize(),
    ]);
    clips.push(new AnimationClip(spec.name, times[keys]!, tracks));
  }

  // Remise en pose de référence avant l'export : le maillage est lié dans cette pose.
  bones.forEach((bone, b) => {
    bone.position.copy(rest[b]!.position);
    bone.quaternion.copy(rest[b]!.quaternion);
    bone.scale.copy(rest[b]!.scale);
  });

  const scene = new Scene();
  scene.add(holder);
  scene.userData = {
    height: 1 / dims.normalize,
    walkCycle: WALK_CYCLE_LENGTH,
    runCycle: RUN_CYCLE_LENGTH,
    source: `Figurine procédurale de ${c.name}, exportée par tools/bake-figurine.ts`,
  };
  const bytes = await writeGlb(scene, clips, out);
  console.log(
    `${c.name} : ${clips.length} clips, ${geometry.getAttribute('position').count} sommets, ` +
      `${(bytes / 1024).toFixed(0)} Ko → ${out}`,
  );
}

await main();
