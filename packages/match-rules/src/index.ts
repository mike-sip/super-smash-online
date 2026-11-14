/** API publique de `match-rules`. Tout ce qui n'est pas exporté ici est un détail interne. */
import type { EntityDef, FighterDef, SimConfig, StageDef } from '@game/sim-core';
import { validateMatchConfig, type MatchConfig } from './config.ts';
import { createMatchRules } from './rules.ts';

export {
  MAX_MATCH_PLAYERS,
  MAX_STAMINA,
  MAX_STOCKS,
  MAX_TEAMS,
  MAX_TIME_LIMIT,
  MIN_PLAYERS,
  MIN_TIME_LIMIT,
  defaultMatchConfig,
  validateMatchConfig,
  type ItemFrequency,
  type MatchConfig,
  type MatchMode,
  type MatchPlayerConfig,
  type ValidationResult,
} from './config.ts';
export {
  KO_CREDIT_WINDOW,
  METER_FULL,
  RESPAWN_DELAY,
  RESPAWN_INVINCIBILITY,
  SUDDEN_DEATH_DAMAGE,
} from './rules.ts';
export {
  createMatchView,
  matchResult,
  readMatch,
  type MatchEndReason,
  type MatchPhase,
  type MatchResult,
  type MatchView,
  type PlayerResult,
} from './view.ts';

/** Contenu d'un match, choisi à côté de la configuration (personnages, stage). */
export interface MatchContent {
  readonly stage: StageDef;
  /** Un combattant par joueur, dans l'ordre de `MatchConfig.players`. */
  readonly fighters: readonly FighterDef[];
  readonly entities?: readonly EntityDef[];
  readonly seed: number;
}

/**
 * Construit la configuration de simulation d'un match : contenu, crochet de règles, équipes et
 * tir allié. Chaque pair la reconstruit à partir de la même `MatchConfig` ; elle contient des
 * fonctions et ne voyage donc pas sur le réseau. Lève si la configuration est invalide.
 */
export function createMatchSimConfig(match: MatchConfig, content: MatchContent): SimConfig {
  const checked = validateMatchConfig(match);
  if (!checked.ok) throw new Error(`Configuration de match invalide : ${checked.errors.join(' ')}`);
  const config = checked.config;
  if (content.fighters.length !== config.players.length) {
    throw new Error(
      `Il faut un combattant par joueur : ${content.fighters.length} combattants pour ${config.players.length} joueurs.`,
    );
  }
  return {
    stage: content.stage,
    fighters: content.fighters,
    entities: content.entities,
    seed: content.seed,
    teams: config.teams ? config.players.map((p) => p.team) : undefined,
    teamAttack: config.teams ? config.teamAttack : true,
    rules: createMatchRules(config),
  };
}
