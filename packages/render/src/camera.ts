/**
 * Cadrage automatique. Logique pure, sans Three.js.
 *
 * La caméra regarde le plan de jeu de face : à la distance `d`, elle en montre une hauteur de
 * `2 · d · tanHalfFov` et une largeur égale à cette hauteur multipliée par `aspect`.
 */

export interface Framing {
  centerX: number;
  centerY: number;
  /** Distance de la caméra au plan de jeu. */
  distance: number;
}

export interface CameraBounds {
  /** Zone que la caméra peut montrer : les zones limites du stage. */
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  /** Marges gardées autour des combattants. Leur position est celle de leurs pieds. */
  readonly marginX: number;
  readonly marginTop: number;
  readonly marginBottom: number;
  /** Hauteur de vue en dessous de laquelle la caméra ne zoome plus. */
  readonly minViewHeight: number;
  readonly tanHalfFov: number;
  /** Largeur de l'écran divisée par sa hauteur. Change au redimensionnement. */
  aspect: number;
}

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/**
 * Cadre les `count` premiers points avec leurs marges, dans les limites du stage. Sans point,
 * `out` est laissé tel quel. N'alloue rien.
 */
export function frameFighters(
  xs: Float32Array,
  ys: Float32Array,
  count: number,
  bounds: CameraBounds,
  out: Framing,
): void {
  if (count <= 0) return;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  // Rien d'utile à montrer au-delà des zones limites : un combattant qui les franchit est KO.
  minX = clamp(minX - bounds.marginX, bounds.minX, bounds.maxX);
  maxX = clamp(maxX + bounds.marginX, bounds.minX, bounds.maxX);
  minY = clamp(minY - bounds.marginBottom, bounds.minY, bounds.maxY);
  maxY = clamp(maxY + bounds.marginTop, bounds.minY, bounds.maxY);

  const tan = bounds.tanHalfFov;
  const forHeight = (maxY - minY) / 2 / tan;
  const forWidth = (maxX - minX) / 2 / (tan * bounds.aspect);
  const closest = bounds.minViewHeight / 2 / tan;
  const distance = Math.max(forHeight, forWidth, closest);

  // Tant que la vue tient dans les zones limites, elle n'en déborde pas.
  const halfH = distance * tan;
  const halfW = halfH * bounds.aspect;
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY) / 2;
  out.centerX =
    bounds.minX + halfW > bounds.maxX - halfW
      ? midX
      : clamp((minX + maxX) / 2, bounds.minX + halfW, bounds.maxX - halfW);
  out.centerY =
    bounds.minY + halfH > bounds.maxY - halfH
      ? midY
      : clamp((minY + maxY) / 2, bounds.minY + halfH, bounds.maxY - halfH);
  out.distance = distance;
}

/** Part de l'écart à la cible rattrapée à chaque frame simulée. */
const CENTER_EASE = 0.1;
const ZOOM_IN_EASE = 0.04;
/** Reculer vite garde à l'écran un combattant éjecté ; se rapprocher lentement évite le pompage. */
const ZOOM_OUT_EASE = 0.18;

/** Rapproche `current` de `target` d'une frame simulée. */
export function approachFraming(current: Framing, target: Framing): void {
  current.centerX += (target.centerX - current.centerX) * CENTER_EASE;
  current.centerY += (target.centerY - current.centerY) * CENTER_EASE;
  const gap = target.distance - current.distance;
  current.distance += gap * (gap > 0 ? ZOOM_OUT_EASE : ZOOM_IN_EASE);
}

/**
 * Recule la caméra, sans la déplacer, jusqu'à montrer les `count` premiers points avec la moitié
 * de leurs marges. Garantit que l'adoucissement ne fait jamais sortir un combattant du cadre.
 */
export function ensureVisible(
  framing: Framing,
  xs: Float32Array,
  ys: Float32Array,
  count: number,
  bounds: CameraBounds,
): void {
  let reachX = 0;
  let reachY = 0;
  for (let i = 0; i < count; i++) {
    const dx = Math.abs(xs[i]! - framing.centerX) + bounds.marginX / 2;
    const dy = ys[i]! - framing.centerY;
    const reach = dy > 0 ? dy + bounds.marginTop / 2 : -dy + bounds.marginBottom / 2;
    if (dx > reachX) reachX = dx;
    if (reach > reachY) reachY = reach;
  }
  const tan = bounds.tanHalfFov;
  const needed = Math.max(reachY / tan, reachX / (tan * bounds.aspect));
  if (needed > framing.distance) framing.distance = needed;
}

export function copyFraming(from: Framing, to: Framing): void {
  to.centerX = from.centerX;
  to.centerY = from.centerY;
  to.distance = from.distance;
}

/** Abscisse à l'écran, en pixels depuis la gauche, d'un point du plan de jeu. */
export function projectX(framing: Framing, bounds: CameraBounds, x: number, width: number): number {
  const halfW = framing.distance * bounds.tanHalfFov * bounds.aspect;
  return ((x - framing.centerX) / halfW + 1) * 0.5 * width;
}

/** Ordonnée à l'écran, en pixels depuis le haut, d'un point du plan de jeu. */
export function projectY(
  framing: Framing,
  bounds: CameraBounds,
  y: number,
  height: number,
): number {
  const halfH = framing.distance * bounds.tanHalfFov;
  return (1 - (y - framing.centerY) / halfH) * 0.5 * height;
}
