/**
 * Stage vivant : plateformes mobiles et dangers périodiques (module stages-items).
 *
 * Tout ici est une fonction pure du numéro de frame, qui est dans l'état : une plateforme est
 * toujours à la position P(frame), et un danger se déclenche aux mêmes frames, rollback ou non.
 * Rien d'autre n'est sauvegardé. Les surfaces de `StageGeo` sont recalculées au début de chaque
 * `step` ; elles sont donc justes même juste après un `loadState`.
 */
import type { PlatformMotionDef, StageDef } from '../defs.ts';
import { G_FRAME, G_PLAYERS } from '../state.ts';
import type { Sim } from '../step.ts';
import type { StageGeo } from './collision.ts';

export interface StageMotion {
  /** Plateformes mobiles : index de la plateforme dans `StageDef.platforms`. */
  readonly count: number;
  readonly platform: Int32Array;
  /** Index de sa surface dans `StageGeo`. */
  readonly surface: Int32Array;
  readonly defs: readonly PlatformMotionDef[];
  readonly baseX1: Int32Array;
  readonly baseX2: Int32Array;
  readonly baseY: Int32Array;
  /** Déplacement de chaque surface pendant la frame en cours (0 pour une surface fixe). */
  readonly surfDX: Int32Array;
  readonly surfDY: Int32Array;
}

/**
 * Décalage de la plateforme à la frame `frame`, en virgule fixe, dans `out`. Aller pendant la
 * première moitié de la période, retour pendant la seconde, départ et arrivée adoucis par le
 * polynôme 3u² − 2u³ (calcul entier, identique partout).
 */
export function motionOffset(
  m: PlatformMotionDef,
  frame: number,
  out: { x: number; y: number },
): void {
  const period = m.period;
  const half = period >> 1;
  const t = (frame + m.phase) % period;
  // u de 0 à MOTION_ONE sur l'aller, puis de MOTION_ONE à 0 sur le retour. Calcul sur 16 bits
  // plutôt que sur les 12 de la virgule fixe : un pas plus régulier d'une frame à l'autre. Tous les
  // produits restent des entiers exacts (moins de 2^53).
  const u =
    t <= half
      ? Math.trunc((t * MOTION_ONE) / half)
      : Math.trunc(((period - t) * MOTION_ONE) / (period - half));
  const s = Math.trunc((Math.trunc((u * u) / MOTION_ONE) * (3 * MOTION_ONE - 2 * u)) / MOTION_ONE);
  out.x = Math.trunc((m.dx * s) / MOTION_ONE) | 0;
  out.y = Math.trunc((m.dy * s) / MOTION_ONE) | 0;
}

const MOTION_ONE = 65536;

export function compileMotion(stage: StageDef, geo: StageGeo): StageMotion {
  const movers: number[] = [];
  stage.platforms.forEach((p, k) => {
    if (p.motion !== undefined) movers.push(k);
  });
  const motion: StageMotion = {
    count: movers.length,
    platform: Int32Array.from(movers),
    surface: Int32Array.from(movers, (k) => stage.solids.length + k),
    defs: movers.map((k) => stage.platforms[k]!.motion!),
    baseX1: Int32Array.from(movers, (k) => stage.platforms[k]!.x1),
    baseX2: Int32Array.from(movers, (k) => stage.platforms[k]!.x2),
    baseY: Int32Array.from(movers, (k) => stage.platforms[k]!.y),
    surfDX: new Int32Array(geo.surfCount),
    surfDY: new Int32Array(geo.surfCount),
  };
  placeMovers(motion, geo, 0);
  geo.surfPrevY.set(geo.surfY);
  return motion;
}

const offset = { x: 0, y: 0 };

/** Pose les plateformes mobiles à leur position de la frame `frame`. */
function placeMovers(motion: StageMotion, geo: StageGeo, frame: number): void {
  for (let m = 0; m < motion.count; m++) {
    const k = motion.surface[m]!;
    motionOffset(motion.defs[m]!, frame, offset);
    geo.surfX1[k] = motion.baseX1[m]! + offset.x;
    geo.surfX2[k] = motion.baseX2[m]! + offset.x;
    geo.surfY[k] = motion.baseY[m]! + offset.y;
  }
}

/**
 * Début de frame : les plateformes mobiles passent de P(frame) à P(frame + 1), et emportent les
 * combattants posés dessus. À la fin du `step`, le numéro de frame vaut frame + 1 : l'invariant
 * « plateforme en P(frame) entre deux `step` » est respecté.
 */
export function updateStageMotion(sim: Sim): void {
  const motion = sim.motion;
  if (motion.count === 0) return;
  const s = sim.state;
  const geo = sim.geo;
  const now = s.g[G_FRAME]!;

  for (let m = 0; m < motion.count; m++) {
    const k = motion.surface[m]!;
    const def = motion.defs[m]!;
    motionOffset(def, now, offset);
    const fromX = offset.x;
    const fromY = motion.baseY[m]! + offset.y;
    motionOffset(def, now + 1, offset);
    geo.surfX1[k] = motion.baseX1[m]! + offset.x;
    geo.surfX2[k] = motion.baseX2[m]! + offset.x;
    geo.surfY[k] = motion.baseY[m]! + offset.y;
    geo.surfPrevY[k] = fromY;
    motion.surfDX[k] = offset.x - fromX;
    motion.surfDY[k] = geo.surfY[k]! - fromY;
  }

  const players = s.g[G_PLAYERS]!;
  for (let i = 0; i < players; i++) {
    if (s.grounded[i] !== 1) continue;
    const k = s.surface[i]! - 1;
    const dx = motion.surfDX[k]!;
    const dy = motion.surfDY[k]!;
    if (dx === 0 && dy === 0) continue;
    s.posX[i] = s.posX[i]! + dx;
    s.posY[i] = geo.surfY[k]!;
  }
}

/** Position courante de la plateforme `k` (P(frame)), en virgule fixe. */
export function platformAt(sim: Sim, k: number, out: { x1: number; x2: number; y: number }): void {
  const p = sim.config.stage.platforms[k]!;
  if (p.motion === undefined) {
    out.x1 = p.x1;
    out.x2 = p.x2;
    out.y = p.y;
    return;
  }
  motionOffset(p.motion, sim.state.g[G_FRAME]!, offset);
  out.x1 = p.x1 + offset.x;
  out.x2 = p.x2 + offset.x;
  out.y = p.y + offset.y;
}
