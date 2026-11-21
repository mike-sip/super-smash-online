/**
 * Le crochet de règles : appelé par `sim-core` à la fin de chaque `step`, il tient les vies,
 * le chronomètre, les réapparitions, l'attribution des KO, la jauge d'ultime et la fin du match.
 *
 * Contraintes de `step` (SPEC-sim-core.md) : aucune allocation, entiers uniquement, joueurs
 * traités par index croissant. Tout l'état vit dans `rulesState(sim)` (voir layout.ts) ; l'objet
 * créé ici ne contient que des constantes tirées de la configuration et des tableaux de travail
 * entièrement recalculés à chaque frame.
 */
import {
  A_DEAD,
  EV_HIT,
  EV_ULTIMATE,
  FX_ONE,
  MAX_PLAYERS,
  createFighterView,
  events,
  frame,
  fx,
  knockOut,
  readFighter,
  respawn,
  rulesState,
  setDamage,
  setUltimateReady,
  type Sim,
  type SimRules,
} from '@game/sim-core';
import type { MatchConfig } from './config.ts';
import {
  P_ALIVE,
  P_DEALT,
  P_ELIM_AT,
  P_FALLS,
  P_IN_ROUND,
  P_KOS,
  P_LAST_HIT_FRAME,
  P_LAST_HITTER,
  P_METER,
  P_OUT,
  P_PLACE,
  P_PREV_DAMAGE,
  P_RESPAWN,
  P_SDS,
  P_STOCKS,
  P_TAKEN,
  P_ULTIMATES,
  PHASE_OVER,
  PHASE_PLAYING,
  PHASE_SUDDEN_DEATH,
  REASON_LAST_STANDING,
  REASON_SUDDEN_DEATH,
  REASON_TIME,
  W_END_FRAME,
  W_FRAMES_LEFT,
  W_PHASE,
  W_REASON,
  W_SUDDEN_ROUNDS,
  at,
} from './layout.ts';
import { rankUnits, splitShare } from './outcome.ts';

/** Frames entre un KO et la réapparition (1,5 s). */
export const RESPAWN_DELAY = 90;
/** Frames d'invincibilité à la réapparition (2 s). */
export const RESPAWN_INVINCIBILITY = 120;
/** Un KO est crédité au dernier attaquant s'il a touché la victime dans ce délai (8 s). */
export const KO_CREDIT_WINDOW = 480;
/** Dégâts de départ en mort subite, en pourcentage (1 point de vie en Endurance). */
export const SUDDEN_DEATH_DAMAGE = 300;
/** Jauge d'ultime pleine : 100 points, en virgule fixe (1 point par % infligé). */
export const METER_FULL = fx(100);
export const FRAMES_PER_SECOND = 60;

export const MODE_STOCK = 0;
export const MODE_TIME = 1;
export const MODE_STAMINA = 2;

export interface MatchRules extends SimRules {
  readonly match: MatchConfig;
  readonly mode: number;
  readonly players: number;
  /** Unité de classement de chaque joueur : son équipe, ou lui-même sans équipes. */
  readonly unit: Int32Array;
  /** Points de vie maximaux en virgule fixe (Endurance). */
  readonly staminaFx: number;
}

/** Objets de règles créés par ce module : seuls ceux-là sont lus par `readMatch`. */
const created = new WeakSet<object>();

/** Règles de match de la simulation, ou erreur si elle n'en a pas. */
export function rulesOf(sim: Sim): MatchRules {
  const rules = sim.config.rules;
  if (rules === undefined || !created.has(rules)) {
    throw new Error("Cette simulation n'a pas de règles de match (createMatchSimConfig).");
  }
  return rules as MatchRules;
}

/** Vrai si les vies sont comptées : hors mode Temps, ou dès la première mort subite. */
export function stocksCounted(rules: MatchRules, r: Int32Array): boolean {
  return rules.mode !== MODE_TIME || r[W_SUDDEN_ROUNDS]! > 0;
}

export function createMatchRules(match: MatchConfig): MatchRules {
  const players = match.players.length;
  const mode =
    match.mode === 'stock' ? MODE_STOCK : match.mode === 'time' ? MODE_TIME : MODE_STAMINA;
  const unit = new Int32Array(MAX_PLAYERS);
  for (let i = 0; i < MAX_PLAYERS; i++)
    unit[i] = match.teams && i < players ? match.players[i]!.team : i;
  const staminaFx = fx(match.stamina);
  const ultimate = match.ultimate;

  // Tableaux de travail, recalculés à chaque frame : hors de l'état sauvegardé.
  const view = createFighterView();
  const hitMask = new Int32Array(MAX_PLAYERS);
  const koNow = new Int32Array(MAX_PLAYERS);
  const keyA = new Int32Array(MAX_PLAYERS);
  const keyB = new Int32Array(MAX_PLAYERS);
  const unitIn = new Int32Array(MAX_PLAYERS);
  const unitRank = new Int32Array(MAX_PLAYERS);

  function addMeter(r: Int32Array, p: number, amount: number): void {
    if (!ultimate) return;
    const m = r[at(p, P_METER)]! + amount;
    r[at(p, P_METER)] = m > METER_FULL ? METER_FULL : m;
  }

  function handleKo(r: Int32Array, j: number, now: number, phase: number): void {
    r[at(j, P_ALIVE)] = 0;
    r[at(j, P_FALLS)] = r[at(j, P_FALLS)]! + 1;
    const a = r[at(j, P_LAST_HITTER)]!;
    const recent = a >= 0 && now - r[at(j, P_LAST_HIT_FRAME)]! <= KO_CREDIT_WINDOW;
    if (!recent) r[at(j, P_SDS)] = r[at(j, P_SDS)]! + 1;
    else if (unit[a] !== unit[j]) r[at(a, P_KOS)] = r[at(a, P_KOS)]! + 1;
    // Un KO par un coéquipier n'est ni crédité ni une autodestruction.
    r[at(j, P_LAST_HITTER)] = -1;

    if (mode !== MODE_TIME || phase === PHASE_SUDDEN_DEATH) {
      const stocks = r[at(j, P_STOCKS)]! - 1;
      r[at(j, P_STOCKS)] = stocks < 0 ? 0 : stocks;
      if (stocks <= 0) {
        r[at(j, P_OUT)] = 1;
        r[at(j, P_ELIM_AT)] = now;
        r[at(j, P_RESPAWN)] = 0;
        return;
      }
    }
    r[at(j, P_RESPAWN)] = RESPAWN_DELAY;
  }

  /** Nombre d'unités ayant encore un joueur en jeu dans le tour. */
  function unitsStanding(r: Int32Array): number {
    for (let u = 0; u < MAX_PLAYERS; u++) unitIn[u] = 0;
    for (let p = 0; p < players; p++) {
      if (r[at(p, P_IN_ROUND)] === 1 && r[at(p, P_OUT)] === 0) unitIn[unit[p]!] = 1;
    }
    let n = 0;
    for (let u = 0; u < MAX_PLAYERS; u++) n += unitIn[u]!;
    return n;
  }

  /** Classe les unités du tour ; un seul premier termine le match, sinon mort subite. */
  function resolveRound(sim: Sim, r: Int32Array, reason: number, now: number, phase: number): void {
    for (let u = 0; u < MAX_PLAYERS; u++) {
      unitIn[u] = 0;
      keyA[u] = 0;
      keyB[u] = -0x7fffffff;
    }
    const byScore = reason === REASON_TIME && mode === MODE_TIME;
    // Clés : élimination la plus tardive pour une unité éliminée ; pour une unité en jeu,
    // 1 (dernier debout), ou vies puis moins de dégâts (fin du temps en Stock et Endurance).
    for (let p = 0; p < players; p++) {
      if (r[at(p, P_IN_ROUND)] === 0) continue;
      const u = unit[p]!;
      unitIn[u] = 1;
      if (byScore) {
        keyA[u] = keyA[u]! + r[at(p, P_KOS)]! - r[at(p, P_FALLS)]!;
        keyB[u] = 0;
      }
    }
    if (!byScore) {
      for (let u = 0; u < MAX_PLAYERS; u++) {
        if (unitIn[u] === 0) continue;
        let standing = false;
        let stocks = 0;
        let damage = 0;
        let lastOut = -1;
        for (let p = 0; p < players; p++) {
          if (unit[p] !== u || r[at(p, P_IN_ROUND)] === 0) continue;
          if (r[at(p, P_OUT)] === 1) {
            const e = r[at(p, P_ELIM_AT)]!;
            if (e > lastOut) lastOut = e;
            continue;
          }
          standing = true;
          stocks += r[at(p, P_STOCKS)]!;
          // Un joueur en attente de réapparition repartira à 0 %.
          if (r[at(p, P_ALIVE)] === 1) damage += r[at(p, P_PREV_DAMAGE)]!;
        }
        if (!standing) {
          keyA[u] = 0;
          keyB[u] = lastOut;
        } else if (reason === REASON_TIME) {
          keyA[u] = 1 + stocks;
          keyB[u] = -damage;
        } else {
          keyA[u] = 1;
          keyB[u] = 0;
        }
      }
    }
    rankUnits(keyA, keyB, unitIn, MAX_PLAYERS, unitRank);
    let top = 0;
    for (let u = 0; u < MAX_PLAYERS; u++) if (unitIn[u] === 1 && unitRank[u] === 1) top++;

    if (top <= 1) {
      for (let p = 0; p < players; p++) {
        if (r[at(p, P_IN_ROUND)] === 1) r[at(p, P_PLACE)] = unitRank[unit[p]!]!;
      }
      r[W_PHASE] = PHASE_OVER;
      r[W_END_FRAME] = now;
      r[W_REASON] = phase === PHASE_SUDDEN_DEATH ? REASON_SUDDEN_DEATH : reason;
      return;
    }

    // Mort subite entre les ex æquo ; les autres gardent leur place, déjà définitive.
    const suddenDamage = mode === MODE_STAMINA ? staminaFx - FX_ONE : fx(SUDDEN_DEATH_DAMAGE);
    for (let p = 0; p < players; p++) {
      if (r[at(p, P_IN_ROUND)] === 0) continue;
      if (unitRank[unit[p]!] !== 1) {
        r[at(p, P_PLACE)] = unitRank[unit[p]!]!;
        r[at(p, P_IN_ROUND)] = 0;
        if (r[at(p, P_OUT)] === 0) r[at(p, P_ELIM_AT)] = now;
        r[at(p, P_OUT)] = 1;
        r[at(p, P_ALIVE)] = 0;
        r[at(p, P_RESPAWN)] = 0;
        knockOut(sim, p);
        continue;
      }
      r[at(p, P_OUT)] = 0;
      r[at(p, P_STOCKS)] = 1;
      r[at(p, P_ALIVE)] = 1;
      r[at(p, P_RESPAWN)] = 0;
      r[at(p, P_LAST_HITTER)] = -1;
      r[at(p, P_ELIM_AT)] = -1;
      respawn(sim, p);
      setDamage(sim, p, suddenDamage);
      r[at(p, P_PREV_DAMAGE)] = suddenDamage;
    }
    r[W_PHASE] = PHASE_SUDDEN_DEATH;
    r[W_FRAMES_LEFT] = -1;
    r[W_SUDDEN_ROUNDS] = r[W_SUDDEN_ROUNDS]! + 1;
  }

  const rules: MatchRules = {
    match,
    mode,
    players,
    unit,
    staminaFx,

    init(sim) {
      const r = rulesState(sim);
      r[W_PHASE] = PHASE_PLAYING;
      r[W_FRAMES_LEFT] = match.timeLimit > 0 ? match.timeLimit * FRAMES_PER_SECOND : -1;
      r[W_END_FRAME] = -1;
      for (let p = 0; p < players; p++) {
        r[at(p, P_STOCKS)] = mode === MODE_TIME ? 0 : match.stocks;
        r[at(p, P_ALIVE)] = 1;
        r[at(p, P_IN_ROUND)] = 1;
        r[at(p, P_LAST_HITTER)] = -1;
        r[at(p, P_ELIM_AT)] = -1;
      }
    },

    afterStep(sim) {
      const r = rulesState(sim);
      const phase = r[W_PHASE]!;
      if (phase !== PHASE_PLAYING && phase !== PHASE_SUDDEN_DEATH) return;
      const now = frame(sim);
      const ev = events(sim);

      // 1. Coups portés (dernier attaquant, attaquants de la frame) et ultimes lancées.
      for (let p = 0; p < players; p++) {
        hitMask[p] = 0;
        koNow[p] = 0;
      }
      for (let e = 0; e < ev.count; e++) {
        const type = ev.type[e]!;
        const a = ev.a[e]!;
        if (type === EV_HIT) {
          const b = ev.b[e]!;
          if (a < 0 || a >= players || a === b) continue;
          r[at(b, P_LAST_HITTER)] = a;
          r[at(b, P_LAST_HIT_FRAME)] = now;
          if (unit[a] !== unit[b]) hitMask[b] = hitMask[b]! | (1 << a);
        } else if (type === EV_ULTIMATE && a >= 0 && a < players) {
          r[at(a, P_METER)] = 0;
          r[at(a, P_ULTIMATES)] = r[at(a, P_ULTIMATES)]! + 1;
        }
      }

      // 2. Dégâts de la frame, KO par points de vie, KO constatés.
      for (let j = 0; j < players; j++) {
        if (r[at(j, P_OUT)] === 1) continue;
        readFighter(sim, j, view);
        const damage = Math.round(view.damage * FX_ONE);
        const delta = damage - r[at(j, P_PREV_DAMAGE)]!;
        r[at(j, P_PREV_DAMAGE)] = damage;
        if (delta > 0) {
          r[at(j, P_TAKEN)] = r[at(j, P_TAKEN)]! + delta;
          addMeter(r, j, delta >> 1);
          const mask = hitMask[j]!;
          if (mask !== 0) {
            for (let a = 0; a < players; a++) {
              const share = splitShare(delta, mask, a);
              if (share === 0) continue;
              r[at(a, P_DEALT)] = r[at(a, P_DEALT)]! + share;
              addMeter(r, a, share);
            }
          }
        }
        if (r[at(j, P_ALIVE)] === 0) continue;
        let dead = view.action === A_DEAD;
        if (!dead && mode === MODE_STAMINA && damage >= staminaFx) {
          knockOut(sim, j);
          dead = true;
        }
        if (dead) {
          koNow[j] = 1;
          handleKo(r, j, now, phase);
        }
      }

      // 3. Réapparitions (pas pour un KO de cette frame : son délai commence à la suivante).
      for (let j = 0; j < players; j++) {
        if (koNow[j] === 1) continue;
        const wait = r[at(j, P_RESPAWN)]!;
        if (wait === 0) continue;
        r[at(j, P_RESPAWN)] = wait - 1;
        if (wait > 1 || r[at(j, P_OUT)] === 1) continue;
        respawn(sim, j, RESPAWN_INVINCIBILITY);
        r[at(j, P_ALIVE)] = 1;
        r[at(j, P_LAST_HITTER)] = -1;
        r[at(j, P_PREV_DAMAGE)] = 0;
      }

      // 4. Jauge pleine : ultime autorisée. Relevé à chaque frame, ce qui ne dépend pas de ce que
      // `respawn` fait du drapeau ; l'usage est détecté par EV_ULTIMATE (étape 1).
      if (ultimate) {
        for (let j = 0; j < players; j++) {
          if (r[at(j, P_METER)]! >= METER_FULL) setUltimateReady(sim, j, true);
        }
      }

      // 5. Fin du tour : dernier debout (vies comptées), sinon fin du temps.
      const left = r[W_FRAMES_LEFT]!;
      if (left > 0) r[W_FRAMES_LEFT] = left - 1;
      if ((mode !== MODE_TIME || phase === PHASE_SUDDEN_DEATH) && unitsStanding(r) <= 1) {
        resolveRound(sim, r, REASON_LAST_STANDING, now, phase);
      } else if (r[W_FRAMES_LEFT] === 0) {
        resolveRound(sim, r, REASON_TIME, now, phase);
      }
    },
  };
  created.add(rules);
  return rules;
}
