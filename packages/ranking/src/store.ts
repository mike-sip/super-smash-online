/**
 * Interface de stockage du classement. Asynchrone, pour qu'une base distante puisse la remplir un
 * jour ; deux implémentations (mémoire, SQLite) qui passent la même suite de contrat
 * (`test/store-contract.ts`).
 *
 * Le stockage ne calcule rien : le service lui remet un match entièrement calculé (places
 * effectives, variations, victoires), qu'il enregistre d'un bloc avec les compteurs qui en
 * découlent. Aucun pseudo n'est stocké.
 */
import type { MatchMode } from './protocol.ts';

export interface ParticipantRecord {
  /** Emplacement dans la partie (0 à 7). */
  readonly slot: number;
  /** `null` une fois le compte supprimé. */
  readonly accountId: string | null;
  readonly guest: boolean;
  readonly fighter: string;
  readonly team: number;
  /** Place donnée par `match-rules`. */
  readonly placement: number;
  /** Place après la règle d'abandon, parmi `units` unités. */
  readonly effectivePlacement: number;
  readonly kos: number;
  readonly falls: number;
  readonly leftAtFrame: number | null;
  readonly won: boolean;
  /** Cotes et variation, si le joueur a été classé dans ce match ; `null` sinon. */
  readonly ratingBefore: number | null;
  readonly ratingAfter: number | null;
  readonly delta: number | null;
  /** Compteurs d'`accounts` mis à jour pour cette participation. */
  readonly synced: boolean;
}

export interface MatchRecord {
  readonly matchId: string;
  /** Empreinte SHA-256 du rapport canonique. */
  readonly fingerprint: string;
  /** Le match a modifié des cotes. */
  readonly ranked: boolean;
  /** Le rapport demandait un match classé (matchmaking). */
  readonly requestedRanked: boolean;
  readonly mode: MatchMode;
  readonly teams: boolean;
  readonly endFrame: number;
  /** Millisecondes Unix. */
  readonly endedAt: number;
  readonly recordedAt: number;
  readonly units: number;
  readonly participants: readonly ParticipantRecord[];
}

export interface PlayerRecord {
  readonly accountId: string;
  /** `null` tant qu'aucun match classé. */
  readonly rating: number | null;
  readonly peakRating: number | null;
  readonly rankedMatches: number;
  readonly matchesPlayed: number;
  readonly wins: number;
  readonly kos: number;
  readonly falls: number;
}

export interface FighterRecord {
  readonly fighter: string;
  readonly played: number;
  readonly wins: number;
}

export interface LeaderboardRow {
  readonly rank: number;
  readonly accountId: string;
  readonly rating: number;
  readonly rankedMatches: number;
  readonly wins: number;
}

/** Position dans l'historique : on lit les matchs strictement plus anciens. */
export interface HistoryCursor {
  readonly endedAt: number;
  readonly matchId: string;
}

export interface UnsyncedParticipation {
  readonly matchId: string;
  readonly slot: number;
  readonly accountId: string;
  readonly won: boolean;
}

/** Levée quand un match de même identifiant est déjà enregistré. */
export class MatchExistsError extends Error {
  constructor() {
    super('Match déjà enregistré.');
    this.name = 'MatchExistsError';
  }
}

export interface RankingStore {
  /**
   * Enregistre le match, ses participants et, pour chaque participant encore lié à un compte,
   * ses compteurs : matchs, victoires, KO, chutes, par personnage ; et, s'il a été classé, sa cote
   * (`ratingAfter`), sa meilleure cote et son nombre de matchs classés. Tout ou rien. Lève
   * `MatchExistsError` si l'identifiant existe déjà, sans rien modifier.
   */
  recordMatch(match: MatchRecord): Promise<void>;
  findMatch(matchId: string): Promise<MatchRecord | null>;
  /** Cotes des comptes qui en ont une. */
  ratings(accountIds: readonly string[]): Promise<Map<string, number>>;
  findPlayer(accountId: string): Promise<PlayerRecord | null>;
  /** Par nombre de matchs décroissant, puis identifiant. */
  fighterStats(accountId: string): Promise<FighterRecord[]>;
  /**
   * Joueurs cotés avec au moins `minMatches` matchs classés, par cote décroissante, puis matchs
   * classés décroissants, puis identifiant. Rang « olympique » : 1 + nombre de cotes supérieures.
   */
  leaderboard(
    offset: number,
    limit: number,
    minMatches: number,
  ): Promise<{ total: number; rows: LeaderboardRow[] }>;
  /** Rang du joueur au classement, ou `null` s'il n'y figure pas. */
  rankOf(accountId: string, minMatches: number): Promise<number | null>;
  /** Matchs du joueur, du plus récent au plus ancien (fin, puis identifiant décroissants). */
  history(accountId: string, before: HistoryCursor | null, limit: number): Promise<MatchRecord[]>;
  unsynced(limit: number): Promise<UnsyncedParticipation[]>;
  markSynced(matchId: string, slot: number): Promise<void>;
  /**
   * Efface la cote, les compteurs et les statistiques du compte ; ses participations restent,
   * sans identifiant (et marquées synchronisées). Renvoie vrai s'il y avait quelque chose.
   */
  deleteAccount(accountId: string): Promise<boolean>;
  /** Tous les identifiants de compte encore présents (joueurs et participations). */
  knownAccounts(): Promise<string[]>;
  close(): Promise<void>;
}
