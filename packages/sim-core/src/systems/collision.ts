/**
 * Intégration du mouvement et collisions avec le décor.
 *
 * Le corps est réduit à trois points, comme un losange : les pieds (atterrissage), les flancs à
 * mi-hauteur (murs) et la tête (plafonds). Un combattant dont les pieds dépassent du bord tombe
 * donc le long du flanc au lieu de rester accroché par un coin.
 */
import {
  A_AIR,
  A_AIRDODGE,
  A_ATTACK,
  A_DASH,
  A_DEAD,
  A_DOWN,
  A_GRABBED,
  A_HITSTUN,
  A_IDLE,
  A_JUMPSQUAT,
  A_LAND,
  A_LEDGE,
  A_LEDGE_ROLL,
  A_RUN,
  A_SHIELD_BREAK,
  A_TECH,
  A_TUMBLE,
  setAction,
} from '../actions.ts';
import type { StageDef } from '../defs.ts';
import { fx, fxMul } from '../fixed.ts';
import { inputStickY } from '../input.ts';
import type { SimState } from '../state.ts';
import type { Sim } from '../step.ts';

/** En dessous de cette valeur de stick Y, le joueur « tient bas » : il traverse les plateformes. */
export const STICK_HOLD_DOWN = -60;
/** Vitesse d'impact à partir de laquelle un combattant éjecté rebondit au sol au lieu de s'y étaler. */
const BOUNCE_MIN_SPEED = fx(1.5);
/** Part de la vitesse conservée après un rebond au sol. */
const GROUND_RESTITUTION = fx(0.5);
/** Part de la vitesse conservée après un rebond contre un mur ou un plafond. */
const WALL_RESTITUTION = fx(0.8);

/** Géométrie du stage aplatie en tableaux, pour que `step` n'accède à aucun objet. */
export interface StageGeo {
  /** Rebords : les deux coins supérieurs de chaque bloc plein. */
  readonly ledgeCount: number;
  readonly ledgeX: Int32Array;
  readonly ledgeY: Int32Array;
  /** -1 pour un rebord gauche (on s'y suspend à gauche du bloc), 1 pour un rebord droit. */
  readonly ledgeSide: Int32Array;

  /** Surfaces où l'on peut se tenir : dessus des blocs pleins, puis plateformes. */
  readonly surfCount: number;
  readonly surfX1: Int32Array;
  readonly surfX2: Int32Array;
  readonly surfY: Int32Array;
  /**
   * Hauteur de la surface à la frame précédente. Égale à `surfY` pour une surface fixe ; pour une
   * plateforme mobile, l'atterrissage s'y compare (voir `systems/stage-motion.ts`).
   */
  readonly surfPrevY: Int32Array;
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
    ledgeCount: solids.length * 2,
    ledgeX: new Int32Array(solids.length * 2),
    ledgeY: new Int32Array(solids.length * 2),
    ledgeSide: new Int32Array(solids.length * 2),
    surfCount,
    surfX1: new Int32Array(surfCount),
    surfX2: new Int32Array(surfCount),
    surfY: new Int32Array(surfCount),
    surfPrevY: new Int32Array(surfCount),
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
    geo.ledgeX[k * 2] = b.x1;
    geo.ledgeY[k * 2] = b.y2;
    geo.ledgeSide[k * 2] = -1;
    geo.ledgeX[k * 2 + 1] = b.x2;
    geo.ledgeY[k * 2 + 1] = b.y2;
    geo.ledgeSide[k * 2 + 1] = 1;
  });
  platforms.forEach((p, n) => {
    const k = solids.length + n;
    geo.surfX1[k] = p.x1;
    geo.surfX2[k] = p.x2;
    geo.surfY[k] = p.y;
    geo.surfPass[k] = 1;
  });
  geo.surfPrevY.set(geo.surfY);
  return geo;
}

/** Surface exactement sous le point (x, y) : index + 1, ou 0 s'il n'y en a pas. */
export function findSurface(geo: StageGeo, x: number, y: number): number {
  for (let k = 0; k < geo.surfCount; k++) {
    if (geo.surfY[k] === y && x >= geo.surfX1[k]! && x <= geo.surfX2[k]!) return k + 1;
  }
  return 0;
}

const isKnockedBack = (action: number): boolean => action === A_HITSTUN || action === A_TUMBLE;

/** Le combattant heurte un mur : arrêt net, ou rebond et rétablissement s'il est éjecté. */
function hitWall(s: SimState, i: number): void {
  if (!isKnockedBack(s.action[i]!)) {
    s.velX[i] = 0;
    return;
  }
  if (s.techWindow[i]! > 0) {
    s.techWindow[i] = 0;
    s.bufShield[i] = 0;
    s.velX[i] = 0;
    s.velY[i] = 0;
    s.stun[i] = 0;
    s.tumble[i] = 0;
    setAction(s, i, s.grounded[i] === 1 ? A_IDLE : A_AIR);
    return;
  }
  s.velX[i] = -fxMul(s.velX[i]!, WALL_RESTITUTION);
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
      if (s.velX[i]! > 0) hitWall(s, i);
    } else {
      s.posX[i] = x2 + halfWidth;
      if (s.velX[i]! < 0) hitWall(s, i);
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
    if (action === A_HITSTUN) {
      // Poussé hors de la surface par un coup : il tombe sans reprendre le contrôle.
      s.grounded[i] = 0;
      s.surface[i] = 0;
      s.jumpsLeft[i] = def.airJumps;
    } else if (action === A_DASH || action === A_RUN || action === A_JUMPSQUAT) {
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

/** Pose le combattant sur la surface `k` et choisit l'action d'atterrissage. */
function land(sim: Sim, i: number, k: number, knocked: boolean): void {
  const s = sim.state;
  const def = sim.config.fighters[i]!;
  const action = s.action[i]!;
  s.posY[i] = sim.geo.surfY[k]!;
  s.velY[i] = 0;
  s.grounded[i] = 1;
  s.surface[i] = k + 1;
  s.fastFall[i] = 0;
  s.airDodged[i] = 0;
  s.floatFrames[i] = 0;
  s.ledgeGrabs[i] = 0;

  if (knocked) {
    s.stun[i] = 0;
    s.tumble[i] = 0;
    if (s.techWindow[i]! > 0) {
      s.techWindow[i] = 0;
      s.bufShield[i] = 0;
      s.velX[i] = 0;
      setAction(s, i, A_TECH);
    } else {
      setAction(s, i, A_DOWN);
    }
  } else if (action === A_HITSTUN) {
    // Coup faible : il glisse au sol jusqu'à la fin du hitstun.
  } else if (action === A_SHIELD_BREAK) {
    // Bouclier brisé : l'étourdissement se poursuit au sol.
  } else if (action === A_AIRDODGE) {
    s.intangible[i] = 0;
    s.landLag[i] = def.airDodgeLandingLag;
    setAction(s, i, A_LAND);
  } else {
    const move = action === A_ATTACK ? def.moves[s.move[i]!] : undefined;
    s.landLag[i] = move?.landingLag ?? def.landFrames;
    setAction(s, i, A_LAND);
  }
}

function integrateAirborne(sim: Sim, i: number): void {
  const s = sim.state;
  const geo = sim.geo;
  const def = sim.config.fighters[i]!;
  const height = def.height;

  let vy: number;
  if (s.floatFrames[i]! > 0) {
    // Esquive aérienne directionnelle : la gravité est suspendue quelques frames.
    s.floatFrames[i] = s.floatFrames[i]! - 1;
    vy = s.velY[i]!;
  } else if (s.fastFall[i] === 1) {
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
        vy = isKnockedBack(s.action[i]!) ? -fxMul(vy, WALL_RESTITUTION) : 0;
      }
    }
  } else {
    // Atterrissage : les pieds franchissent une surface de haut en bas. S'il y en a plusieurs,
    // la plus haute gagne, car c'est la première rencontrée. Les pieds sont comparés à la hauteur
    // de la surface avant et après la frame : une plateforme qui monte ne laisse pas passer.
    const holdingDown = inputStickY(s.input[i]!) <= STICK_HOLD_DOWN;
    let landed = -1;
    for (let k = 0; k < geo.surfCount; k++) {
      const top = geo.surfY[k]!;
      if (prevY < geo.surfPrevY[k]! || y > top || x < geo.surfX1[k]! || x > geo.surfX2[k]!)
        continue;
      if (geo.surfPass[k] === 1 && holdingDown) continue;
      if (landed < 0 || top > geo.surfY[landed]!) landed = k;
    }
    if (landed >= 0) {
      const action = s.action[i]!;
      const knocked = action === A_TUMBLE || (action === A_HITSTUN && s.tumble[i] === 1);
      if (knocked && s.techWindow[i] === 0 && s.bounced[i] === 0 && -vy >= BOUNCE_MIN_SPEED) {
        // Rétablissement manqué à grande vitesse : un rebond, une seule fois.
        s.posY[i] = geo.surfY[landed]!;
        s.velY[i] = fxMul(-vy, GROUND_RESTITUTION);
        s.bounced[i] = 1;
        return;
      }
      land(sim, i, landed, knocked);
      return;
    }
  }
  s.posY[i] = y;
  s.velY[i] = vy;
}

export function integrate(sim: Sim, i: number): void {
  const s = sim.state;
  const action = s.action[i]!;
  // Un combattant tenu ne bouge pas de lui-même : sa position est imposée par celui qui le tient.
  // Un combattant suspendu à un rebord non plus.
  if (action === A_DEAD || action === A_GRABBED || (action >= A_LEDGE && action <= A_LEDGE_ROLL)) {
    return;
  }
  if (s.grounded[i] === 1) integrateGrounded(sim, i);
  else integrateAirborne(sim, i);
}
