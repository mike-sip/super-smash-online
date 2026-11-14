/**
 * Scénarios communs aux quatre personnages : chaque emplacement part sur son input et touche, le
 * contre, le projectile, l'attaque de rebord, l'ultime, le retour sur le stage.
 *
 * Le joueur 0 est le personnage testé, le joueur 1 le combattant de test de `sim-core`, qui sert de
 * cible. Pour vérifier qu'un coup touche, la cible est maintenue chaque frame à l'endroit de la
 * première hitbox du coup (position relative à l'attaquant), et l'on attend un `EV_HIT` du
 * joueur 0 pendant ce coup : on vérifie ainsi l'input, les frames actives et la forme, sans dépendre
 * de l'espacement exact.
 */
import {
  A_ATTACK,
  A_LEDGE,
  BTN_ATTACK,
  BTN_CSTICK_DOWN,
  BTN_CSTICK_RIGHT,
  BTN_CSTICK_UP,
  BTN_JUMP,
  BTN_SPECIAL,
  EV_COUNTER,
  EV_HIT,
  M_BAIR,
  M_DAIR,
  M_DASH_ATTACK,
  M_DSMASH,
  M_DSPECIAL,
  M_DTILT,
  M_FAIR,
  M_FSMASH,
  M_FTILT,
  M_JAB,
  M_JAB2,
  M_JAB3,
  M_LEDGE_ATTACK,
  M_NAIR,
  M_NSPECIAL,
  M_SSPECIAL,
  M_UAIR,
  M_ULTIMATE,
  M_USMASH,
  M_USPECIAL,
  M_UTILT,
  MAX_ENTITIES,
  createSim,
  encodeInput,
  fx,
  fxToFloat,
  setUltimateReady,
  step,
  type HitDef,
  type MoveDef,
  type Sim,
} from '@game/sim-core';
import { TEST_STAGE } from '@game/sim-core/testing';
import { expect, it } from 'vitest';
import type { Character } from '../../src/character.ts';
import { buildMatchConfig } from '../../src/match.ts';
import { SLOTS } from '../../src/slots.ts';
import { TEST_CHAR } from '../helpers.ts';

export const NEUTRAL = encodeInput(0, 0, 0);
export const stick = (x: number, y = 0, buttons = 0): number => encodeInput(x, y, buttons);
export const press = (buttons: number): number => encodeInput(0, 0, buttons);
const A = press(BTN_ATTACK);
const B = press(BTN_SPECIAL);

/** Hauteur du centre de la hurtbox de la cible, au-dessus de ses pieds. */
const TARGET_CENTER = 6;
/** Rebord droit du stage de test, et position de départ au sol et en l'air. */
const LEDGE_X = 60;
const GROUND_X = -20;
const AIR = { x: 0, y: 60 };

export function duel(c: Character): Sim {
  return createSim(buildMatchConfig({ stage: TEST_STAGE, players: [c, TEST_CHAR], seed: 1 }));
}

function frameInputs(sim: Sim, p0: number, p1 = NEUTRAL): void {
  const inputs = new Uint32Array(2);
  inputs[0] = p0;
  inputs[1] = p1;
  step(sim, inputs);
}

function placeGround(sim: Sim, i: number, x: number, facing: number): void {
  const s = sim.state;
  s.posX[i] = fx(x);
  s.facing[i] = facing;
}

function placeAir(sim: Sim, i: number, x: number, y: number): void {
  const s = sim.state;
  s.posX[i] = fx(x);
  s.posY[i] = fx(y);
  s.velX[i] = 0;
  s.velY[i] = 0;
  s.grounded[i] = 0;
  s.surface[i] = 0;
  s.action[i] = 8; // A_AIR
  s.actionFrame[i] = 0;
  s.jumpsLeft[i] = sim.config.fighters[i]!.airJumps;
}

/** Hitbox qui devient active la première. */
function firstHit(move: MoveDef): HitDef {
  return move.hits.reduce((a, h) => (h.start < a.start ? h : a));
}

/** Maintient la cible sur la première hitbox de `move`, par rapport à l'attaquant. */
function pinTarget(sim: Sim, move: MoveDef, air: boolean): void {
  const s = sim.state;
  const h = firstHit(move);
  const hx = (h.x1 + h.x2) / 2;
  const hy = (h.y1 + h.y2) / 2;
  s.posX[1] = s.posX[0]! + s.facing[0]! * Math.trunc(hx);
  s.posY[1] = air ? s.posY[0]! + Math.trunc(hy) - fx(TARGET_CENTER) : 0;
  s.velX[1] = 0;
  s.velY[1] = 0;
}

/** Maintient la cible sur le premier projectile du joueur 0, s'il y en a un. */
function pinOnProjectile(sim: Sim): void {
  const s = sim.state;
  for (let e = 0; e < MAX_ENTITIES; e++) {
    if (s.eKind[e] === 0 || s.eOwner[e] !== 1) continue;
    s.posX[1] = s.ePosX[e]!;
    s.posY[1] = Math.max(0, s.ePosY[e]! - fx(TARGET_CENTER));
    s.velX[1] = 0;
    s.velY[1] = 0;
    return;
  }
  // Pas encore de projectile : la cible attend à l'écart.
  s.posX[1] = fx(GROUND_X + 40);
}

interface Trigger {
  readonly air: boolean;
  /** Inputs du joueur 0, une frame chacun ; ensuite il reste au neutre. */
  readonly inputs: readonly number[];
}

/** Alterne appui et relâche : chaque appui est un nouvel input, comme un joueur qui martèle. */
const mash = (input: number, n: number): number[] =>
  Array.from({ length: n }, (_, k) => (k % 2 === 0 ? input : NEUTRAL));

const TRIGGERS: ReadonlyMap<number, Trigger> = new Map<number, Trigger>([
  [M_JAB, { air: false, inputs: [A] }],
  [M_JAB2, { air: false, inputs: mash(A, 30) }],
  [M_JAB3, { air: false, inputs: mash(A, 50) }],
  [M_FTILT, { air: false, inputs: [stick(70, 0, BTN_ATTACK)] }],
  [M_UTILT, { air: false, inputs: [stick(0, 70, BTN_ATTACK)] }],
  [M_DTILT, { air: false, inputs: [stick(0, -70, BTN_ATTACK)] }],
  [M_DASH_ATTACK, { air: false, inputs: [stick(127), stick(127), stick(127, 0, BTN_ATTACK)] }],
  [M_FSMASH, { air: false, inputs: [press(BTN_CSTICK_RIGHT)] }],
  [M_USMASH, { air: false, inputs: [press(BTN_CSTICK_UP)] }],
  [M_DSMASH, { air: false, inputs: [press(BTN_CSTICK_DOWN)] }],
  [M_NAIR, { air: true, inputs: [A] }],
  [M_FAIR, { air: true, inputs: [stick(70, 0, BTN_ATTACK)] }],
  [M_BAIR, { air: true, inputs: [stick(-70, 0, BTN_ATTACK)] }],
  [M_UAIR, { air: true, inputs: [stick(0, 70, BTN_ATTACK)] }],
  [M_DAIR, { air: true, inputs: [stick(0, -70, BTN_ATTACK)] }],
  [M_NSPECIAL, { air: false, inputs: [B] }],
  [M_SSPECIAL, { air: false, inputs: [stick(70, 0, BTN_SPECIAL)] }],
  [M_USPECIAL, { air: false, inputs: [stick(0, 70, BTN_SPECIAL)] }],
  [M_DSPECIAL, { air: false, inputs: [stick(0, -70, BTN_SPECIAL)] }],
  [M_ULTIMATE, { air: false, inputs: [B] }],
]);

/**
 * Lance l'emplacement `slot` par son input et renvoie vrai si le joueur 0 a porté un coup pendant
 * ce coup-là. Un coup sans hitbox (projectile seul) doit toucher par son projectile.
 */
export function slotConnects(c: Character, slot: number): { started: boolean; hit: boolean } {
  const trigger = TRIGGERS.get(slot)!;
  const move = c.def.moves[slot]!;
  const sim = duel(c);
  const s = sim.state;
  if (trigger.air) placeAir(sim, 0, AIR.x, AIR.y);
  else placeGround(sim, 0, GROUND_X, 1);
  if (slot === M_ULTIMATE) setUltimateReady(sim, 0, true);
  const projectile = move.hits.length === 0;

  let started = false;
  let hit = false;
  const frames = trigger.inputs.length + move.totalFrames + (projectile ? 60 : 0);
  for (let f = 0; f < frames && !hit; f++) {
    if (projectile) pinOnProjectile(sim);
    else pinTarget(sim, move, trigger.air);
    frameInputs(sim, trigger.inputs[f] ?? NEUTRAL);
    const inMove = s.action[0] === A_ATTACK && s.move[0] === slot;
    started ||= inMove;
    for (let e = 0; e < sim.events.count; e++) {
      if (sim.events.type[e] === EV_HIT && sim.events.a[e] === 0 && (inMove || projectile))
        hit = true;
    }
  }
  return { started, hit };
}

/** Contre déclenché par le jab de la cible, puis riposte qui touche. */
export function counterWorks(c: Character): {
  countered: boolean;
  unhurt: boolean;
  riposteHit: boolean;
} {
  const counter = c.def.moves[M_DSPECIAL]!.counter!;
  const sim = duel(c);
  const s = sim.state;
  placeGround(sim, 0, 0, 1);
  placeGround(sim, 1, 6, -1);
  frameInputs(sim, stick(0, -70, BTN_SPECIAL));
  // Jab de la cible actif à sa frame 3, donc à la frame `counter.start + 2` du contre.
  for (let f = 2; f < counter.start; f++) frameInputs(sim, NEUTRAL);
  frameInputs(sim, NEUTRAL, A);
  let countered = false;
  let riposteHit = false;
  for (let f = 0; f < 80; f++) {
    frameInputs(sim, NEUTRAL);
    for (let e = 0; e < sim.events.count; e++) {
      if (sim.events.type[e] === EV_COUNTER) countered = true;
      if (sim.events.type[e] === EV_HIT && sim.events.a[e] === 0 && s.move[0] === counter.to)
        riposteHit = true;
    }
  }
  return { countered, unhurt: s.damage[0] === 0, riposteHit };
}

/** Accroché au rebord droit, lance l'attaque de rebord : renvoie vrai si elle touche. */
export function ledgeAttackConnects(c: Character): boolean {
  const sim = duel(c);
  const s = sim.state;
  placeAir(sim, 0, LEDGE_X + 4, -c.def.height / 4096 + 2);
  for (let f = 0; f < 60 && s.action[0] !== A_LEDGE; f++) frameInputs(sim, NEUTRAL);
  expect(s.action[0], 'accroche au rebord').toBe(A_LEDGE);
  for (let f = 0; f < 10; f++) frameInputs(sim, NEUTRAL);
  const move = c.def.moves[M_LEDGE_ATTACK]!;
  frameInputs(sim, A);
  expect(s.move[0]).toBe(M_LEDGE_ATTACK);
  for (let f = 0; f < move.totalFrames; f++) {
    pinTarget(sim, move, false);
    frameInputs(sim, NEUTRAL);
    for (let e = 0; e < sim.events.count; e++) {
      if (sim.events.type[e] === EV_HIT && sim.events.a[e] === 0) return true;
    }
  }
  return false;
}

/**
 * Retour sur le stage depuis `out` unités au-delà du rebord droit et `below` sous son niveau : tous
 * les sauts aériens vers le stage, puis le spécial haut au sommet, stick vers le stage.
 * Renvoie l'issue : accroché, posé sur le stage, ou tombé.
 */
export function recover(c: Character, out: number, below: number): 'ledge' | 'stage' | 'fell' {
  const sim = duel(c);
  const s = sim.state;
  placeAir(sim, 0, LEDGE_X + out, -below);
  s.facing[0] = -1;
  const toward = stick(-127);
  let usedSpecial = false;
  let lastJump = -10;
  for (let f = 0; f < 400; f++) {
    let input = toward;
    if (s.action[0] === A_LEDGE) return 'ledge';
    if (s.grounded[0] === 1) return fxToFloat(s.posX[0]!) <= LEDGE_X ? 'stage' : 'fell';
    if (s.posY[0]! < fx(-70)) return 'fell';
    const falling = s.velY[0]! <= 0;
    if (s.jumpsLeft[0]! > 0 && (f === 0 || (falling && f - lastJump > 2))) {
      input = stick(-127, 0, BTN_JUMP);
      lastJump = f;
    } else if (!usedSpecial && s.jumpsLeft[0] === 0 && falling && f - lastJump > 2) {
      input = stick(-50, 127, BTN_SPECIAL);
      usedSpecial = true;
    }
    frameInputs(sim, input);
  }
  return 'fell';
}

/** Déclare les scénarios communs pour un personnage. */
export function commonScenarios(c: Character): void {
  for (const slot of TRIGGERS.keys()) {
    const move = c.def.moves[slot];
    // Un contre ne frappe pas de lui-même : il a son propre scénario.
    if (move === undefined || move.counter !== undefined) continue;
    it(`${SLOTS[slot]!.label} « ${move.name} » part sur son input et touche`, () => {
      const result = slotConnects(c, slot);
      expect(result.started, 'le coup part').toBe(true);
      expect(result.hit, 'le coup touche').toBe(true);
    });
  }

  if (c.def.moves[M_DSPECIAL]?.counter !== undefined) {
    it('contre : annule le coup reçu, puis la riposte touche', () => {
      expect(counterWorks(c)).toEqual({ countered: true, unhurt: true, riposteHit: true });
    });
  }

  it('attaque de rebord : part depuis le rebord et touche', () => {
    expect(ledgeAttackConnects(c)).toBe(true);
  });

  it('revient au rebord depuis 50 unités au-delà et 30 sous son niveau', () => {
    expect(recover(c, 50, 30)).not.toBe('fell');
  });
}
