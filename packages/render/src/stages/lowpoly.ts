/**
 * Outils des décors low-poly : géométries colorées par facette, fusionnées en une seule géométrie
 * par décor (un seul appel de dessin pour tout le décor fixe).
 *
 * Le hasard des décors est un générateur à graine : un stage a toujours exactement le même décor.
 * Rien ici ne touche à la simulation.
 */
import { BufferAttribute, Color, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Générateur à graine, de 0 (inclus) à 1 (exclu). */
export function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const tint = new Color();

/**
 * Colore chaque triangle de `geometry` de `color`, éclairci ou assombri au hasard de `variation`
 * (0 à 1) : les facettes se distinguent, c'est le style low-poly. Renvoie une géométrie non
 * indexée, prête à fusionner ; l'originale est libérée.
 */
export function facets(
  geometry: BufferGeometry,
  color: number,
  variation: number,
  random: () => number,
): BufferGeometry {
  const flat = geometry.index === null ? geometry : geometry.toNonIndexed();
  if (flat !== geometry) geometry.dispose();
  flat.deleteAttribute('uv');
  const count = flat.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const base = new Color(color);
  for (let v = 0; v < count; v += 3) {
    const shade = 1 + (random() * 2 - 1) * variation;
    tint.setRGB(base.r * shade, base.g * shade, base.b * shade);
    for (let k = 0; k < 3; k++) {
      colors[(v + k) * 3] = tint.r;
      colors[(v + k) * 3 + 1] = tint.g;
      colors[(v + k) * 3 + 2] = tint.b;
    }
  }
  flat.setAttribute('color', new BufferAttribute(colors, 3));
  flat.computeVertexNormals();
  return flat;
}

/**
 * Dégradé vertical sur une géométrie : `top` en haut, `bottom` en bas, d'après la hauteur de
 * chaque sommet. Pour les fonds de ciel.
 */
export function gradient(geometry: BufferGeometry, top: number, bottom: number): BufferGeometry {
  const flat = geometry.index === null ? geometry : geometry.toNonIndexed();
  if (flat !== geometry) geometry.dispose();
  flat.deleteAttribute('uv');
  const position = flat.getAttribute('position');
  flat.computeBoundingBox();
  const box = flat.boundingBox!;
  const span = box.max.y - box.min.y || 1;
  const a = new Color(bottom);
  const b = new Color(top);
  const colors = new Float32Array(position.count * 3);
  for (let v = 0; v < position.count; v++) {
    tint.lerpColors(a, b, (position.getY(v) - box.min.y) / span);
    colors[v * 3] = tint.r;
    colors[v * 3 + 1] = tint.g;
    colors[v * 3 + 2] = tint.b;
  }
  flat.setAttribute('color', new BufferAttribute(colors, 3));
  return flat;
}

/** Fusionne des géométries préparées par `facets` ou `gradient`, et libère les morceaux. */
export function merge(parts: readonly BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts as BufferGeometry[], false);
  for (const part of parts) part.dispose();
  if (merged === null) throw new Error('Fusion impossible : attributs incompatibles.');
  return merged;
}

/** Met à l'échelle, tourne autour de l'axe vertical puis place une géométrie ; la renvoie. */
export function at(
  geometry: BufferGeometry,
  x: number,
  y: number,
  z: number,
  sx = 1,
  sy = 1,
  sz = 1,
  rotY = 0,
): BufferGeometry {
  geometry.scale(sx, sy, sz);
  if (rotY !== 0) geometry.rotateY(rotY);
  geometry.translate(x, y, z);
  return geometry;
}

/** Nombre au hasard entre `min` et `max`. */
export const between = (random: () => number, min: number, max: number): number =>
  min + (max - min) * random();

/**
 * État d'un danger périodique à la frame `frame`, pour l'annonce et le jet : 0 au repos, de 0 à 1
 * pendant l'annonce, 1 pendant le jet. Même calcul de cycle que la simulation.
 */
export function hazardLevel(
  hazard: {
    readonly period: number;
    readonly phase: number;
    readonly duration: number;
    readonly warning: number;
  },
  frame: number,
): number {
  const t = (((frame - hazard.phase) % hazard.period) + hazard.period) % hazard.period;
  if (t < hazard.duration) return 1;
  const announce = hazard.period - hazard.warning;
  return t >= announce ? (t - announce) / hazard.warning : 0;
}
