/**
 * Champ de distance → maillage lisse (« surface nets »), avec normales, zone de couleur et poids
 * de peau par sommet (SPEC-visuals.md, phase 3). Logique pure, sans Three.js : le résultat est un
 * ensemble de tableaux prêts pour une `BufferGeometry`.
 *
 * Principe : le champ est échantillonné sur une grille ; chaque cellule que la surface traverse
 * reçoit un sommet (moyenne des points où la surface coupe ses arêtes, puis rapproché de la
 * surface) ; chaque arête de la grille qui traverse la surface relie les quatre cellules qui
 * l'entourent par un quadrilatère.
 */
import { BONES, primitiveDistance, sculptBounds, sculptDistance, type Primitive } from './sdf.ts';

export interface MeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  /** Zone de couleur de chaque sommet (indice dans la palette). */
  readonly zones: Float32Array;
  /**
   * Zone voisine et part de son mélange (0 à 0,5) : près d'une frontière entre deux zones, la
   * couleur passe de l'une à l'autre en douceur au lieu de suivre les arêtes en dents de scie.
   */
  readonly zones2: Float32Array;
  readonly zoneMix: Float32Array;
  /** Quatre os et quatre poids par sommet, poids normalisés. */
  readonly skinIndex: Uint16Array;
  readonly skinWeight: Float32Array;
  readonly index: Uint32Array;
}

/** Distance (en hauteurs de combattant) sur laquelle l'influence d'un os s'estompe. */
const SKIN_FALLOFF = 0.035;
/** Largeur de la transition entre deux zones de couleur, en hauteurs de combattant. */
const ZONE_EDGE = 0.014;

/** Corners of a cell, as (dx, dy, dz) offsets, and its 12 edges as pairs of corners. */
const CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
] as const;
const EDGES = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
] as const;

/** Maille les volumes avec des cellules de côté `cell`. */
export function meshSculpt(prims: readonly Primitive[], cell: number): MeshData {
  const { min, max } = sculptBounds(prims, cell * 2);
  const nx = Math.ceil((max[0] - min[0]) / cell);
  const ny = Math.ceil((max[1] - min[1]) / cell);
  const nz = Math.ceil((max[2] - min[2]) / cell);
  const sx = nx + 1;
  const sxy = sx * (ny + 1);
  const field = new Float32Array(sxy * (nz + 1));
  for (let k = 0; k <= nz; k++) {
    const z = min[2] + k * cell;
    for (let j = 0; j <= ny; j++) {
      const y = min[1] + j * cell;
      for (let i = 0; i <= nx; i++) {
        field[i + j * sx + k * sxy] = sculptDistance(prims, min[0] + i * cell, y, z);
      }
    }
  }

  // Sommets : un par cellule traversée.
  const cellVertex = new Int32Array(nx * ny * nz).fill(-1);
  const pos: number[] = [];
  const corner = new Float64Array(8);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          const o = CORNERS[c]!;
          const v = field[i + o[0] + (j + o[1]) * sx + (k + o[2]) * sxy]!;
          corner[c] = v;
          if (v < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        let ax = 0;
        let ay = 0;
        let az = 0;
        let n = 0;
        for (const [e0, e1] of EDGES) {
          const a = corner[e0]!;
          const b = corner[e1]!;
          if (a < 0 === b < 0) continue;
          const t = a / (a - b);
          const o0 = CORNERS[e0]!;
          const o1 = CORNERS[e1]!;
          ax += o0[0] + (o1[0] - o0[0]) * t;
          ay += o0[1] + (o1[1] - o0[1]) * t;
          az += o0[2] + (o1[2] - o0[2]) * t;
          n++;
        }
        cellVertex[i + j * nx + k * nx * ny] = pos.length / 3;
        pos.push(
          min[0] + (i + ax / n) * cell,
          min[1] + (j + ay / n) * cell,
          min[2] + (k + az / n) * cell,
        );
      }
    }
  }

  const count = pos.length / 3;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const zones = new Float32Array(count);
  const zones2 = new Float32Array(count);
  const zoneMix = new Float32Array(count);
  const dist = new Float64Array(prims.length);
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const eps = cell * 0.5;
  const boneWeight = new Float64Array(BONES.length);
  for (let v = 0; v < count; v++) {
    let x = pos[v * 3]!;
    let y = pos[v * 3 + 1]!;
    let z = pos[v * 3 + 2]!;
    // Deux pas vers la surface, le long du gradient.
    let gx = 0;
    let gy = 0;
    let gz = 0;
    for (let step = 0; step < 2; step++) {
      gx = sculptDistance(prims, x + eps, y, z) - sculptDistance(prims, x - eps, y, z);
      gy = sculptDistance(prims, x, y + eps, z) - sculptDistance(prims, x, y - eps, z);
      gz = sculptDistance(prims, x, y, z + eps) - sculptDistance(prims, x, y, z - eps);
      const len = Math.hypot(gx, gy, gz);
      if (len === 0) break;
      gx /= len;
      gy /= len;
      gz /= len;
      const d = sculptDistance(prims, x, y, z);
      // Pas borné : un sommet ne quitte jamais sa cellule de beaucoup.
      const move = Math.max(-cell, Math.min(cell, d));
      x -= gx * move;
      y -= gy * move;
      z -= gz * move;
    }
    positions.set([x, y, z], v * 3);
    normals.set([gx, gy, gz], v * 3);

    // Zone : celle du volume le plus proche. Poids : les os des volumes proches de la surface.
    boneWeight.fill(0);
    let best = Infinity;
    let zone = 0;
    for (let q = 0; q < prims.length; q++) {
      const d = primitiveDistance(prims[q]!, x, y, z);
      dist[q] = d;
      if (d < best) {
        best = d;
        zone = prims[q]!.zone;
      }
    }
    for (let q = 0; q < prims.length; q++) {
      const w = 1 - (dist[q]! - best) / SKIN_FALLOFF;
      if (w > 0) boneWeight[prims[q]!.bone] = Math.max(boneWeight[prims[q]!.bone]!, w * w);
    }
    zones[v] = zone;
    // Volume le plus proche d'une autre zone.
    let other = Infinity;
    let otherZone = zone;
    for (let q = 0; q < prims.length; q++) {
      if (prims[q]!.zone !== zone && dist[q]! < other) {
        other = dist[q]!;
        otherZone = prims[q]!.zone;
      }
    }
    zones2[v] = otherZone;
    zoneMix[v] = other === Infinity ? 0 : 0.5 * Math.max(0, 1 - (other - best) / ZONE_EDGE);
    let total = 0;
    for (let slot = 0; slot < 4; slot++) {
      let pick = -1;
      for (let b = 0; b < BONES.length; b++) {
        if (boneWeight[b]! > 0 && (pick < 0 || boneWeight[b]! > boneWeight[pick]!)) pick = b;
      }
      if (pick < 0) break;
      skinIndex[v * 4 + slot] = pick;
      skinWeight[v * 4 + slot] = boneWeight[pick]!;
      total += boneWeight[pick]!;
      boneWeight[pick] = 0;
    }
    for (let slot = 0; slot < 4; slot++) skinWeight[v * 4 + slot]! /= total || 1;
  }

  // Faces : un quadrilatère par arête de la grille qui traverse la surface.
  const index: number[] = [];
  const cellAt = (i: number, j: number, k: number): number => cellVertex[i + j * nx + k * nx * ny]!;
  const quad = (a: number, b: number, c: number, d: number): void => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // Orientation : la face regarde du côté où pointent les normales de ses sommets.
    const ux = positions[c * 3]! - positions[a * 3]!;
    const uy = positions[c * 3 + 1]! - positions[a * 3 + 1]!;
    const uz = positions[c * 3 + 2]! - positions[a * 3 + 2]!;
    const vx = positions[d * 3]! - positions[b * 3]!;
    const vy = positions[d * 3 + 1]! - positions[b * 3 + 1]!;
    const vz = positions[d * 3 + 2]! - positions[b * 3 + 2]!;
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    let nxs = 0;
    let nys = 0;
    let nzs = 0;
    for (const s of [a, b, c, d]) {
      nxs += normals[s * 3]!;
      nys += normals[s * 3 + 1]!;
      nzs += normals[s * 3 + 2]!;
    }
    if (fx * nxs + fy * nys + fz * nzs >= 0) index.push(a, b, c, a, c, d);
    else index.push(a, c, b, a, d, c);
  };
  for (let k = 1; k < nz; k++) {
    for (let j = 1; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        // Arête selon x, de (i, j, k) à (i + 1, j, k).
        const a = field[i + j * sx + k * sxy]!;
        const b = field[i + 1 + j * sx + k * sxy]!;
        if (a < 0 !== b < 0) {
          quad(cellAt(i, j - 1, k - 1), cellAt(i, j, k - 1), cellAt(i, j, k), cellAt(i, j - 1, k));
        }
      }
    }
  }
  for (let k = 1; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 1; i < nx; i++) {
        const a = field[i + j * sx + k * sxy]!;
        const b = field[i + (j + 1) * sx + k * sxy]!;
        if (a < 0 !== b < 0) {
          quad(cellAt(i - 1, j, k - 1), cellAt(i, j, k - 1), cellAt(i, j, k), cellAt(i - 1, j, k));
        }
      }
    }
  }
  for (let k = 0; k < nz; k++) {
    for (let j = 1; j < ny; j++) {
      for (let i = 1; i < nx; i++) {
        const a = field[i + j * sx + k * sxy]!;
        const b = field[i + j * sx + (k + 1) * sxy]!;
        if (a < 0 !== b < 0) {
          quad(cellAt(i - 1, j - 1, k), cellAt(i, j - 1, k), cellAt(i, j, k), cellAt(i - 1, j, k));
        }
      }
    }
  }

  return {
    positions,
    normals,
    zones,
    zones2,
    zoneMix,
    skinIndex,
    skinWeight,
    index: Uint32Array.from(index),
  };
}
