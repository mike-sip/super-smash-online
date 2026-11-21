/**
 * Briques communes aux outils d'export glTF (`bake-figurine.ts`, `bake-character.ts`) : visage
 * figé, découpe du corps en matières par zone, écriture du `.glb` hors navigateur.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  AnimationClip,
  BufferAttribute,
  Color,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Bone,
  type BufferGeometry,
  type InstancedMesh,
  type Material,
  type Object3D,
} from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createFaceMeshes, irisColor } from '../src/fighters/face-meshes.ts';
import { createExpression, createFace, faceLayout } from '../src/fighters/face.ts';
import { zoneMaterials, type MaterialKind } from '../src/fighters/materials.ts';
import { ZONES, type ZoneName } from '../src/fighters/sdf.ts';

/** `FileReader` minimal pour `GLTFExporter` hors navigateur. */
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      const type = blob.type === '' ? 'application/octet-stream' : blob.type;
      this.result = `data:${type};base64,${Buffer.from(buffer).toString('base64')}`;
      this.onloadend?.();
    });
  }
}

/** Tolérance sous laquelle une piste est considérée immobile (unités du modèle, radians). */
const STILL = 1e-5;

/**
 * Retire des clips les pistes qui ne quittent jamais la valeur de repos de leur os, dans aucun
 * clip : l'os n'est alors jamais animé et garde sa pose du fichier. Sans effet visible, mais
 * chaque piste coûte une entrée JSON et deux tampons.
 */
export function dropStillTracks(scene: Object3D, clips: readonly AnimationClip[]): AnimationClip[] {
  const rest = new Map<string, ArrayLike<number>>();
  scene.traverse((o) => {
    rest.set(`${o.name}.position`, o.position.toArray());
    rest.set(`${o.name}.quaternion`, o.quaternion.toArray());
    rest.set(`${o.name}.scale`, o.scale.toArray());
  });
  const moving = new Set<string>();
  for (const clip of clips) {
    for (const track of clip.tracks) {
      const base = rest.get(track.name);
      if (base === undefined) {
        moving.add(track.name);
        continue;
      }
      const n = base.length;
      const values = track.values;
      const quat = track.name.endsWith('.quaternion');
      for (let i = 0; i < values.length; i += n) {
        let d = 0;
        // Un quaternion et son opposé décrivent la même rotation.
        let dn = 0;
        for (let c = 0; c < n; c++) {
          d = Math.max(d, Math.abs(values[i + c]! - base[c]!));
          dn = Math.max(dn, Math.abs(values[i + c]! + base[c]!));
        }
        if ((quat ? Math.min(d, dn) : d) > STILL) {
          moving.add(track.name);
          break;
        }
      }
    }
  }
  return clips.map(
    (clip) =>
      new AnimationClip(
        clip.name,
        clip.duration,
        clip.tracks.filter((t) => moving.has(t.name)),
      ),
  );
}

/**
 * Attributs compacts, lus tels quels par le chargeur glTF : indices sur 16 bits quand il y a
 * moins de 65 536 sommets, indices d'os sur 8 bits, poids normalisés sur 8 bits (somme 255).
 */
export function compactGeometry(geometry: BufferGeometry): void {
  const index = geometry.getIndex();
  const count = geometry.getAttribute('position').count;
  if (index !== null && count < 65536 && !(index.array instanceof Uint16Array)) {
    geometry.setIndex(new BufferAttribute(Uint16Array.from(index.array as ArrayLike<number>), 1));
  }
  const joints = geometry.getAttribute('skinIndex');
  if (joints !== undefined) {
    const src = joints.array as ArrayLike<number>;
    let max = 0;
    for (let i = 0; i < src.length; i++) max = Math.max(max, src[i]!);
    if (max < 256) geometry.setAttribute('skinIndex', new BufferAttribute(Uint8Array.from(src), 4));
  }
  const weights = geometry.getAttribute('skinWeight');
  if (weights !== undefined && !(weights.array instanceof Uint8Array)) {
    const src = weights.array as ArrayLike<number>;
    const out = new Uint8Array(src.length);
    for (let v = 0; v < src.length; v += 4) {
      const sum = src[v]! + src[v + 1]! + src[v + 2]! + src[v + 3]! || 1;
      let total = 0;
      let big = 0;
      for (let c = 0; c < 4; c++) {
        out[v + c] = Math.round((src[v + c]! / sum) * 255);
        total += out[v + c]!;
        if (out[v + c]! > out[v + big]!) big = c;
      }
      // Le reste de l'arrondi va au poids le plus fort : la somme fait toujours 255.
      out[v + big] = out[v + big]! + 255 - total;
    }
    geometry.setAttribute('skinWeight', new BufferAttribute(out, 4, true));
  }
}

/** Écrit `scene` et ses clips dans un `.glb` compact. Renvoie la taille en octets. */
export async function writeGlb(
  scene: Object3D,
  clips: readonly AnimationClip[],
  path: string,
): Promise<number> {
  (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
  const geometries = new Set<BufferGeometry>();
  scene.traverse((o) => {
    if (o instanceof Mesh) geometries.add(o.geometry as BufferGeometry);
  });
  for (const g of geometries) compactGeometry(g);
  const glb = (await new GLTFExporter().parseAsync(scene, {
    binary: true,
    animations: dropStillTracks(scene, clips),
    onlyVisible: false,
  })) as ArrayBuffer;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(glb));
  return glb.byteLength;
}

/** Remplace les pièces du visage (instanciées en jeu) par des maillages fixes, enfants de la tête. */
export function bakeFace(head: Bone, headRadius: number, hair: number): void {
  const face = createFaceMeshes(1, head);
  face.setColors(0, irisColor(hair), hair);
  face.place(0, new Matrix4(), headRadius, faceLayout(createExpression(), 0, 0, createFace()));
  const m = new Matrix4();
  const c = new Color();
  for (const im of face.meshes as readonly InstancedMesh[]) {
    head.remove(im);
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m);
      if (Math.abs(m.determinant()) < 1e-12) continue;
      const material = (im.material as Material).clone() as MeshStandardMaterial;
      if (im.instanceColor !== null) {
        im.getColorAt(i, c);
        material.color.multiply(c);
      }
      material.name = `face-${i}`;
      const part = new Mesh(im.geometry, material);
      m.decompose(part.position, part.quaternion, part.scale);
      part.name = material.name;
      head.add(part);
    }
  }
}

/**
 * Découpe le corps en une matière par zone (nommée comme la zone : `primary`, `skin`…), pour que
 * les couleurs alternatives se donnent par nom de matière.
 *
 * Un triangle à cheval sur deux zones est coupé le long de leur frontière (là où les deux zones
 * pèsent autant) : la limite entre deux matières suit la courbe douce du sculpt au lieu de
 * dessiner des dents de scie. Les sommets créés sur une arête sont partagés par les deux
 * triangles voisins (pas de fente). Les attributs de zone sont retirés.
 */
export function splitByZone(
  geometry: BufferGeometry,
  palette: readonly number[],
  kinds: Partial<Record<ZoneName, MaterialKind>> | undefined,
): MeshStandardMaterial[] {
  const zone = geometry.getAttribute('aZone');
  const zone2 = geometry.getAttribute('aZone2');
  const mix = geometry.getAttribute('aZoneMix');
  const index = geometry.getIndex()!;
  const pos = Array.from(geometry.getAttribute('position').array as ArrayLike<number>);
  const nrm = Array.from(geometry.getAttribute('normal').array as ArrayLike<number>);
  const si = Array.from(geometry.getAttribute('skinIndex').array as ArrayLike<number>);
  const sw = Array.from(geometry.getAttribute('skinWeight').array as ArrayLike<number>);
  const count = zone.count;
  const dom = (v: number): number => Math.round(mix.getX(v) < 0.5 ? zone.getX(v) : zone2.getX(v));
  /** Poids de la zone `z` au sommet `v` (sommets d'origine seulement). */
  const weight = (v: number, z: number): number =>
    (Math.round(zone.getX(v)) === z ? 1 - mix.getX(v) : 0) +
    (Math.round(zone2.getX(v)) === z ? mix.getX(v) : 0);
  const zoneOf: number[] = Array.from({ length: count }, (_, v) => dom(v));

  // Sommet au point d'égalité des zones sur l'arête (a, b), créé une fois par arête.
  const cuts = new Map<string, number>();
  const cut = (a: number, b: number): number => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const known = cuts.get(key);
    if (known !== undefined) return known;
    const za = zoneOf[a]!;
    const zb = zoneOf[b]!;
    const fa = weight(a, za) - weight(a, zb);
    const fb = weight(b, za) - weight(b, zb);
    const t = Math.min(0.95, Math.max(0.05, fa - fb === 0 ? 0.5 : fa / (fa - fb)));
    const v = pos.length / 3;
    for (let k = 0; k < 3; k++) pos.push(pos[a * 3 + k]! + (pos[b * 3 + k]! - pos[a * 3 + k]!) * t);
    const n = [0, 1, 2].map((k) => nrm[a * 3 + k]! + (nrm[b * 3 + k]! - nrm[a * 3 + k]!) * t);
    const len = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    nrm.push(n[0]! / len, n[1]! / len, n[2]! / len);
    // Peau : mêmes os aux deux bouts, poids mélangés ; sinon ceux du bout le plus proche.
    const same = [0, 1, 2, 3].every((k) => si[a * 4 + k] === si[b * 4 + k]);
    const near = t < 0.5 ? a : b;
    for (let k = 0; k < 4; k++) {
      si.push(si[(same ? a : near) * 4 + k]!);
      sw.push(same ? sw[a * 4 + k]! + (sw[b * 4 + k]! - sw[a * 4 + k]!) * t : sw[near * 4 + k]!);
    }
    zoneOf.push(-1);
    cuts.set(key, v);
    return v;
  };

  const buckets: number[][] = ZONES.map(() => []);
  for (let t = 0; t < index.count; t += 3) {
    const tri = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    const z = tri.map((v) => zoneOf[v]!);
    if (z[0] === z[1] && z[1] === z[2]) {
      buckets[z[0]!]!.push(...tri);
      continue;
    }
    // Sommet isolé : celui dont la zone diffère des deux autres (trois zones : le premier).
    let lone = 0;
    if (z[1] !== z[0] && z[1] !== z[2]) lone = 1;
    else if (z[2] !== z[0] && z[2] !== z[1]) lone = 2;
    if (z[0] !== z[1] && z[1] !== z[2] && z[0] !== z[2]) {
      buckets[z[0]!]!.push(...tri);
      continue;
    }
    const l = tri[lone]!;
    const o1 = tri[(lone + 1) % 3]!;
    const o2 = tri[(lone + 2) % 3]!;
    const p1 = cut(l, o1);
    const p2 = cut(l, o2);
    buckets[zoneOf[l]!]!.push(l, p1, p2);
    buckets[zoneOf[o1]!]!.push(p1, o1, o2, p1, o2, p2);
  }
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  geometry.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(si), 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(new Float32Array(sw), 4));
  const total = buckets.reduce((n, b) => n + b.length, 0);
  const sorted = new Uint32Array(total);
  geometry.clearGroups();
  const params = zoneMaterials(kinds).params;
  const materials: MeshStandardMaterial[] = [];
  let offset = 0;
  buckets.forEach((tris, z) => {
    if (tris.length === 0) return;
    sorted.set(tris, offset);
    geometry.addGroup(offset, tris.length, materials.length);
    offset += tris.length;
    const [roughness, metalness] = params[z] ?? [0.6, 0];
    const material = new MeshStandardMaterial({
      color: palette[z]!,
      roughness,
      metalness,
    });
    material.name = ZONES[z]!;
    materials.push(material);
  });
  geometry.setIndex(new BufferAttribute(sorted, 1));
  geometry.computeBoundingSphere();
  geometry.deleteAttribute('aZone');
  geometry.deleteAttribute('aZone2');
  geometry.deleteAttribute('aZoneMix');
  return materials;
}

/** Couleurs alternatives au format des modèles (`variants`), depuis les palettes d'un personnage. */
export function variantsOf(
  palettes: readonly Partial<Record<string, number>>[] | undefined,
): Record<string, string>[] {
  const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
  return (palettes ?? []).slice(1).map((p) => {
    const out: Record<string, string> = {};
    for (const [zone, color] of Object.entries(p)) if (color !== undefined) out[zone] = hex(color);
    return out;
  });
}
