/**
 * Intégration du mouvement et collisions avec le décor.
 *
 * Le corps est réduit à trois points, comme un losange : les pieds (atterrissage), les flancs à
 * mi-hauteur (murs) et la tête (plafonds). Un combattant dont les pieds dépassent du bord tombe
 * donc le long du flanc au lieu de rester accroché par un coin.
 */
import { A_AIR, A_DASH, A_DEAD, A_JUMPSQUAT, A_LAND, A_RUN, setAction } from '../actions.ts';
import type { StageDef } from '../defs.ts';
import { inputStickY } from '../input.ts';
import type { Sim } from '../step.ts';

/** En dessous de cette valeur de stick Y, le joueur « tient bas » : il traverse les plateformes. */
export const STICK_HOLD_DOWN = -60;

/** Géométrie du stage aplatie en tableaux, pour que `step` n'accède à aucun objet. */
export interface StageGeo {
  /** Surfaces où l'on peut se tenir : dessus des blocs pleins, puis plateformes. */
  readonly surfCount: number;
  readonly surfX1: Int32Array;
  readonly surfX2: Int32Array;
  readonly surfY: Int32Array;
  /** 1 si la surface est une plateforme traversable. */
  readonly surfPass: Uint8Array;

  readonly solidCount: number;
  readonly solidX1: Int32Array;
  readonly solidY1: Int32Array;
  readonly solidX2: Int32Array;
  readonly solidY2: Int32Array;
}

export function compileStage(stage: StageDef): StageGeo {
  const solids = stage.solids;
  const platforms = stage.platforms;
  const surfCount = solids.length + platforms.length;
  const geo: StageGeo = {
    surfCount,
    surfX1: new Int32Array(surfCount),
    surfX2: new Int32Array(surfCount),
    surfY: new Int32Array(surfCount),
    surfPass: new Uint8Array(surfCount),
    solidCount: solids.length,
    solidX1: new Int32Array(solids.length),
    solidY1: new Int32Array(solids.length),
    solidX2: new Int32Array(solids.length),
    solidY2: new Int32Array(solids.length),
  };
  solids.forEach((b, k) => {
    geo.solidX1[k] = b.x1;
    geo.solidY1[k] = b.y1;
    geo.solidX2[k] = b.x2;
    geo.solidY2[k] = b.y2;
    geo.surfX1[k] = b.x1;
    geo.surfX2[k] = b.x2;
    geo.surfY[k] = b.y2;
  });
  platforms.forEach((p, n) => {
    const k = solids.length + n;
    geo.surfX1[k] = p.x1;
    geo.surfX2[k] = p.x2;
    geo.surfY[k] = p.y;
    geo.surfPass[k] = 1;
  });
  return geo;
}

/** Surface exactement sous le point (x, y) : index + 1, ou 0 s'il n'y en a pas. */
export function findSurface(geo: StageGeo, x: number, y: number): number {
  for (let k = 0; k < geo.surfCount; k++) {
    if (geo.surfY[k] === y && x >= geo.surfX1[k]! && x <= geo.surfX2[k]!) return k + 1;
  }
  return 0;
}

/** Repousse le combattant hors des blocs pleins que ses flancs pénètrent. */
function pushOutOfWalls(sim: Sim, i: number, halfWidth: number, height: number): void {
  const s = sim.state;
  const geo = sim.geo;
  const midY = s.posY[i]! + (height >> 1);
  for (let k = 0; k < geo.solidCount; k++) {
    if (midY <= geo.solidY1[k]! || midY >= geo.solidY2[k]!) continue;
    const x = s.posX[i]!;
    const x1 = geo.solidX1[k]!;
    const x2 = geo.solidX2[k]!;
    if (x + halfWidth <= x1 || x - halfWidth >= x2) continue;
    if (x * 2 < x1 + x2) {
      s.posX[i] = x1 - halfWidth;
      if (s.velX[i]! > 0) s.velX[i] = 0;
    } else {
      s.posX[i] = x2 + halfWidth;
      if (s.velX[i]! < 0) s.velX[i] = 0;
    }
  }
}

function integrateGrounded(sim: Sim, i: number): void {
  const s = sim.state;
  const geo = sim.geo;
  const def = sim.config.fighters[i]!;
  const k = s.surface[i]! - 1;
  const x1 = geo.surfX1[k]!;
  const x2 = geo.surfX2[k]!;
  let x = s.posX[i]! + s.velX[i]!;

  if (x < x1 || x > x2) {
    const action = s.action[i]!;
    if (action === A_DASH || action === A_RUN || action === A_JUMPSQUAT) {
      // Élan suffisant : le combattant quitte la surface et garde ses sauts aériens.
      s.grounded[i] = 0;
      s.surface[i] = 0;
      s.jumpsLeft[i] = def.airJumps;
      setAction(s, i, A_AIR);
    } else {
      // Sinon il s'arrête au bord.
      x = x < x1 ? x1 : x2;
      s.velX[i] = 0;
    }
  }
  s.posX[i] = x;
  pushOutOfWalls(sim, i, def.halfWidth, def.height);
}

function integrateAirborne(sim: Sim, i: number): void {
  const s = sim.state;
  const geo = sim.geo;
  const def = sim.config.fighters[i]!;
  const height = def.height;

  let vy: number;
  if (s.fastFall[i] === 1) {
    vy = -def.fastFallSpeed;
  } else {
    vy = s.velY[i]! - def.gravity;
    if (vy < -def.maxFallSpeed) vy = -def.maxFallSpeed;
  }

  s.posX[i] = s.posX[i]! + s.velX[i]!;
  pushOutOfWalls(sim, i, def.halfWidth, height);
  const x = s.posX[i]!;

  const prevY = s.posY[i]!;
  let y = prevY + vy;

  if (vy > 0) {
    // Plafond : la tête franchit le dessous d'un bloc plein.
    for (let k = 0; k < geo.solidCount; k++) {
      const bottom = geo.solidY1[k]!;
      if (
        x > geo.solidX1[k]! &&
        x < geo.solidX2[k]! &&
        prevY + height <= bottom &&
        y + height > bottom
      ) {
        y = bottom - height;
        vy = 0;
      }
    }
  } else {
    // Atterrissage : les pieds franchissent une surface de haut en bas. S'il y en a plusieurs,
    // la plus haute gagne, car c'est la première rencontrée.
    const holdingDown = inputStickY(s.input[i]!) <= STICK_HOLD_DOWN;
    let landed = -1;
    for (let k = 0; k < geo.surfCount; k++) {
      const top = geo.surfY[k]!;
      if (prevY < top || y > top || x < geo.surfX1[k]! || x > geo.surfX2[k]!) continue;
      if (geo.surfPass[k] === 1 && holdingDown) continue;
      if (landed < 0 || top > geo.surfY[landed]!) landed = k;
    }
    if (landed >= 0) {
      s.posY[i] = geo.surfY[landed]!;
      s.velY[i] = 0;
      s.grounded[i] = 1;
      s.surface[i] = landed + 1;
      s.fastFall[i] = 0;
      setAction(s, i, A_LAND);
      return;
    }
  }
  s.posY[i] = y;
  s.velY[i] = vy;
}

export function integrate(sim: Sim, i: number): void {
  const s = sim.state;
  if (s.action[i] === A_DEAD) return;
  if (s.grounded[i] === 1) integrateGrounded(sim, i);
  else integrateAirborne(sim, i);
}
