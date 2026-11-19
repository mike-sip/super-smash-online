/**
 * Cadrage automatique. Logique pure, sans Three.js.
 *
 * La caméra regarde le plan de jeu presque de face : à la distance `d`, elle en montre une hauteur
 * de `2 · d · tanHalfFov` et une largeur égale à cette hauteur multipliée par `aspect`. Elle est
 * légèrement surélevée et inclinée vers le bas (`tilt`), pour que le dessus des plateformes et les
 * ombres qui s'y posent se voient ; le cadrage reste calculé comme pour une caméra de face, l'écart
 * (quelques pour cent près des bords) étant absorbé par les marges.
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
  /** Inclinaison de la caméra vers le bas, en radians (0 = de face). */
  readonly tilt: number;
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

/** Position de la caméra pour un cadrage : au-dessus et en avant du centre visé. */
export function cameraPosition(
  framing: Framing,
  bounds: CameraBounds,
  out: { x: number; y: number; z: number },
): void {
  out.x = framing.centerX;
  out.y = framing.centerY + framing.distance * Math.sin(bounds.tilt);
  out.z = framing.distance * Math.cos(bounds.tilt);
}

/** Profondeur, le long de l'axe de la caméra, d'un point du plan de jeu à la hauteur `y`. */
function depthOf(framing: Framing, bounds: CameraBounds, y: number): number {
  return framing.distance - (y - framing.centerY) * Math.sin(bounds.tilt);
}

/** Abscisse à l'écran, en pixels depuis la gauche, du point (x, y) du plan de jeu. */
export function projectX(
  framing: Framing,
  bounds: CameraBounds,
  x: number,
  y: number,
  width: number,
): number {
  const halfW = depthOf(framing, bounds, y) * bounds.tanHalfFov * bounds.aspect;
  return ((x - framing.centerX) / halfW + 1) * 0.5 * width;
}

/** Ordonnée à l'écran, en pixels depuis le haut, d'un point du plan de jeu à la hauteur `y`. */
export function projectY(
  framing: Framing,
  bounds: CameraBounds,
  y: number,
  height: number,
): number {
  const halfH = depthOf(framing, bounds, y) * bounds.tanHalfFov;
  return (1 - ((y - framing.centerY) * Math.cos(bounds.tilt)) / halfH) * 0.5 * height;
}

/**
 * Secousse de caméra : une impulsion d'amplitude `amount` (en part de la hauteur de vue) qui
 * s'éteint en `life` frames. Une impulsion plus faible que ce qui reste de la précédente est
 * ignorée. Le temps est celui de la simulation : la secousse se fige en pause.
 */
export interface Shake {
  amount: number;
  born: number;
  life: number;
}

export function createShake(): Shake {
  return { amount: 0, born: 0, life: 0 };
}

export function shakeLevel(shake: Shake, time: number): number {
  const age = time - shake.born;
  if (shake.life <= 0 || age < 0 || age >= shake.life) return 0;
  const left = 1 - age / shake.life;
  return shake.amount * left * left;
}

export function addShake(shake: Shake, amount: number, life: number, frame: number): void {
  if (amount < shakeLevel(shake, frame)) return;
  shake.amount = amount;
  shake.born = frame;
  shake.life = life;
}

/** Décalage de la caméra, en unités de jeu, pour une vue à la distance `distance`. */
export function shakeOffset(
  shake: Shake,
  time: number,
  distance: number,
  bounds: CameraBounds,
  out: { x: number; y: number },
): void {
  const level = shakeLevel(shake, time) * distance * bounds.tanHalfFov;
  // Deux sinus de fréquences non multiples : un tremblement irrégulier mais reproductible.
  out.x = level * (Math.sin(time * 2.9) * 0.6 + Math.sin(time * 5.3 + 1.3) * 0.4);
  out.y = level * (Math.sin(time * 3.7 + 0.7) * 0.6 + Math.sin(time * 6.1 + 2.1) * 0.4);
}

/**
 * Gros plan bref sur un coup décisif : la vue se resserre sur (x, y), tient, puis revient. Purement
 * visuel : la simulation continue au même rythme.
 */
export interface CloseUp {
  x: number;
  y: number;
  born: number;
  life: number;
}

export function createCloseUp(): CloseUp {
  return { x: 0, y: 0, born: 0, life: 0 };
}

/** Frames pour se resserrer, puis pour revenir. */
const CLOSE_IN = 3;
const CLOSE_OUT = 10;
/** Part de la distance gardée au plus près. */
const CLOSE_ZOOM = 0.6;

export function startCloseUp(c: CloseUp, x: number, y: number, life: number, frame: number): void {
  c.x = x;
  c.y = y;
  c.born = frame;
  c.life = life;
}

/** Poids du gros plan à l'instant `time`, de 0 (vue normale) à 1 (au plus près). */
export function closeUpWeight(c: CloseUp, time: number): number {
  const age = time - c.born;
  if (c.life <= 0 || age < 0 || age >= c.life) return 0;
  const w = Math.min(1, age / CLOSE_IN, (c.life - age) / CLOSE_OUT);
  return w * w * (3 - 2 * w);
}

/** Applique le gros plan à `framing` (modifié sur place), sans passer sous le zoom minimal. */
export function applyCloseUp(
  c: CloseUp,
  time: number,
  bounds: CameraBounds,
  framing: Framing,
): void {
  const w = closeUpWeight(c, time);
  if (w <= 0) return;
  const closest = bounds.minViewHeight / 2 / bounds.tanHalfFov;
  const near = Math.max(framing.distance * CLOSE_ZOOM, closest * 0.8);
  framing.centerX += (c.x - framing.centerX) * w;
  framing.centerY += (c.y - framing.centerY) * w;
  framing.distance += (near - framing.distance) * w;
}
