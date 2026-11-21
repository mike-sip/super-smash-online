/**
 * Volumes d'une figurine (SPEC-visuals.md, phase 3) : capsules, ellipsoïdes et boîtes arrondies,
 * chacun porté par un os et peint dans une zone de couleur, fusionnés en douceur. Logique pure,
 * sans Three.js : la description se transforme en champ de distance signée, que `mesher.ts`
 * convertit en maillage.
 *
 * Unités : hauteurs de combattant (1 = des pieds à la tête). Les volumes sont décrits dans le
 * repère de leur os, en pose de référence : x vers l'avant, y vers le haut (un membre pend vers
 * -y), z vers la caméra quand le combattant regarde à droite.
 */

export const BONES = [
  'hips',
  'spine',
  'neck',
  'head',
  'upperArmF',
  'forearmF',
  'handF',
  'upperArmB',
  'forearmB',
  'handB',
  'thighF',
  'shinF',
  'footF',
  'thighB',
  'shinB',
  'footB',
  // Os secondaires, animés par des ressorts (dynamics.ts) : cheveux, pans de tissu, jupe.
  'tail1',
  'tail2',
  'cloth1',
  'cloth2',
  'skirt',
  // Doigts et pouces (SPEC-finition.md, phase 2) : poing, main ouverte, prise d'un objet.
  'fingersF',
  'thumbF',
  'fingersB',
  'thumbB',
] as const;
export type BoneName = (typeof BONES)[number];

/** Zones de couleur, indices dans la palette d'un combattant. */
export const ZONES = [
  'primary',
  'secondary',
  'skin',
  'hair',
  'accent',
  'dark',
  'light',
  'player',
] as const;
export type ZoneName = (typeof ZONES)[number];

type Vec3 = readonly [number, number, number];

/** Un volume, tel qu'un personnage le décrit (données pures). */
export interface SculptPart {
  readonly bone: BoneName;
  /**
   * Repère dans lequel la pièce est décrite, s'il diffère de l'os qui l'anime : une mèche décrite
   * dans le repère de la tête mais portée par l'os secondaire des cheveux.
   */
  readonly frame?: BoneName;
  readonly shape: 'capsule' | 'ellipsoid' | 'box';
  readonly zone: ZoneName;
  /** Capsule : extrémités et rayons (cône arrondi si `radiusTo` diffère). */
  readonly from?: Vec3;
  readonly to?: Vec3;
  readonly radius?: number;
  readonly radiusTo?: number;
  /** Ellipsoïde et boîte : centre, demi-dimensions, rotation autour de z (radians). */
  readonly center?: Vec3;
  readonly size?: Vec3;
  readonly rotation?: number;
  /** Boîte : rayon d'arrondi des arêtes. */
  readonly round?: number;
  /** Rayon de fusion avec ce qui précède (0 = union nette). */
  readonly blend?: number;
  /**
   * Copie symétrique : sur un membre « F », la même pièce sur le membre « B » ; sur un os du
   * tronc, de l'autre côté du corps (z opposé).
   */
  readonly mirror?: boolean;
}

export type Sculpt = readonly SculptPart[];

export const SHAPE_CAPSULE = 0;
export const SHAPE_ELLIPSOID = 1;
export const SHAPE_BOX = 2;

/** Volume prêt à évaluer, dans le repère du corps en pose de référence. */
export interface Primitive {
  readonly shape: number;
  readonly bone: number;
  readonly zone: number;
  readonly blend: number;
  /**
   * Capsule : a (0-2), b (3-5), r1 (6), r2 (7).
   * Ellipsoïde et boîte : centre (0-2), demi-dimensions (3-5), arrondi (6), puis la matrice 3×3
   * qui ramène un point dans le repère du volume (9-17, par lignes).
   */
  readonly p: Float64Array;
}

/** Matrice 4×4 en colonnes (comme Three.js) : repère de référence de chaque os. */
export type BindMatrices = readonly ArrayLike<number>[];

function mirrorBone(bone: BoneName): BoneName {
  if (bone.endsWith('F')) return `${bone.slice(0, -1)}B` as BoneName;
  if (bone.endsWith('B')) return `${bone.slice(0, -1)}F` as BoneName;
  return bone;
}

/** Repère d'une copie symétrique : celui de la pièce, passé du côté de son os. */
function mirrorFrame(part: SculptPart, bone: BoneName): BoneName {
  const frame = part.frame!;
  return bone === part.bone ? frame : mirrorBone(frame);
}

function transformPoint(m: ArrayLike<number>, v: Vec3): [number, number, number] {
  return [
    m[0]! * v[0] + m[4]! * v[1] + m[8]! * v[2] + m[12]!,
    m[1]! * v[0] + m[5]! * v[1] + m[9]! * v[2] + m[13]!,
    m[2]! * v[0] + m[6]! * v[1] + m[10]! * v[2] + m[14]!,
  ];
}

/** Échelle (uniforme) d'une matrice : les os n'en ont pas, mais le corps peut en avoir. */
function scaleOf(m: ArrayLike<number>): number {
  return Math.hypot(m[0]!, m[1]!, m[2]!);
}

/** Développe les copies symétriques et place chaque volume dans le repère du corps. */
export function compileSculpt(sculpt: Sculpt, bind: BindMatrices): Primitive[] {
  const out: Primitive[] = [];
  const add = (part: SculptPart, bone: BoneName, flipZ: boolean): void => {
    const b = BONES.indexOf(bone);
    const frame = part.frame === undefined ? bone : mirrorFrame(part, bone);
    const m = bind[BONES.indexOf(frame)]!;
    const s = scaleOf(m);
    const flip = (v: Vec3 | undefined): Vec3 => {
      const w = v ?? [0, 0, 0];
      return flipZ ? [w[0], w[1], -w[2]] : w;
    };
    const p = new Float64Array(18);
    const zone = ZONES.indexOf(part.zone);
    if (part.shape === 'capsule') {
      const a = transformPoint(m, flip(part.from));
      const c = transformPoint(m, flip(part.to ?? part.from));
      const r = part.radius ?? 0.02;
      p.set([...a, ...c, r * s, (part.radiusTo ?? r) * s]);
      out.push({ shape: SHAPE_CAPSULE, bone: b, zone, blend: part.blend ?? 0, p });
      return;
    }
    const center = transformPoint(m, flip(part.center));
    const size = part.size ?? [0.05, 0.05, 0.05];
    p.set([...center, size[0] * s, size[1] * s, size[2] * s, (part.round ?? 0) * s]);
    // Repère du volume : rotation propre autour de z, puis celle de l'os ; la matrice stockée
    // est l'inverse (transposée) de la rotation totale.
    const angle = part.rotation ?? 0;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Axes locaux du volume exprimés dans le repère de l'os.
    const ax: Vec3 = [cos, sin, 0];
    const ay: Vec3 = [-sin, cos, 0];
    const az: Vec3 = [0, 0, flipZ ? -1 : 1];
    const rot = (v: Vec3): Vec3 => {
      const x = m[0]! * v[0] + m[4]! * v[1] + m[8]! * v[2];
      const y = m[1]! * v[0] + m[5]! * v[1] + m[9]! * v[2];
      const z = m[2]! * v[0] + m[6]! * v[1] + m[10]! * v[2];
      const n = Math.hypot(x, y, z) || 1;
      return [x / n, y / n, z / n];
    };
    const X = rot(ax);
    const Y = rot(ay);
    const Z = rot(az);
    p.set([...X, ...Y, ...Z], 9);
    out.push({
      shape: part.shape === 'box' ? SHAPE_BOX : SHAPE_ELLIPSOID,
      bone: b,
      zone,
      blend: part.blend ?? 0,
      p,
    });
  };
  for (const part of sculpt) {
    add(part, part.bone, false);
    if (part.mirror === true) {
      const other = mirrorBone(part.bone);
      add(part, other, other === part.bone);
    }
  }
  return out;
}

/** Distance signée du point (x, y, z) au volume (négative à l'intérieur). */
export function primitiveDistance(q: Primitive, x: number, y: number, z: number): number {
  const p = q.p;
  if (q.shape === SHAPE_CAPSULE) {
    // Cône arrondi entre a (rayon r1) et b (rayon r2) : approximation par interpolation du
    // rayon le long du segment, précise pour des rayons proches.
    const ax = p[0]!;
    const ay = p[1]!;
    const az = p[2]!;
    const bx = p[3]! - ax;
    const by = p[4]! - ay;
    const bz = p[5]! - az;
    const px = x - ax;
    const py = y - ay;
    const pz = z - az;
    const len2 = bx * bx + by * by + bz * bz;
    let t = len2 > 0 ? (px * bx + py * by + pz * bz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - bx * t;
    const dy = py - by * t;
    const dz = pz - bz * t;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - (p[6]! + (p[7]! - p[6]!) * t);
  }
  // Point dans le repère du volume.
  const cx = x - p[0]!;
  const cy = y - p[1]!;
  const cz = z - p[2]!;
  const lx = p[9]! * cx + p[10]! * cy + p[11]! * cz;
  const ly = p[12]! * cx + p[13]! * cy + p[14]! * cz;
  const lz = p[15]! * cx + p[16]! * cy + p[17]! * cz;
  if (q.shape === SHAPE_ELLIPSOID) {
    // Approximation classique (bornée et lisse) de la distance à un ellipsoïde.
    const rx = p[3]!;
    const ry = p[4]!;
    const rz = p[5]!;
    const k0 = Math.sqrt((lx / rx) ** 2 + (ly / ry) ** 2 + (lz / rz) ** 2);
    const k1 = Math.sqrt((lx / (rx * rx)) ** 2 + (ly / (ry * ry)) ** 2 + (lz / (rz * rz)) ** 2);
    return k1 > 0 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
  }
  const r = p[6]!;
  const qx = Math.abs(lx) - p[3]! + r;
  const qy = Math.abs(ly) - p[4]! + r;
  const qz = Math.abs(lz) - p[5]! + r;
  const ox = qx > 0 ? qx : 0;
  const oy = qy > 0 ? qy : 0;
  const oz = qz > 0 ? qz : 0;
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

/** Union douce (polynomiale) de deux distances, de rayon `k`. */
export function smoothMin(a: number, b: number, k: number): number {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Distance signée du point à l'ensemble des volumes. */
export function sculptDistance(
  prims: readonly Primitive[],
  x: number,
  y: number,
  z: number,
): number {
  let d = Infinity;
  for (let i = 0; i < prims.length; i++) {
    const q = prims[i]!;
    const di = primitiveDistance(q, x, y, z);
    d = d === Infinity ? di : smoothMin(d, di, q.blend);
  }
  return d;
}

/** Boîte englobante des volumes, avec une marge. */
export function sculptBounds(
  prims: readonly Primitive[],
  margin: number,
): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const grow = (x: number, y: number, z: number, r: number): void => {
    min[0] = Math.min(min[0], x - r);
    min[1] = Math.min(min[1], y - r);
    min[2] = Math.min(min[2], z - r);
    max[0] = Math.max(max[0], x + r);
    max[1] = Math.max(max[1], y + r);
    max[2] = Math.max(max[2], z + r);
  };
  for (const q of prims) {
    const p = q.p;
    if (q.shape === SHAPE_CAPSULE) {
      grow(p[0]!, p[1]!, p[2]!, p[6]!);
      grow(p[3]!, p[4]!, p[5]!, p[7]!);
    } else {
      grow(p[0]!, p[1]!, p[2]!, Math.hypot(p[3]!, p[4]!, p[5]!));
    }
  }
  for (let a = 0; a < 3; a++) {
    min[a] -= margin;
    max[a] += margin;
  }
  return { min, max };
}
