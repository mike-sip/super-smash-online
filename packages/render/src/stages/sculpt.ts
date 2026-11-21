/**
 * Géométrie « héroïque » des décors (SPEC-finition.md, phase 1) : formes douces générées par le
 * code, à la place des facettes low-poly. Roches déformées par un bruit, pierres taillées aux
 * arêtes arrondies, pièces tournées (balustres, colonnes), toutes coloriées par sommet et prêtes à
 * fusionner avec les autres géométries d'un décor (non indexées, position, normale, couleur).
 *
 * Hasard à graine uniquement : un stage a toujours exactement le même décor.
 */
import {
  BufferAttribute,
  Color,
  IcosahedronGeometry,
  LatheGeometry,
  Vector2,
  type BufferGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/** Bruit de valeur en 3D, de 0 à 1, déterministe. */
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const h = (i: number, j: number, k: number): number => {
    let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1440662683) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  return lerp(
    lerp(
      lerp(h(xi, yi, zi), h(xi + 1, yi, zi), u),
      lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u),
      v,
    ),
    lerp(
      lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u),
      lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u),
      v,
    ),
    w,
  );
}

/** Somme de trois octaves de `noise3`, de 0 à 1 environ. */
export function fbm3(x: number, y: number, z: number, seed = 0): number {
  return (
    0.55 * noise3(x, y, z, seed) +
    0.3 * noise3(x * 2.03 + 5.1, y * 2.03, z * 2.03, seed + 1) +
    0.15 * noise3(x * 4.1, y * 4.1 + 2.7, z * 4.1, seed + 2)
  );
}

/**
 * Déforme `geometry` le long de ses normales : `amplitude` en unités, `frequency` en cycles par
 * unité. Les sommets confondus bougent ensemble (surface sans fissure). Renvoie une géométrie
 * indexée, normales recalculées.
 */
export function displace(
  geometry: BufferGeometry,
  amplitude: number,
  frequency: number,
  seed: number,
): BufferGeometry {
  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('normal');
  const merged = mergeVertices(geometry, 1e-4);
  geometry.dispose();
  merged.computeVertexNormals();
  const pos = merged.getAttribute('position');
  const nor = merged.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const d = (fbm3(x * frequency, y * frequency, z * frequency, seed) - 0.5) * 2 * amplitude;
    pos.setXYZ(i, x + nor.getX(i) * d, y + nor.getY(i) * d, z + nor.getZ(i) * d);
  }
  merged.computeVertexNormals();
  return merged;
}

const shade = new Color();

/**
 * Colorie `geometry` de `color` avec des nuances douces (bruit dans l'espace, pas par facette),
 * garde ses normales lissées, et la rend non indexée : prête à fusionner. `variation` de 0 à 1.
 */
export function paint(
  geometry: BufferGeometry,
  color: number,
  variation = 0.1,
  seed = 0,
): BufferGeometry {
  geometry.deleteAttribute('uv');
  if (geometry.getAttribute('normal') === undefined) geometry.computeVertexNormals();
  const flat = geometry.index === null ? geometry : geometry.toNonIndexed();
  if (flat !== geometry) geometry.dispose();
  const pos = flat.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const base = new Color(color);
  for (let i = 0; i < pos.count; i++) {
    const n = fbm3(pos.getX(i) * 0.08, pos.getY(i) * 0.08, pos.getZ(i) * 0.08, seed + 31);
    const k = 1 + (n - 0.5) * 2 * variation;
    shade.setRGB(base.r * k, base.g * k, base.b * k);
    colors[i * 3] = shade.r;
    colors[i * 3 + 1] = shade.g;
    colors[i * 3 + 2] = shade.b;
  }
  flat.setAttribute('color', new BufferAttribute(colors, 3));
  return flat;
}

/** Pavé aux arêtes arrondies (pierre taillée, planche), centré à l'origine. */
export function roundedBox(
  width: number,
  height: number,
  depth: number,
  radius: number,
  segments = 2,
): BufferGeometry {
  const r = Math.min(radius, width / 2, height / 2, depth / 2) * 0.999;
  return new RoundedBoxGeometry(width, height, depth, segments, r);
}

/** Pièce tournée d'après un profil (rayon, hauteur), de bas en haut. */
export function lathe(
  profile: readonly (readonly [number, number])[],
  segments = 14,
): BufferGeometry {
  return new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    segments,
  );
}

/** Balustre classique, de hauteur `height`, posé sur y = 0. */
export function baluster(height: number, width: number): BufferGeometry {
  const r = width / 2;
  const h = height;
  return lathe(
    [
      [0.001, 0],
      [r, 0],
      [r, 0.07 * h],
      [r * 0.62, 0.11 * h],
      [r * 0.7, 0.2 * h],
      [r * 0.95, 0.42 * h],
      [r * 0.7, 0.62 * h],
      [r * 0.42, 0.78 * h],
      [r * 0.48, 0.86 * h],
      [r * 0.82, 0.9 * h],
      [r * 0.85, h],
      [0.001, h],
    ],
    12,
  );
}

/** Rocher irrégulier de rayon moyen `radius`. */
export function boulder(radius: number, seed: number, detail = 3): BufferGeometry {
  // Icosaèdre subdivisé : sommets répartis également, sans pôles.
  return displace(icosphere(radius, detail), radius * 0.28, 1.6 / radius, seed);
}

/** Sphère géodésique, sommets répartis sans pôles. */
export function icosphere(radius: number, detail: number): BufferGeometry {
  return new IcosahedronGeometry(radius, detail);
}
