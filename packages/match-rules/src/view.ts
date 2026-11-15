/**
 * Lecture de l'état de match : `readMatch` pour le HUD (à chaque image, sans allocation),
 * `matchResult` pour l'écran de fin et le futur module `ranking` (une fois, alloue).
 */
import {
  FX_ONE,
  MAX_PLAYERS,
  createFighterView,
  readFighter,
  rulesState,
  type Sim,
} from '@game/sim-core';
import type { MatchConfig, MatchMode } from './config.ts';
import {
  P_DEALT,
  P_ELIM_AT,
  P_FALLS,
  P_KOS,
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
  PHASE_SUDDEN_DEATH,
  REASON_LAST_STANDING,
  REASON_TIME,
  W_END_FRAME,
  W_FRAMES_LEFT,
  W_PHASE,
  W_REASON,
  at,
} from './layout.ts';
import { FRAMES_PER_SECOND, METER_FULL, MODE_STAMINA, rulesOf, stocksCounted } from './rules.ts';

export type MatchPhase = 'playing' | 'sudden-death' | 'over';

/** Vue du match pour le HUD. Tableaux indexés par joueur, de taille `MAX_PLAYERS`. */
export interface MatchView {
  players: number;
  mode: MatchMode;
  phase: MatchPhase;
  teams: boolean;
  /** Vrai en mode Temps hors mort subite : le score compte plus que les vies. */
  showScore: boolean;
  /** Jauge d'ultime active. */
  meterEnabled: boolean;
  /** Frames et secondes restantes (arrondies au-dessus), ou -1 sans limite. */
  framesLeft: number;
  timeLeft: number;
  /** Vies restantes, ou -1 si elles ne sont pas comptées (mode Temps). */
  readonly stocks: Int32Array;
  /** Points de vie restants (arrondis au-dessus), ou -1 hors Endurance. */
  readonly hp: Int32Array;
  /** KO marqués moins chutes. */
  readonly score: Int32Array;
  /** Jauge d'ultime, de 0 à 1. */
  readonly meter: Float32Array;
  readonly ultimateReady: Uint8Array;
  /** Équipe, ou -1 sans équipes. */
  readonly team: Int32Array;
  readonly eliminated: Uint8Array;
  /** Frames avant réapparition, 0 si aucune n'est prévue. */
  readonly respawnIn: Int32Array;
  readonly invincible: Uint8Array;
}

export function createMatchView(): MatchView {
  return {
    players: 0,
    mode: 'stock',
    phase: 'playing',
    teams: false,
    showScore: false,
    meterEnabled: false,
    framesLeft: -1,
    timeLeft: -1,
    stocks: new Int32Array(MAX_PLAYERS),
    hp: new Int32Array(MAX_PLAYERS),
    score: new Int32Array(MAX_PLAYERS),
    meter: new Float32Array(MAX_PLAYERS),
    ultimateReady: new Uint8Array(MAX_PLAYERS),
    team: new Int32Array(MAX_PLAYERS),
    eliminated: new Uint8Array(MAX_PLAYERS),
    respawnIn: new Int32Array(MAX_PLAYERS),
    invincible: new Uint8Array(MAX_PLAYERS),
  };
}

const fighterView = createFighterView();

function phaseName(phase: number): MatchPhase {
  return phase === PHASE_OVER ? 'over' : phase === PHASE_SUDDEN_DEATH ? 'sudden-death' : 'playing';
}

/** Remplit `out` avec l'état du match. N'alloue rien. */
export function readMatch(sim: Sim, out: MatchView): void {
  const rules = rulesOf(sim);
  const match = rules.match;
  const r = rulesState(sim);
  const counted = stocksCounted(rules, r);
  const phase = r[W_PHASE]!;
  out.players = rules.players;
  out.mode = match.mode;
  out.phase = phaseName(phase);
  out.teams = match.teams;
  out.showScore = !counted;
  out.meterEnabled = match.ultimate;
  const left = r[W_FRAMES_LEFT]!;
  out.framesLeft = left;
  out.timeLeft = left < 0 ? -1 : Math.ceil(left / FRAMES_PER_SECOND);
  for (let p = 0; p < MAX_PLAYERS; p++) {
    if (p >= rules.players) {
      out.stocks[p] = 0;
      out.hp[p] = -1;
      out.score[p] = 0;
      out.meter[p] = 0;
      out.ultimateReady[p] = 0;
      out.team[p] = -1;
      out.eliminated[p] = 0;
      out.respawnIn[p] = 0;
      out.invincible[p] = 0;
      continue;
    }
    readFighter(sim, p, fighterView);
    out.stocks[p] = counted ? r[at(p, P_STOCKS)]! : -1;
    if (rules.mode === MODE_STAMINA) {
      const hp = Math.ceil((rules.staminaFx - r[at(p, P_PREV_DAMAGE)]!) / FX_ONE);
      out.hp[p] = hp < 0 ? 0 : hp;
    } else {
      out.hp[p] = -1;
    }
    out.score[p] = r[at(p, P_KOS)]! - r[at(p, P_FALLS)]!;
    out.meter[p] = r[at(p, P_METER)]! / METER_FULL;
    out.ultimateReady[p] = fighterView.ultimateReady ? 1 : 0;
    out.team[p] = match.teams ? match.players[p]!.team : -1;
    out.eliminated[p] = r[at(p, P_OUT)]!;
    out.respawnIn[p] = r[at(p, P_RESPAWN)]!;
    out.invincible[p] = fighterView.invincible ? 1 : 0;
  }
}

export interface PlayerResult {
  readonly team: number;
  /** 1 = premier ; les ex æquo partagent la place. En équipes, la place de l'équipe. */
  readonly placement: number;
  readonly kos: number;
  readonly falls: number;
  readonly selfDestructs: number;
  /** KO marqués moins chutes, calculé dans tous les modes. */
  readonly score: number;
  /** Dégâts infligés à des adversaires et subis, en pourcentage. */
  readonly damageDealt: number;
  readonly damageTaken: number;
  /** Vies restantes, ou -1 si elles n'étaient pas comptées (mode Temps sans mort subite). */
  readonly stocksLeft: number;
  readonly ultimatesUsed: number;
  /** Frame d'élimination, ou -1. */
  readonly eliminatedAt: number;
}

export type MatchEndReason = 'last-standing' | 'time' | 'sudden-death';

export interface MatchResult {
  readonly config: MatchConfig;
  readonly endFrame: number;
  readonly reason: MatchEndReason;
  /** Joueurs classés premiers, par index croissant (plusieurs en équipes). */
  readonly winners: readonly number[];
  readonly winningTeam: number | null;
  readonly players: readonly PlayerResult[];
}

/** Résultats du match terminé, ou `null` s'il est en cours. Alloue : à appeler une fois. */
export function matchResult(sim: Sim): MatchResult | null {
  const rules = rulesOf(sim);
  const r = rulesState(sim);
  if (r[W_PHASE] !== PHASE_OVER) return null;
  const match = rules.match;
  const counted = stocksCounted(rules, r);
  const players: PlayerResult[] = [];
  const winners: number[] = [];
  for (let p = 0; p < rules.players; p++) {
    const placement = r[at(p, P_PLACE)]!;
    if (placement === 1) winners.push(p);
    players.push({
      team: match.teams ? match.players[p]!.team : -1,
      placement,
      kos: r[at(p, P_KOS)]!,
      falls: r[at(p, P_FALLS)]!,
      selfDestructs: r[at(p, P_SDS)]!,
      score: r[at(p, P_KOS)]! - r[at(p, P_FALLS)]!,
      damageDealt: r[at(p, P_DEALT)]! / FX_ONE,
      damageTaken: r[at(p, P_TAKEN)]! / FX_ONE,
      stocksLeft: counted ? r[at(p, P_STOCKS)]! : -1,
      ultimatesUsed: r[at(p, P_ULTIMATES)]!,
      eliminatedAt: r[at(p, P_ELIM_AT)]!,
    });
  }
  const reason = r[W_REASON]!;
  return {
    config: match,
    endFrame: r[W_END_FRAME]!,
    reason:
      reason === REASON_LAST_STANDING
        ? 'last-standing'
        : reason === REASON_TIME
          ? 'time'
          : 'sudden-death',
    winners,
    winningTeam: match.teams && winners.length > 0 ? match.players[winners[0]!]!.team : null,
    players,
  };
}
