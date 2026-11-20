/**
 * Exporte le modèle animé d'un personnage (`.glb`) à partir de ses animations écrites à la main
 * (`tools/characters/<id>.ts`) : corps sculpté à haute résolution, une matière par zone (couleurs
 * alternatives incluses), clés d'animation calées sur la frame data, bandeau et tunique animés
 * par une simulation de ressorts au moment de l'export.
 *
 * Usage, depuis la racine du dépôt : `node packages/render/tools/bake-character.ts <id> [sortie]`
 * (sortie par défaut : `assets/fighters/<id>/model.glb`).
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { fxToFloat, type FighterDef } from '@game/sim-core';
import {
  AnimationClip,
  Bone,
  Group,
  Matrix4,
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
import { createChain, stepChain, type Chain } from '../src/fighters/dynamics.ts';
import { figurineBody } from '../src/fighters/figurine.ts';
import { SHIN, SPIN_PIVOT_Y, THIGH, actionTiming, createPoseInput } from '../src/fighters/poses.ts';
import type { Rig } from '../src/fighters/skeleton.ts';
import { ZONES, type Sculpt } from '../src/fighters/sdf.ts';
import { REST, compile, sample, type Channels, type ClipDef, type Timing } from './anim/keys.ts';
import { bakeFace, splitByZone, variantsOf, writeGlb } from './gltf-bake.ts';

const FPS = 60;

/** Ce qu'un fichier `tools/characters/<id>.ts` exporte. */
export interface CharacterAnimation {
  /** Garde du personnage : la pose dont héritent les clés. */
  readonly guard: Partial<Channels>;
  /** Volumes ajoutés au sculpt du personnage, pour le modèle seulement (mèches, détails). */
  readonly sculpt?: Sculpt;
  /** Finesse du maillage (1 : celle des figurines en jeu). */
  readonly detail?: number;
  /** Distance d'un cycle de marche et de course, en hauteurs de personnage. */
  readonly walkCycle: number;
  readonly runCycle: number;
  /** Clips, par nom du contrat (`assets/fighters/README.md`). */
  readonly clips: readonly (ClipDef & {
    readonly air?: boolean;
    readonly action: number;
    readonly move?: number;
  })[];
}

const reach = (leg: number, shin: number): number =>
  THIGH * Math.cos(leg) + SHIN * Math.cos(leg + shin);

/** Part du balancement de la tunique, plus lourde que le bandeau (comme la figurine). */
const SKIRT_SWAY = 0.6;

/** Oriente le squelette selon `c`. `top` : os racine (décalages, rotations du corps entier). */
function pose(rig: Rig, top: Bone, c: Channels, grounded: boolean): void {
  const hipY = grounded ? Math.max(reach(c.legF, c.shinF), reach(c.legB, c.shinB)) : c.hipY;
  // Le squelette tourne la tête vers -z pour un angle positif : la caméra est du côté +z.
  rig.apply({ ...c, hipY }, -c.turn);
  rig.setHands(c.handF, c.handB);
  rig.bone('hips').rotation.set(0, c.hipTwist, 0);
  const spine = rig.bone('spine');
  spine.rotation.x = c.lean;
  spine.rotation.y = c.twist;
  rig.bone('neck').rotation.x = c.tilt;
  rig.bone('handF').rotation.z = c.wristF;
  rig.bone('handB').rotation.z = c.wristB;
  rig.bone('upperArmF').rotation.x = -c.spreadF;
  rig.bone('upperArmB').rotation.x = c.spreadB;
  const s = Math.sin(c.spin);
  const cs = Math.cos(c.spin);
  const m = new Matrix4()
    .makeRotationY(c.yaw)
    .setPosition(c.offsetX, c.offsetY, c.offsetZ)
    .multiply(
      new Matrix4()
        .makeRotationZ(-c.spin)
        .setPosition(-SPIN_PIVOT_Y * s, SPIN_PIVOT_Y * (1 - cs), 0),
    );
  m.decompose(top.position, top.quaternion, new Vector3());
}

interface Springs {
  hair: Chain;
  cloth: Chain;
  skirt: Chain;
}

/** Fait avancer les ressorts d'une frame et oriente les os qu'ils portent. */
function stepSprings(rig: Rig, sp: Springs, c: Channels, vx: number, vy: number): void {
  stepChain(sp.hair, 1, c.spin + c.torso + c.head, vx, vy);
  stepChain(sp.cloth, 1, c.spin + c.torso, vx, vy);
  stepChain(sp.skirt, 1, c.spin, vx, vy);
  rig.bone('tail1').rotation.z = sp.hair.angle[0]!;
  rig.bone('tail2').rotation.z = sp.hair.angle[1]!;
  rig.bone('cloth1').rotation.z = sp.cloth.angle[0]!;
  rig.bone('cloth2').rotation.z = sp.cloth.angle[1]!;
  rig.bone('skirt').rotation.z = sp.skirt.angle[0]! * SKIRT_SWAY;
}

function timingOf(def: FighterDef, clip: CharacterAnimation['clips'][number]): Timing {
  const input = createPoseInput();
  actionTiming(def, clip.action, clip.move ?? 0, input);
  const charge = clip.move === undefined ? 0 : (def.moves[clip.move]?.charge?.frame ?? 0);
  return { start: input.start, end: input.end, total: input.total, charge };
}

async function main(): Promise<void> {
  const id = process.argv[2];
  if (id === undefined || !isFighterId(id)) {
    console.error('Usage : node packages/render/tools/bake-character.ts <id> [sortie.glb]');
    process.exit(1);
  }
  const source = new URL(`./characters/${id}.ts`, import.meta.url);
  if (!existsSync(source)) {
    console.error(`Pas d'animations écrites pour « ${id} » (${source.pathname}).`);
    process.exit(1);
  }
  const anim = (await import(pathToFileURL(source.pathname.replace(/^\/(\w:)/, '$1')).href))
    .default as CharacterAnimation;
  const out = resolve(process.argv[3] ?? `assets/fighters/${id}/model.glb`);
  const c = character(id);
  const def = c.def;
  const look = c.look;
  const style = { ...look, sculpt: [...(look.sculpt ?? []), ...(anim.sculpt ?? [])] };
  const { rig, geometry, dims } = figurineBody(style, anim.detail ?? 1);
  const palette = paletteOf(look, 0, 0);
  const materials = splitByZone(geometry, palette, look.materials);

  const top = new Bone();
  top.name = 'root';
  const hips = rig.bone('hips');
  rig.root.remove(hips);
  top.add(hips);
  rig.root.add(top);
  rig.root.rotation.y = -Math.PI / 2;
  const holder = new Group();
  holder.name = c.name;
  holder.add(rig.root);
  holder.updateMatrixWorld(true);
  const mesh = new SkinnedMesh(geometry, materials);
  mesh.name = 'body';
  rig.root.add(mesh);
  holder.updateMatrixWorld(true);
  const bones = [...rig.bones, top];
  const skeleton = new Skeleton(bones, [...rig.skeleton.boneInverses, new Matrix4()]);
  mesh.bind(skeleton, mesh.matrixWorld);
  skeleton.calculateInverses();
  bakeFace(rig.bone('head'), dims.headRadius, palette[ZONES.indexOf('hair')]!);
  const rest = bones.map((b) => ({ p: b.position.clone(), q: b.quaternion.clone() }));

  const guard: Channels = { ...REST, ...anim.guard };
  const height = fxToFloat(def.height);
  const clips: AnimationClip[] = [];
  const cur = { ...REST };
  const prev = { ...REST };
  for (const clip of anim.clips) {
    const timing = timingOf(def, clip);
    const track = compile(clip, guard, timing);
    const grounded = clip.air !== true;
    const keys = Math.max(2, Math.ceil(track.length));
    const times = new Float32Array(keys + 1);
    const values = bones.map(() => ({
      p: new Float32Array((keys + 1) * 3),
      q: new Float32Array((keys + 1) * 4),
    }));
    const springs: Springs = { hair: createChain(), cloth: createChain(), skirt: createChain() };
    const [vx0, vy0] = clip.vel ?? [0, 0];
    // Mise en route des ressorts : une période pour une boucle, la pose de départ sinon.
    const warm = clip.loop !== undefined ? keys : 20;
    for (let k = -warm; k <= keys; k++) {
      const f =
        clip.loop !== undefined
          ? (((k % keys) + keys) % keys) * (track.length / keys)
          : Math.max(0, k) * (track.length / keys);
      sample(track, f, cur);
      if (k === -warm) Object.assign(prev, cur);
      pose(rig, top, cur, grounded);
      // Vitesse du corps : celle du clip, plus le déplacement des décalages (hauteurs → unités).
      const vx = vx0 + (cur.offsetX - prev.offsetX) * height;
      const vy = vy0 + (cur.offsetY - prev.offsetY) * height;
      stepSprings(rig, springs, cur, vx, vy);
      Object.assign(prev, cur);
      if (k < 0) continue;
      times[k] = (k * (track.length / keys)) / FPS;
      bones.forEach((bone, b) => {
        bone.position.toArray(values[b]!.p, k * 3);
        bone.quaternion.toArray(values[b]!.q, k * 4);
      });
    }
    const tracks = bones.flatMap((bone, b) => [
      new VectorKeyframeTrack(`${bone.name}.position`, times, values[b]!.p).optimize(),
      new QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values[b]!.q).optimize(),
    ]);
    clips.push(new AnimationClip(clip.name, times[keys]!, tracks));
  }

  bones.forEach((bone, b) => {
    bone.position.copy(rest[b]!.p);
    bone.quaternion.copy(rest[b]!.q as Quaternion);
    bone.scale.set(1, 1, 1);
  });
  const scene = new Scene();
  scene.add(holder);
  scene.userData = {
    height: 1 / dims.normalize,
    walkCycle: anim.walkCycle,
    runCycle: anim.runCycle,
    variants: variantsOf(look.palettes),
    source: `${c.name}, animations écrites à la main (tools/characters/${id}.ts)`,
  };
  const bytes = await writeGlb(scene, clips, out);
  console.log(
    `${c.name} : ${clips.length} clips, ${geometry.getAttribute('position').count} sommets, ` +
      `${materials.length} matières, ${(bytes / 1024).toFixed(0)} Ko → ${out}`,
  );
}

await main();
