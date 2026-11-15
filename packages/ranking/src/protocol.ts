/**
 * Protocole du classement : rapport de match transmis par `lobby`, réponses de l'API, codes
 * d'erreur, validation. Sans import Node : partagé avec le navigateur (`@game/ranking/protocol`).
 */
import type { MatchResult } from '@game/match-rules';

/** Préfixe de toutes les routes. */
export const API_PREFIX = '/api/ranking/v1';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const MAX_TEAM = 3;
/** Borne des compteurs d'un joueur (KO, chutes). */
export const MAX_COUNTER = 9_999;
/** Borne de la frame de fin : une heure de jeu à 60 Hz, avec de la marge pour la mort subite. */
export const MAX_END_FRAME = 60 * 60 * 60 * 4;

export type MatchMode = 'stock' | 'time' | 'stamina';
const MODES: readonly string[] = ['stock', 'time', 'stamina'];

/** Résultat d'un match, construit côté serveur par `lobby` (jamais par un client). */
export interface MatchReport {
  readonly version: 1;
  /** UUID choisi par `lobby` à la création de la partie : clé d'idempotence. */
  readonly matchId: string;
  /** Millisecondes Unix, au moment de l'envoi. */
  readonly reportedAt: number;
  /** Fin de la partie, millisecondes Unix. */
  readonly endedAt: number;
  /** Matchmaking : vrai ; salon privé : faux. */
  readonly ranked: boolean;
  readonly mode: MatchMode;
  readonly teams: boolean;
  /** `MatchResult.endFrame`. */
  readonly endFrame: number;
  /** Dans l'ordre des emplacements, de 2 à 8. */
  readonly players: readonly ReportedPlayer[];
}

export interface ReportedPlayer {
  /** Identifiant de compte (`sub` du ticket vérifié). */
  readonly accountId: string;
  /** `guest` du ticket. */
  readonly guest: boolean;
  /** Identifiant de personnage, `[a-z0-9-]{1,32}`. */
  readonly fighter: string;
  /** Équipe de 0 à 3 en équipes ; ignorée sinon (-1 accepté). */
  readonly team: number;
  /** 1 = premier ; ex æquo possibles ; en équipes, la place de l'équipe. */
  readonly placement: number;
  readonly kos: number;
  readonly falls: number;
  /** Frame de départ définitif annoncée par le relais, ou `null`. */
  readonly leftAtFrame: number | null;
}

const REPORT_KEYS = [
  'version',
  'matchId',
  'reportedAt',
  'endedAt',
  'ranked',
  'mode',
  'teams',
  'endFrame',
  'players',
] as const;
const PLAYER_KEYS = [
  'accountId',
  'guest',
  'fighter',
  'team',
  'placement',
  'kos',
  'falls',
  'leftAtFrame',
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FIGHTER = /^[a-z0-9-]{1,32}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  problems: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) problems.push(`${where} : champ inconnu « ${key} »`);
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) problems.push(`${where} : champ « ${key} » manquant`);
  }
}

/**
 * Vérifie que les places forment un classement « olympique » : chaque unité a pour place
 * 1 + le nombre d'unités strictement mieux classées.
 */
function placementsConsistent(placements: readonly number[]): boolean {
  return placements.every((p) => p === 1 + placements.filter((q) => q < p).length);
}

export type ReportValidation =
  | { readonly ok: true; readonly report: MatchReport }
  | { readonly ok: false; readonly problems: string[] };

/** Valide une valeur reçue. N'accepte aucun champ inconnu. Ne lève jamais. */
export function validateReport(value: unknown): ReportValidation {
  const problems: string[] = [];
  if (!isRecord(value)) return { ok: false, problems: ['le rapport doit être un objet JSON'] };
  checkKeys(value, REPORT_KEYS, 'rapport', problems);
  if (value.version !== 1) problems.push('version : 1 attendu');
  if (!isUuid(value.matchId)) problems.push('matchId : UUID en minuscules attendu');
  for (const key of ['reportedAt', 'endedAt'] as const) {
    if (!isInt(value[key], 0, Number.MAX_SAFE_INTEGER)) {
      problems.push(`${key} : entier positif (millisecondes) attendu`);
    }
  }
  if (typeof value.ranked !== 'boolean') problems.push('ranked : booléen attendu');
  if (typeof value.teams !== 'boolean') problems.push('teams : booléen attendu');
  if (typeof value.mode !== 'string' || !MODES.includes(value.mode)) {
    problems.push('mode : stock, time ou stamina attendu');
  }
  const endFrameOk = isInt(value.endFrame, 0, MAX_END_FRAME);
  if (!endFrameOk) problems.push(`endFrame : entier de 0 à ${MAX_END_FRAME} attendu`);
  const endFrame = endFrameOk ? (value.endFrame as number) : MAX_END_FRAME;
  const teams = value.teams === true;

  const players = value.players;
  if (!Array.isArray(players) || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    problems.push(`joueurs : liste de ${MIN_PLAYERS} à ${MAX_PLAYERS} joueurs attendue`);
    return { ok: false, problems };
  }
  const count = players.length;
  let playersOk = true;
  const ids = new Set<string>();
  players.forEach((player: unknown, i) => {
    const where = `joueur ${i}`;
    const before = problems.length;
    if (!isRecord(player)) {
      problems.push(`${where} : objet attendu`);
      playersOk = false;
      return;
    }
    checkKeys(player, PLAYER_KEYS, where, problems);
    if (!isUuid(player.accountId)) problems.push(`${where} : accountId : UUID attendu`);
    else if (ids.has(player.accountId)) problems.push(`${where} : compte présent plusieurs fois`);
    else ids.add(player.accountId);
    if (typeof player.guest !== 'boolean') problems.push(`${where} : guest : booléen attendu`);
    if (typeof player.fighter !== 'string' || !FIGHTER.test(player.fighter)) {
      problems.push(`${where} : fighter : identifiant [a-z0-9-]{1,32} attendu`);
    }
    if (teams ? !isInt(player.team, 0, MAX_TEAM) : !isInt(player.team, -1, MAX_TEAM)) {
      problems.push(`${where} : team : entier de ${teams ? 0 : -1} à ${MAX_TEAM} attendu`);
    }
    if (!isInt(player.placement, 1, count)) {
      problems.push(`${where} : placement : entier de 1 à ${count} attendu`);
    }
    for (const key of ['kos', 'falls'] as const) {
      if (!isInt(player[key], 0, MAX_COUNTER)) {
        problems.push(`${where} : ${key} : entier de 0 à ${MAX_COUNTER} attendu`);
      }
    }
    if (player.leftAtFrame !== null && !isInt(player.leftAtFrame, 0, endFrame)) {
      problems.push(`${where} : leftAtFrame : null ou entier de 0 à endFrame attendu`);
    }
    if (problems.length > before) playersOk = false;
  });

  if (playersOk) {
    const list = players as ReportedPlayer[];
    if (teams) {
      const byTeam = new Map<number, number>();
      for (const p of list) {
        const known = byTeam.get(p.team);
        if (known === undefined) byTeam.set(p.team, p.placement);
        else if (known !== p.placement) {
          problems.push(`équipe ${p.team} : tous ses membres doivent avoir la même place`);
          byTeam.set(p.team, Math.min(known, p.placement));
        }
      }
      if (byTeam.size < 2) problems.push('équipes : il faut au moins deux équipes');
      else if (!placementsConsistent([...byTeam.values()])) {
        problems.push('places : classement des équipes incohérent');
      }
    } else if (!placementsConsistent(list.map((p) => p.placement))) {
      problems.push('places : classement incohérent (1, puis nombre de mieux classés + 1)');
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, report: value as unknown as MatchReport };
}

/**
 * JSON canonique d'un rapport validé (ordre de clés fixe) : base de son empreinte. `reportedAt`
 * n'en fait pas partie : un même match renvoyé plus tard reste un doublon, pas un conflit.
 */
export function canonicalReport(report: MatchReport): string {
  return JSON.stringify([
    report.version,
    report.matchId,
    report.endedAt,
    report.ranked,
    report.mode,
    report.teams,
    report.endFrame,
    report.players.map((p) => [
      p.accountId,
      p.guest,
      p.fighter,
      p.team,
      p.placement,
      p.kos,
      p.falls,
      p.leftAtFrame,
    ]),
  ]);
}

/** Ce que `lobby` sait de chaque place en plus du `MatchResult`. */
export interface ReportedIdentity {
  readonly accountId: string;
  readonly guest: boolean;
  readonly fighter: string;
  readonly leftAtFrame: number | null;
}

/** Construit un rapport depuis un `MatchResult` officiel. Lève si les joueurs ne correspondent pas. */
export function reportFromResult(
  result: MatchResult,
  extra: {
    readonly matchId: string;
    readonly ranked: boolean;
    readonly endedAt: number;
    readonly reportedAt: number;
    readonly players: readonly ReportedIdentity[];
  },
): MatchReport {
  if (extra.players.length !== result.players.length) {
    throw new Error(
      `reportFromResult : ${extra.players.length} identités pour ${result.players.length} joueurs.`,
    );
  }
  return {
    version: 1,
    matchId: extra.matchId,
    reportedAt: extra.reportedAt,
    endedAt: extra.endedAt,
    ranked: extra.ranked,
    mode: result.config.mode,
    teams: result.config.teams,
    endFrame: result.endFrame,
    players: result.players.map((p, i) => {
      const who = extra.players[i]!;
      return {
        accountId: who.accountId,
        guest: who.guest,
        fighter: who.fighter,
        team: p.team,
        placement: p.placement,
        kos: p.kos,
        falls: p.falls,
        leftAtFrame: who.leftAtFrame,
      };
    }),
  };
}

// --- API HTTP --------------------------------------------------------------------------------

export type ErrorCode =
  | 'bad_request'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'forbidden_origin'
  | 'not_found'
  | 'method_not_allowed'
  | 'unauthenticated'
  | 'invalid_report'
  | 'bad_signature'
  | 'stale_report'
  | 'conflict'
  | 'internal';

export const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  bad_request: 'Requête invalide.',
  unsupported_media_type: 'Le corps doit être en JSON.',
  payload_too_large: 'Requête trop volumineuse.',
  forbidden_origin: 'Origine refusée.',
  not_found: 'Ressource inconnue.',
  method_not_allowed: 'Méthode non permise.',
  unauthenticated: 'Session requise.',
  invalid_report: 'Rapport de match invalide.',
  bad_signature: 'Signature du rapport absente ou invalide.',
  stale_report: 'Rapport trop ancien ou daté dans le futur.',
  conflict: 'Un autre rapport existe déjà pour ce match.',
  internal: 'Erreur interne du serveur.',
};

export interface ErrorBody {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly problems?: readonly string[];
  };
}

export interface RatingChange {
  readonly accountId: string;
  readonly before: number;
  readonly after: number;
  readonly delta: number;
}

export interface SubmitResponse {
  readonly status: 'recorded' | 'duplicate';
  /** Vrai si le match a modifié des cotes. */
  readonly ranked: boolean;
  readonly changes: readonly RatingChange[];
}

export interface LeaderboardEntry {
  readonly rank: number;
  readonly accountId: string;
  readonly pseudo: string;
  readonly rating: number;
  readonly rankedMatches: number;
  readonly wins: number;
}

export interface LeaderboardResponse {
  readonly total: number;
  readonly entries: readonly LeaderboardEntry[];
}

export interface FighterStats {
  readonly fighter: string;
  readonly played: number;
  readonly wins: number;
}

export interface RankingProfile {
  /** `null` pour un invité ou un compte qui n'a jamais joué de match classé. */
  readonly rating: number | null;
  /** Moins de `LEADERBOARD_MIN_MATCHES` matchs classés. */
  readonly provisional: boolean;
  readonly rank: number | null;
  readonly peakRating: number | null;
  readonly rankedMatches: number;
  readonly matchesPlayed: number;
  readonly wins: number;
  readonly kos: number;
  readonly falls: number;
  readonly fighters: readonly FighterStats[];
}

export interface ProfileResponse {
  /** `null` sans session. */
  readonly profile: RankingProfile | null;
  /** Le compte est un invité : jamais classé. */
  readonly guest: boolean;
}

export interface HistoryPlayer {
  readonly name: string;
  readonly kind: 'account' | 'guest' | 'deleted';
  readonly fighter: string;
  readonly placement: number;
  readonly team: number;
  readonly left: boolean;
}

export interface HistoryEntry {
  readonly matchId: string;
  /** ISO 8601. */
  readonly endedAt: string;
  readonly mode: MatchMode;
  readonly teams: boolean;
  /** Le match a modifié des cotes. */
  readonly ranked: boolean;
  /** Place utilisée pour le classement (abandon compris). */
  readonly placement: number;
  /** Nombre d'unités classées (joueurs ou équipes). */
  readonly units: number;
  readonly fighter: string;
  readonly left: boolean;
  readonly delta: number | null;
  readonly ratingAfter: number | null;
  readonly players: readonly HistoryPlayer[];
}

export interface HistoryResponse {
  readonly matches: readonly HistoryEntry[];
  /** Curseur de la page suivante, ou `null`. */
  readonly next: string | null;
}
