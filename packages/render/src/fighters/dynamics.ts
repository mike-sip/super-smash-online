/**
 * Mouvements secondaires (SPEC-visuals.md, phase 5) : cheveux, pans de tissu, voiles et jupes
 * suivent le corps avec retard, grâce à des ressorts amortis. Logique pure.
 *
 * Chaque chaîne a deux segments. Leur angle (autour de l'axe de profondeur, comme les membres)
 * cherche à garder le segment pendant vers le bas malgré l'inclinaison du corps, et se laisse
 * emporter par l'accélération : quand le corps part en avant, les cheveux restent en arrière.
 *
 * Le temps est celui de la simulation, en frames : les ressorts se figent en pause et ralentissent
 * au ralenti. Après une téléportation ou un saut dans le temps, on repart du repos.
 */

/** Raideur et amortissement, par frame ; le second segment est plus souple. */
const STIFFNESS = [0.16, 0.11] as const;
const DAMPING = [0.32, 0.26] as const;
/** Part de l'inclinaison du parent que le segment compense pour pendre vers le bas. */
const GRAVITY_FOLLOW = 0.8;
/** Couple d'inertie par unité d'accélération du point d'attache (unités de jeu par frame²). */
const INERTIA = 0.9;
/** Angle maximal, pour qu'un choc violent ne fasse pas tourner les cheveux en hélice. */
const MAX_ANGLE = 1.4;
/** Pas de temps maximal intégré d'un coup, en frames (au-delà, plusieurs pas). */
const MAX_STEP = 1;

export interface Chain {
  /** Angle et vitesse angulaire de chaque segment. */
  readonly angle: Float64Array;
  readonly speed: Float64Array;
  /** Vitesse horizontale précédente du point d'attache, pour l'accélération. */
  lastVx: number;
  lastVy: number;
  primed: boolean;
}

export function createChain(): Chain {
  return {
    angle: new Float64Array(2),
    speed: new Float64Array(2),
    lastVx: 0,
    lastVy: 0,
    primed: false,
  };
}

export function resetChain(c: Chain): void {
  c.angle.fill(0);
  c.speed.fill(0);
  c.primed = false;
}

const clamp = (v: number, lim: number): number => (v < -lim ? -lim : v > lim ? lim : v);

/**
 * Avance la chaîne de `dt` frames. `tilt` : inclinaison du parent vers l'avant (radians, comme le
 * torse) ; (vx, vy) : vitesse du point d'attache dans le repère du combattant (x vers l'avant),
 * en unités de jeu par frame. N'alloue rien.
 */
export function stepChain(c: Chain, dt: number, tilt: number, vx: number, vy: number): void {
  if (dt <= 0) return;
  if (!c.primed) {
    c.lastVx = vx;
    c.lastVy = vy;
    c.primed = true;
  }
  const ax = (vx - c.lastVx) / dt;
  const ay = (vy - c.lastVy) / dt;
  c.lastVx = vx;
  c.lastVy = vy;
  // Force d'inertie : accélérer vers l'avant ou monter vite rejette la chaîne en arrière.
  const push = -(ax + 0.35 * Math.abs(ay)) * INERTIA;
  let left = dt;
  while (left > 0) {
    const h = Math.min(MAX_STEP, left);
    left -= h;
    for (let s = 0; s < 2; s++) {
      // Le second segment cherche lui aussi la verticale, en partant de l'angle du premier.
      const base = s === 0 ? GRAVITY_FOLLOW * tilt : 0.7 * (GRAVITY_FOLLOW * tilt - c.angle[0]!);
      const inertia = push * (s === 0 ? 1 : 0.6);
      const accel =
        STIFFNESS[s] * (clamp(base, MAX_ANGLE) - c.angle[s]!) - DAMPING[s] * c.speed[s]! + inertia;
      c.speed[s] = c.speed[s]! + accel * h;
      c.angle[s] = clamp(c.angle[s]! + c.speed[s]! * h, MAX_ANGLE);
    }
  }
}
