/**
 * Objets (module stages-items) : apparition, physique, ramassage, lancer, coup, soin, explosion.
 *
 * Un objet est une entité dont le type porte un `ItemDef`. Il vit dans la même réserve que les
 * projectiles, mais c'est ce système, et non `updateEntities`, qui le déplace. Son état tient dans
 * les champs d'entité (`eMode`, `eSurface`, `eOwner` pour son porteur ou son lanceur) et dans le
 * champ `held` du porteur. Le tirage des apparitions utilise le générateur de l'état (`G_RNG`) :
 * un rollback rejoue les mêmes objets aux mêmes endroits.
 *
 * Mêmes règles que le reste du moteur : aucune allocation, aucune fonction flottante, joueurs et
 * emplacements toujours parcourus par index croissant.
 */
import { A_DEAD, A_ITEM_SWING, A_ITEM_THROW, setAction } from '../actions.ts';
import type { EntityDef, MoveDef } from '../defs.ts';
import {
  EV_HEAL,
  EV_ITEM_BREAK,
  EV_ITEM_PICKUP,
  EV_ITEM_SPAWN,
  EV_ITEM_THROW,
  emit,
} from '../events.ts';
import { FX_ONE, fx, fxMul } from '../fixed.ts';
import { inputStickX, inputStickY } from '../input.ts';
import { rngRange } from '../rng.ts';
import { G_ITEM_TIMER, G_PLAYERS, MAX_ENTITIES, type SimState } from '../state.ts';
import type { Sim } from '../step.ts';
import { C_DOWN, C_LEFT, C_RIGHT, C_UP } from './buffer.ts';
import { spawnEntity } from './entities.ts';
import { overlapsHurtboxes } from './hit.ts';
import { approach } from './util.ts';

/** Valeurs de `eMode` pour un objet. 0 désigne un projectile ordinaire. */
export const ITEM_MODE_FREE = 1;
export const ITEM_MODE_HELD = 2;
export const ITEM_MODE_THROWN = 3;

/** Lancer : durée totale de l'action, et frame où l'objet quitte la main. */
export const ITEM_THROW_FRAMES = 16;
export const ITEM_THROW_RELEASE = 5;

/** Direction d'un lancer, rangée dans `move` pendant `A_ITEM_THROW`. */
export const THROW_FORWARD = 0;
export const THROW_BACK = 1;
export const THROW_UP = 2;
export const THROW_DOWN = 3;

/** Portée du ramassage, au-delà du corps et de l'objet. */
const PICKUP_MARGIN = fx(3);
/** Inclinaison du stick qui oriente un lancer. */
const STICK_AIM = 40;
const ITEM_FRICTION = fx(0.1);
const ITEM_MAX_FALL = fx(2.2);
/** Part de la vitesse conservée contre un flanc de bloc plein, ou après avoir touché quelqu'un. */
const ITEM_RESTITUTION = fx(0.4);
const ITEM_HIT_RESTITUTION = fx(0.3);
/** Petit saut de l'objet qui rebondit sur un combattant. */
const ITEM_BOUNCE_UP = fx(1.2);

const itemDef = (sim: Sim, kind: number): EntityDef | undefined => sim.entityDefs[kind - 1];

function drawInterval(s: SimState, min: number, max: number): number {
  return min + rngRange(s, max - min + 1);
}

/** À la création : premier délai avant une apparition. */
export function initItems(sim: Sim): void {
  const items = sim.config.items;
  if (items === undefined) return;
  sim.state.g[G_ITEM_TIMER] = drawInterval(sim.state, items.minInterval, items.maxInterval);
}

/** Décompte, et apparition d'un objet tiré au sort quand le délai est écoulé. */
export function updateItemSpawner(sim: Sim): void {
  const items = sim.config.items;
  if (items === undefined) return;
  const s = sim.state;
  const left = s.g[G_ITEM_TIMER]! - 1;
  if (left > 0) {
    s.g[G_ITEM_TIMER] = left;
    return;
  }
  s.g[G_ITEM_TIMER] = drawInterval(s, items.minInterval, items.maxInterval);

  const zones = sim.config.stage.itemSpawns;
  const table = items.table;
  if (zones === undefined || zones.length === 0 || table.length === 0) return;
  let active = 0;
  for (let e = 0; e < MAX_ENTITIES; e++) {
    const kind = s.eKind[e]!;
    if (kind !== 0 && itemDef(sim, kind)?.item !== undefined) active++;
  }
  if (active >= items.maxActive) return;

  let total = 0;
  for (let t = 0; t < table.length; t++) total += table[t]!.weight;
  let pick = rngRange(s, total);
  let kind = table[table.length - 1]!.kind;
  for (let t = 0; t < table.length; t++) {
    pick -= table[t]!.weight;
    if (pick < 0) {
      kind = table[t]!.kind;
      break;
    }
  }
  const zone = zones[rngRange(s, zones.length)]!;
  const x = zone.x1 + rngRange(s, zone.x2 - zone.x1 + 1);
  const e = spawnEntity(sim, kind, -1, x, zone.y, 0, 0);
  if (e >= 0) emit(sim.events, EV_ITEM_SPAWN, e, kind);
}

/** Position de l'objet tenu : devant le combattant, à mi-hauteur. */
function holdAt(sim: Sim, i: number, e: number): void {
  const s = sim.state;
  const def = sim.config.fighters[i]!;
  const r = itemDef(sim, s.eKind[e]!)!.radius;
  s.ePosX[e] = s.posX[i]! + s.facing[i]! * (def.halfWidth + r);
  s.ePosY[e] = s.posY[i]! + (def.height >> 1);
}

/** Brise ou fait exploser l'objet `e` là où il est. */
function breakItem(sim: Sim, e: number): void {
  const s = sim.state;
  const kind = s.eKind[e]!;
  const burst = itemDef(sim, kind)!.item!.burst;
  const x = s.ePosX[e]!;
  const y = s.ePosY[e]!;
  s.eKind[e] = 0;
  s.eMode[e] = 0;
  if (burst !== undefined) spawnEntity(sim, burst, -1, x, y, 0, 0);
  emit(sim.events, EV_ITEM_BREAK, e, kind);
}

/** L'objet devient libre, sans élan, là où il est. */
function release(s: SimState, e: number): void {
  s.eMode[e] = ITEM_MODE_FREE;
  s.eSurface[e] = 0;
  s.eVelX[e] = 0;
  s.eVelY[e] = 0;
}

/** Le combattant lâche son objet (accroche au rebord). */
export function dropHeld(sim: Sim, i: number): void {
  const s = sim.state;
  const e = s.held[i]! - 1;
  if (e < 0) return;
  s.held[i] = 0;
  release(s, e);
}

/** Le combattant perd son objet, qui disparaît (KO). */
export function destroyHeld(sim: Sim, i: number): void {
  const s = sim.state;
  const e = s.held[i]! - 1;
  if (e < 0) return;
  s.held[i] = 0;
  s.eKind[e] = 0;
  s.eMode[e] = 0;
}

/** Coup de l'objet à frapper que tient le combattant, ou undefined. */
export function heldSwing(sim: Sim, i: number): MoveDef | undefined {
  const e = sim.state.held[i]! - 1;
  if (e < 0) return undefined;
  return itemDef(sim, sim.state.eKind[e]!)?.item?.swing;
}

/** Appelé par `resolveHits` quand un objet lancé touche un combattant. */
export function itemHitFighter(sim: Sim, e: number): void {
  const s = sim.state;
  const item = itemDef(sim, s.eKind[e]!)!.item!;
  if (item.breakOnHit || item.breakOnContact) {
    breakItem(sim, e);
    return;
  }
  s.eMode[e] = ITEM_MODE_FREE;
  s.eSurface[e] = 0;
  s.eVelX[e] = -fxMul(s.eVelX[e]!, ITEM_HIT_RESTITUTION);
  s.eVelY[e] = ITEM_BOUNCE_UP;
}

/** Objet libre à portée de ramassage du combattant `i` (le plus proche), ou -1. */
function itemInReach(sim: Sim, i: number): number {
  const s = sim.state;
  const def = sim.config.fighters[i]!;
  const x = s.posX[i]!;
  const feet = s.posY[i]!;
  let best = -1;
  let bestDist = 0;
  for (let e = 0; e < MAX_ENTITIES; e++) {
    const kind = s.eKind[e]!;
    if (kind === 0 || s.eMode[e] !== ITEM_MODE_FREE) continue;
    const edef = itemDef(sim, kind)!;
    if (edef.item!.heal !== undefined) continue;
    const r = edef.radius;
    const dx = s.ePosX[e]! - x;
    const dist = dx < 0 ? -dx : dx;
    if (dist > def.halfWidth + r + PICKUP_MARGIN) continue;
    const ey = s.ePosY[e]!;
    if (ey - r > feet + (def.height >> 1) || ey + r < feet - FX_ONE) continue;
    if (best < 0 || dist < bestDist) {
      best = e;
      bestDist = dist;
    }
  }
  return best;
}

function startThrow(s: SimState, i: number, dir: number): void {
  if (dir === THROW_BACK) s.facing[i] = -s.facing[i]!;
  s.move[i] = dir;
  setAction(s, i, A_ITEM_THROW);
}

function startSwing(s: SimState, i: number): void {
  s.move[i] = 0;
  s.charge[i] = 0;
  s.hitMask[i] = 0;
  s.connected[i] = 0;
  setAction(s, i, A_ITEM_SWING);
}

/** Direction de lancer désignée par le stick gauche. */
function aimFromStick(s: SimState, i: number): number {
  const input = s.input[i]!;
  const x = inputStickX(input);
  const y = inputStickY(input);
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  if (ay > ax && ay >= STICK_AIM) return y > 0 ? THROW_UP : THROW_DOWN;
  if (ax >= STICK_AIM && (x > 0 ? 1 : -1) !== s.facing[i]) return THROW_BACK;
  return THROW_FORWARD;
}

/** Direction de lancer désignée par le stick droit. */
function aimFromC(s: SimState, i: number, cDir: number): number {
  if (cDir === C_UP) return THROW_UP;
  if (cDir === C_DOWN) return THROW_DOWN;
  const dir = cDir === C_LEFT ? -1 : cDir === C_RIGHT ? 1 : s.facing[i]!;
  return dir === s.facing[i] ? THROW_FORWARD : THROW_BACK;
}

/**
 * Décisions liées aux objets, avant le choix d'une attaque : ramasser (au sol seulement), lancer,
 * frapper. Renvoie vrai si l'input a servi ; l'appelant ne lance alors pas d'attaque.
 */
export function tryItemAction(sim: Sim, i: number, grounded: boolean): boolean {
  const s = sim.state;
  const e = s.held[i]! - 1;
  if (e < 0) {
    if (!grounded || s.bufAttack[i]! <= 0) return false;
    const found = itemInReach(sim, i);
    if (found < 0) return false;
    s.bufAttack[i] = 0;
    s.held[i] = found + 1;
    s.eMode[found] = ITEM_MODE_HELD;
    s.eOwner[found] = i + 1;
    s.eSurface[found] = 0;
    s.eVelX[found] = 0;
    s.eVelY[found] = 0;
    holdAt(sim, i, found);
    emit(sim.events, EV_ITEM_PICKUP, i, found);
    return true;
  }

  if (s.bufGrab[i]! > 0) {
    s.bufGrab[i] = 0;
    startThrow(s, i, aimFromStick(s, i));
    return true;
  }
  const c = s.bufC[i]!;
  if (s.bufAttack[i]! <= 0 && c === 0) return false;
  const swing = itemDef(sim, s.eKind[e]!)!.item!.swing;
  let dir: number;
  if (c !== 0) {
    s.bufC[i] = 0;
    dir = aimFromC(s, i, c >> 8);
  } else {
    s.bufAttack[i] = 0;
    dir = aimFromStick(s, i);
  }
  if (swing !== undefined) startSwing(s, i);
  else startThrow(s, i, dir);
  return true;
}

/** Frame `ITEM_THROW_RELEASE` du lancer : l'objet part. */
export function releaseThrow(sim: Sim, i: number): void {
  const s = sim.state;
  const e = s.held[i]! - 1;
  if (e < 0) return;
  const edef = itemDef(sim, s.eKind[e]!)!;
  const speed = edef.item!.throwSpeed;
  holdAt(sim, i, e);
  s.held[i] = 0;
  s.eOwner[e] = i + 1;
  s.eSurface[e] = 0;
  s.eMode[e] = ITEM_MODE_THROWN;
  const dir = s.move[i]!;
  if (dir === THROW_UP) {
    s.eVelX[e] = 0;
    s.eVelY[e] = speed;
  } else if (dir === THROW_DOWN) {
    s.eVelX[e] = 0;
    if (s.grounded[i] === 1) {
      // Au sol, vers le bas : l'objet est posé devant les pieds.
      s.eMode[e] = ITEM_MODE_FREE;
      s.eVelY[e] = 0;
      s.ePosY[e] = s.posY[i]! + edef.radius;
      s.eSurface[e] = s.surface[i]!;
    } else {
      s.eVelY[e] = -speed;
    }
  } else {
    // Avant, ou arrière : le combattant s'est déjà retourné au début du lancer.
    s.eVelX[e] = s.facing[i]! * speed;
    s.eVelY[e] = speed >> 2;
  }
  emit(sim.events, EV_ITEM_THROW, i, e);
}

/** Durée de l'action d'objet en cours du combattant `i`. */
export function itemActionFrames(sim: Sim, i: number): number {
  if (sim.state.action[i] === A_ITEM_THROW) return ITEM_THROW_FRAMES;
  return heldSwing(sim, i)?.totalFrames ?? 0;
}

/** Fait avancer un objet libre ou lancé d'une frame. Renvoie faux s'il a disparu. */
function moveItem(sim: Sim, e: number, def: EntityDef): boolean {
  const s = sim.state;
  const geo = sim.geo;
  const blast = sim.config.stage.blast;
  const r = def.radius;
  const thrown = s.eMode[e] === ITEM_MODE_THROWN;
  const fragile = thrown && def.item!.breakOnContact;
  const prevX = s.ePosX[e]!;
  const prevY = s.ePosY[e]!;
  let vx = s.eVelX[e]!;
  let vy = s.eVelY[e]!;
  let x: number;
  let y: number;

  const rest = s.eSurface[e]! - 1;
  if (rest >= 0) {
    // Posé : la surface l'emporte si elle bouge, le frottement le freine.
    vx = approach(vx, 0, ITEM_FRICTION);
    x = prevX + sim.motion.surfDX[rest]! + vx;
    y = geo.surfY[rest]! + r;
    vy = 0;
    if (x < geo.surfX1[rest]! || x > geo.surfX2[rest]!) s.eSurface[e] = 0;
  } else {
    vy -= def.gravity;
    if (vy < -ITEM_MAX_FALL) vy = -ITEM_MAX_FALL;
    x = prevX + vx;
    y = prevY + vy;
    if (x < blast.left || x > blast.right || y < blast.bottom || y > blast.top) {
      s.eKind[e] = 0;
      s.eMode[e] = 0;
      return false;
    }

    // Atterrissage : le dessous de l'objet franchit une surface de haut en bas ; la plus haute.
    let landed = -1;
    if (vy <= 0) {
      for (let k = 0; k < geo.surfCount; k++) {
        const top = geo.surfY[k]!;
        if (prevY - r < geo.surfPrevY[k]! || y - r > top) continue;
        if (x < geo.surfX1[k]! || x > geo.surfX2[k]!) continue;
        if (landed < 0 || top > geo.surfY[landed]!) landed = k;
      }
    }
    if (landed >= 0) {
      y = geo.surfY[landed]! + r;
      if (fragile) {
        s.ePosX[e] = x;
        s.ePosY[e] = y;
        breakItem(sim, e);
        return false;
      }
      vy = 0;
      vx = (vx / 2) | 0;
      s.eSurface[e] = landed + 1;
      s.eMode[e] = ITEM_MODE_FREE;
    } else {
      // Flanc ou dessous d'un bloc plein : il repart d'où il vient.
      for (let k = 0; k < geo.solidCount; k++) {
        if (
          x <= geo.solidX1[k]! - r ||
          x >= geo.solidX2[k]! + r ||
          y <= geo.solidY1[k]! - r ||
          y >= geo.solidY2[k]! + r
        ) {
          continue;
        }
        if (fragile) {
          breakItem(sim, e);
          return false;
        }
        x = prevX;
        vx = -fxMul(vx, ITEM_RESTITUTION);
        if (vy > 0) vy = 0;
        y = prevY;
        if (thrown) s.eMode[e] = ITEM_MODE_FREE;
      }
    }
  }
  s.ePosX[e] = x;
  s.ePosY[e] = y;
  s.eVelX[e] = vx;
  s.eVelY[e] = vy;
  return true;
}

/**
 * Une frame d'objets, après le déplacement des combattants : objets tenus replacés, objets libres
 * et lancés déplacés, soins au contact, objets fragiles brisés sur un combattant.
 */
export function updateItems(sim: Sim): void {
  const s = sim.state;
  const players = s.g[G_PLAYERS]!;
  const fighters = sim.config.fighters;

  for (let e = 0; e < MAX_ENTITIES; e++) {
    const kind = s.eKind[e]!;
    if (kind === 0) continue;
    const def = itemDef(sim, kind)!;
    const item = def.item;
    if (item === undefined) continue;

    if (s.eMode[e] === ITEM_MODE_HELD) {
      const holder = s.eOwner[e]! - 1;
      // Porteur réapparu ou disparu sans le lâcher : l'objet tombe là où il était.
      if (holder < 0 || s.held[holder] !== e + 1) release(s, e);
      else {
        holdAt(sim, holder, e);
        continue;
      }
    }

    const life = s.eLife[e]! - 1;
    if (life <= 0) {
      if (item.burst !== undefined) breakItem(sim, e);
      else {
        s.eKind[e] = 0;
        s.eMode[e] = 0;
      }
      continue;
    }
    s.eLife[e] = life;
    if (!moveItem(sim, e, def)) continue;

    const ex = s.ePosX[e]!;
    const ey = s.ePosY[e]!;
    const healing = item.heal !== undefined && s.eMode[e] === ITEM_MODE_FREE;
    const fragile = item.breakOnContact && s.eMode[e] === ITEM_MODE_THROWN;
    if (!healing && !fragile) continue;
    const owner = s.eOwner[e]! - 1;
    for (let j = 0; j < players; j++) {
      if (s.action[j] === A_DEAD) continue;
      if (fragile && (j === owner || s.intangible[j]! > 0)) continue;
      if (!overlapsHurtboxes(s, j, fighters[j]!, ex, ey, ex, ey, def.radius)) continue;
      if (healing) {
        const heal = item.heal!;
        const damage = s.damage[j]! - heal;
        s.damage[j] = damage > 0 ? damage : 0;
        s.eKind[e] = 0;
        s.eMode[e] = 0;
        emit(sim.events, EV_HEAL, j, ((heal + (FX_ONE >> 1)) / FX_ONE) | 0);
      } else {
        breakItem(sim, e);
      }
      break;
    }
  }
}
