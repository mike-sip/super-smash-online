/**
 * Entités : tout ce qui vit sur le terrain sans être un combattant (projectiles, objets).
 *
 * Le moteur fournit le mouvement, la durée de vie, les collisions et les coups. Le contenu
 * (quels projectiles, quels objets, quand ils apparaissent) vient des modules `fighters` et
 * `stages-items`, via `SimConfig.entities`, `MoveDef.spawn` et `spawnEntity`.
 *
 * La réserve est fixe (`MAX_ENTITIES`) : créer une entité n'alloue jamais de mémoire.
 */
import { fx, fxMul } from '../fixed.ts';
import { MAX_ENTITIES } from '../state.ts';
import type { Sim } from '../step.ts';

/** Comportement d'une entité au contact d'un bloc plein. */
export const ENTITY_PASS = 0;
export const ENTITY_DESTROY = 1;
export const ENTITY_BOUNCE = 2;

/** Part de la vitesse conservée après un rebond. */
const ENTITY_RESTITUTION = fx(0.6);
/** En dessous de cette vitesse verticale, une entité qui rebondit s'immobilise au sol. */
const ENTITY_REST_SPEED = fx(0.3);

/**
 * Crée une entité. `kind` est l'index dans `SimConfig.entities`, plus 1. `owner` est l'index du
 * joueur qui en est à l'origine et qu'elle ne peut pas frapper, ou -1.
 *
 * Renvoie l'emplacement utilisé, ou -1 si la réserve est pleine ou le type inconnu : l'appelant
 * n'a rien à faire dans ce cas, l'entité n'existe simplement pas.
 */
export function spawnEntity(
  sim: Sim,
  kind: number,
  owner: number,
  x: number,
  y: number,
  velX: number,
  velY: number,
): number {
  const def = sim.entityDefs[kind - 1];
  if (def === undefined) return -1;
  const s = sim.state;
  for (let e = 0; e < MAX_ENTITIES; e++) {
    if (s.eKind[e] !== 0) continue;
    s.eKind[e] = kind;
    s.eOwner[e] = owner + 1;
    s.ePosX[e] = x;
    s.ePosY[e] = y;
    s.eVelX[e] = velX;
    s.eVelY[e] = velY;
    s.eLife[e] = def.lifetime;
    s.eHitMask[e] = 0;
    return e;
  }
  return -1;
}

export function destroyEntity(sim: Sim, e: number): void {
  sim.state.eKind[e] = 0;
}

/** Déplace les entités d'une frame : gravité, durée de vie, décor, zones limites. */
export function updateEntities(sim: Sim): void {
  const s = sim.state;
  const geo = sim.geo;
  const blast = sim.config.stage.blast;

  for (let e = 0; e < MAX_ENTITIES; e++) {
    const kind = s.eKind[e]!;
    if (kind === 0) continue;
    const def = sim.entityDefs[kind - 1]!;

    const life = s.eLife[e]! - 1;
    if (life <= 0) {
      s.eKind[e] = 0;
      continue;
    }
    s.eLife[e] = life;

    const prevX = s.ePosX[e]!;
    const prevY = s.ePosY[e]!;
    let vx = s.eVelX[e]!;
    let vy = s.eVelY[e]! - def.gravity;
    let x = prevX + vx;
    let y = prevY + vy;
    const r = def.radius;

    if (x < blast.left || x > blast.right || y < blast.bottom || y > blast.top) {
      s.eKind[e] = 0;
      continue;
    }

    if (def.stageCollision !== ENTITY_PASS) {
      let destroyed = false;
      for (let k = 0; k < geo.solidCount; k++) {
        const top = geo.solidY2[k]!;
        if (
          x <= geo.solidX1[k]! - r ||
          x >= geo.solidX2[k]! + r ||
          y <= geo.solidY1[k]! - r ||
          y >= top + r
        ) {
          continue;
        }
        if (def.stageCollision === ENTITY_DESTROY) {
          destroyed = true;
          break;
        }
        if (prevY >= top + r) {
          // Arrivée par le dessus : rebond, ou repos si elle n'a plus assez d'élan.
          y = top + r;
          vy = fxMul(-vy, ENTITY_RESTITUTION);
          if (vy < ENTITY_REST_SPEED) vy = 0;
        } else {
          // Flanc ou dessous : elle repart d'où elle vient.
          x = prevX;
          vx = -fxMul(vx, ENTITY_RESTITUTION);
        }
      }
      if (destroyed) {
        s.eKind[e] = 0;
        continue;
      }
    }

    s.ePosX[e] = x;
    s.ePosY[e] = y;
    s.eVelX[e] = vx;
    s.eVelY[e] = vy;
  }
}
