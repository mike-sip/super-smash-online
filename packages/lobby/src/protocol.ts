/**
 * Protocole du lobby (SPEC-lobby.md, « Protocole du lobby ») : messages JSON sur WebSocket, un
 * objet par message, champ `t` pour le type. Partagé par le serveur et le client : aucun import
 * Node, et seulement des types de `match-rules`.
 *
 * Tout message d'un client est validé par `parseClientMessage` avant usage : taille, JSON, type,
 * champs connus seulement, types et bornes. La validation ne lève jamais d'exception. Les bornes
 * des règles de match sont vérifiées ensuite par `validateMatchConfig` (dans `room.ts`).
 */
import type { MatchConfig, MatchMode, PlayerResult } from '@game/match-rules';

export const LOBBY_PROTOCOL_VERSION = 1;
/** Choix « au hasard » d'un personnage ou d'un stage, tiré par le serveur au lancement. */
export const RANDOM = 'random';
/** Taille maximale d'un message, en caractères ; une déclaration de résultat a droit à plus. */
export const MAX_MESSAGE_CHARS = 4096;
export const MAX_RESULT_CHARS = 16_384;
export const MAX_TICKET_CHARS = 1024;
export const MIN_CAPACITY = 2;
export const MAX_CAPACITY = 8;
export const MAX_TEAMS = 4;

/** Identifiant de personnage ou de stage (même format que le personnage favori de `accounts`). */
const CONTENT_ID = /^[a-z0-9-]{1,32}$/;
/** Identifiant de compte (UUID chez `accounts`), ou de partie. */
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const GAME_ID = /^[A-Za-z0-9_-]{1,32}$/;
const REGION = /^[a-z]{2,8}$/;

export type RoomKind = 'private' | 'quick';
export type RoomPhase = 'lobby' | 'countdown' | 'playing';

/** Les règles réglables d'un salon : une `MatchConfig` sans `version` ni `players`. */
export interface RoomRules {
  readonly mode: MatchMode;
  readonly stocks: number;
  readonly timeLimit: number;
  readonly stamina: number;
  readonly teams: boolean;
  readonly teamAttack: boolean;
  readonly ultimate: boolean;
  readonly items: MatchConfig['items'];
}

/** Ce qu'un client déclare à la fin d'un match : la partie utile de `MatchResult`. */
export interface DeclaredResult {
  readonly endFrame: number;
  readonly reason: 'last-standing' | 'time' | 'sudden-death';
  readonly winners: readonly number[];
  readonly winningTeam: number | null;
  readonly players: readonly PlayerResult[];
}

export type LobbyErrorCode =
  | 'bad_request'
  | 'version'
  | 'unauthenticated'
  | 'ticket'
  | 'rate_limited'
  | 'server_full'
  | 'not_found'
  | 'full'
  | 'locked'
  | 'banned'
  | 'already_in_room'
  | 'not_in_room'
  | 'not_host'
  | 'wrong_phase'
  | 'not_ready'
  | 'invalid_rules'
  | 'invalid_fighter'
  | 'invalid_stage'
  | 'invalid_region'
  | 'high_latency'
  | 'not_in_match';

export type ClientMessage =
  | { readonly t: 'hello'; readonly version: number; readonly ticket: string }
  | { readonly t: 'ping'; readonly time: number }
  | { readonly t: 'createRoom'; readonly capacity?: number }
  | { readonly t: 'joinRoom'; readonly code: string }
  | { readonly t: 'leaveRoom' }
  | { readonly t: 'setFighter'; readonly fighter: string }
  | { readonly t: 'setTeam'; readonly team: number }
  | { readonly t: 'setReady'; readonly ready: boolean }
  | {
      readonly t: 'setRules';
      readonly rules?: RoomRules;
      readonly stage?: string;
      readonly capacity?: number;
      readonly locked?: boolean;
    }
  | { readonly t: 'kick'; readonly player: string }
  | { readonly t: 'start' }
  | { readonly t: 'queue'; readonly region: string; readonly fighter: string }
  | { readonly t: 'leaveQueue' }
  | { readonly t: 'result'; readonly gameId: string; readonly result: DeclaredResult };

export interface Identity {
  readonly id: string;
  readonly name: string;
  readonly guest: boolean;
}

export interface MemberView extends Identity {
  readonly fighter: string | null;
  readonly team: number;
  readonly ready: boolean;
  readonly connected: boolean;
  /** Aller-retour mesuré par le lobby, en ms, ou `null`. */
  readonly rttMs: number | null;
}

export type MatchStatus = 'agreed' | 'contested' | 'abandoned' | 'cancelled';

export interface MatchEndView {
  readonly gameId: string;
  readonly status: MatchStatus;
  /** Résultat accepté (`agreed`), sinon `null`. */
  readonly result: DeclaredResult | null;
  /** Explication affichable (abandon, joueur absent…). */
  readonly message: string;
}

export interface RoomView {
  /** Code à partager, sans tiret ; `null` pour un salon rapide. */
  readonly code: string | null;
  readonly kind: RoomKind;
  readonly phase: RoomPhase;
  /** Identifiant de l'hôte ; `null` pour un salon rapide. */
  readonly host: string | null;
  readonly capacity: number;
  readonly locked: boolean;
  readonly region: string;
  readonly rules: RoomRules;
  readonly stage: string;
  readonly members: readonly MemberView[];
  /** Partie en cours, ou `null`. */
  readonly gameId: string | null;
  readonly lastEnd: MatchEndView | null;
}

export interface MatchPlayerInfo extends Identity {
  readonly fighter: string;
}

/** Tout ce qu'un client doit savoir pour construire et rejoindre la partie. */
export interface MatchStartInfo {
  readonly gameId: string;
  /** Chemin du relais sur le même hôte (`/net`). */
  readonly relayPath: string;
  /** Place de ce joueur. */
  readonly slot: number;
  readonly config: MatchConfig;
  readonly stage: string;
  /** Un par place, dans l'ordre des places. */
  readonly players: readonly MatchPlayerInfo[];
}

export type RoomClosedReason = 'left' | 'kicked' | 'expired' | 'server';
export type ByeReason = 'replaced' | 'invalid' | 'rate_limited' | 'timeout' | 'server';

export type ServerMessage =
  | {
      readonly t: 'welcome';
      readonly you: Identity;
      readonly content: {
        readonly fighters: readonly string[];
        readonly stages: readonly string[];
      };
      readonly regions: readonly string[];
      readonly quickRules: RoomRules;
    }
  | { readonly t: 'pong'; readonly time: number }
  | { readonly t: 'room'; readonly room: RoomView }
  | { readonly t: 'roomClosed'; readonly reason: RoomClosedReason }
  | { readonly t: 'queued'; readonly region: string; readonly waiting: number }
  | { readonly t: 'unqueued' }
  | { readonly t: 'countdown'; readonly seconds: number }
  | { readonly t: 'matchStart'; readonly match: MatchStartInfo }
  | { readonly t: 'matchEnd'; readonly end: MatchEndView }
  | { readonly t: 'error'; readonly code: LobbyErrorCode; readonly message: string }
  | { readonly t: 'bye'; readonly reason: ByeReason };

export type ParseResult<T> = { ok: true; message: T } | { ok: false; error: string };

// ── Validation ──────────────────────────────────────────────────────────────────────────────

class Invalid extends Error {}

function fail(why: string): never {
  throw new Invalid(why);
}

type Obj = Record<string, unknown>;

function object(value: unknown, what: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${what} : objet attendu`);
  }
  return value as Obj;
}

/** Refuse tout champ hors de `keys` ; `__proto__` compris. */
function only(o: Obj, keys: readonly string[], what: string): void {
  for (const k of Object.keys(o)) if (!keys.includes(k)) fail(`${what} : champ inconnu « ${k} »`);
}

function int(value: unknown, min: number, max: number, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(`${what} : entier de ${min} à ${max} attendu`);
  }
  return value;
}

function finite(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${what} : nombre attendu`);
  return value;
}

function bool(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') fail(`${what} : booléen attendu`);
  return value;
}

function text(value: unknown, pattern: RegExp, what: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) fail(`${what} : valeur invalide`);
  return value;
}

function str(value: unknown, max: number, what: string): string {
  if (typeof value !== 'string' || value.length > max) fail(`${what} : texte invalide`);
  return value;
}

function optional<T>(o: Obj, key: string, read: (v: unknown) => T): T | undefined {
  return o[key] === undefined ? undefined : read(o[key]);
}

function rules(value: unknown): RoomRules {
  const o = object(value, 'rules');
  only(
    o,
    ['mode', 'stocks', 'timeLimit', 'stamina', 'teams', 'teamAttack', 'ultimate', 'items'],
    'rules',
  );
  const mode = o.mode;
  if (mode !== 'stock' && mode !== 'time' && mode !== 'stamina') fail('rules.mode : invalide');
  const items = object(o.items, 'rules.items');
  only(items, ['enabled', 'frequency'], 'rules.items');
  const frequency = items.frequency;
  if (frequency !== 'low' && frequency !== 'normal' && frequency !== 'high') {
    fail('rules.items.frequency : invalide');
  }
  return {
    mode,
    stocks: int(o.stocks, 0, 1000, 'rules.stocks'),
    timeLimit: int(o.timeLimit, 0, 100_000, 'rules.timeLimit'),
    stamina: int(o.stamina, 0, 100_000, 'rules.stamina'),
    teams: bool(o.teams, 'rules.teams'),
    teamAttack: bool(o.teamAttack, 'rules.teamAttack'),
    ultimate: bool(o.ultimate, 'rules.ultimate'),
    items: { enabled: bool(items.enabled, 'rules.items.enabled'), frequency },
  };
}

const PLAYER_RESULT_KEYS = [
  'team',
  'placement',
  'kos',
  'falls',
  'selfDestructs',
  'score',
  'damageDealt',
  'damageTaken',
  'stocksLeft',
  'ultimatesUsed',
  'eliminatedAt',
] as const;

const BIG = 0x7fff_ffff;

function playerResult(value: unknown, i: number): PlayerResult {
  const what = `result.players[${i}]`;
  const o = object(value, what);
  only(o, PLAYER_RESULT_KEYS, what);
  return {
    team: int(o.team, 0, MAX_TEAMS - 1, `${what}.team`),
    placement: int(o.placement, 1, MAX_CAPACITY, `${what}.placement`),
    kos: int(o.kos, 0, BIG, `${what}.kos`),
    falls: int(o.falls, 0, BIG, `${what}.falls`),
    selfDestructs: int(o.selfDestructs, 0, BIG, `${what}.selfDestructs`),
    score: int(o.score, -BIG, BIG, `${what}.score`),
    damageDealt: int(o.damageDealt, 0, BIG, `${what}.damageDealt`),
    damageTaken: int(o.damageTaken, 0, BIG, `${what}.damageTaken`),
    stocksLeft: int(o.stocksLeft, 0, BIG, `${what}.stocksLeft`),
    ultimatesUsed: int(o.ultimatesUsed, 0, BIG, `${what}.ultimatesUsed`),
    eliminatedAt: int(o.eliminatedAt, -1, BIG, `${what}.eliminatedAt`),
  };
}

/** Forme d'une déclaration ; la cohérence avec la partie (nombre de places) est vérifiée ailleurs. */
export function readDeclaredResult(value: unknown): DeclaredResult {
  const o = object(value, 'result');
  only(o, ['endFrame', 'reason', 'winners', 'winningTeam', 'players'], 'result');
  const reason = o.reason;
  if (reason !== 'last-standing' && reason !== 'time' && reason !== 'sudden-death') {
    fail('result.reason : invalide');
  }
  if (!Array.isArray(o.players) || o.players.length < 2 || o.players.length > MAX_CAPACITY) {
    fail('result.players : de 2 à 8 joueurs attendus');
  }
  const players = o.players.map(playerResult);
  if (!Array.isArray(o.winners) || o.winners.length > MAX_CAPACITY)
    fail('result.winners : invalide');
  const winners = o.winners.map((w, i) => int(w, 0, players.length - 1, `result.winners[${i}]`));
  if (new Set(winners).size !== winners.length) fail('result.winners : doublon');
  return {
    endFrame: int(o.endFrame, 0, BIG, 'result.endFrame'),
    reason,
    winners,
    winningTeam:
      o.winningTeam === null ? null : int(o.winningTeam, 0, MAX_TEAMS - 1, 'result.winningTeam'),
    players,
  };
}

function readClient(value: unknown): ClientMessage {
  const o = object(value, 'message');
  const t = o.t;
  const keys = (...k: string[]) => only(o, ['t', ...k], String(t));
  switch (t) {
    case 'hello':
      keys('version', 'ticket');
      return {
        t,
        version: int(o.version, 0, 1_000_000, 'version'),
        ticket: str(o.ticket, MAX_TICKET_CHARS, 'ticket'),
      };
    case 'ping':
      keys('time');
      return { t, time: finite(o.time, 'time') };
    case 'createRoom': {
      keys('capacity');
      const capacity = optional(o, 'capacity', (v) =>
        int(v, MIN_CAPACITY, MAX_CAPACITY, 'capacity'),
      );
      return capacity === undefined ? { t } : { t, capacity };
    }
    case 'joinRoom':
      keys('code');
      return { t, code: str(o.code, 32, 'code') };
    case 'leaveRoom':
    case 'start':
    case 'leaveQueue':
      keys();
      return { t };
    case 'setFighter':
      keys('fighter');
      return { t, fighter: text(o.fighter, CONTENT_ID, 'fighter') };
    case 'setTeam':
      keys('team');
      return { t, team: int(o.team, 0, MAX_TEAMS - 1, 'team') };
    case 'setReady':
      keys('ready');
      return { t, ready: bool(o.ready, 'ready') };
    case 'setRules': {
      keys('rules', 'stage', 'capacity', 'locked');
      const m: {
        t: 'setRules';
        rules?: RoomRules;
        stage?: string;
        capacity?: number;
        locked?: boolean;
      } = { t };
      const r = optional(o, 'rules', rules);
      if (r !== undefined) m.rules = r;
      const stage = optional(o, 'stage', (v) => text(v, CONTENT_ID, 'stage'));
      if (stage !== undefined) m.stage = stage;
      const capacity = optional(o, 'capacity', (v) =>
        int(v, MIN_CAPACITY, MAX_CAPACITY, 'capacity'),
      );
      if (capacity !== undefined) m.capacity = capacity;
      const locked = optional(o, 'locked', (v) => bool(v, 'locked'));
      if (locked !== undefined) m.locked = locked;
      return m;
    }
    case 'kick':
      keys('player');
      return { t, player: text(o.player, ACCOUNT_ID, 'player') };
    case 'queue':
      keys('region', 'fighter');
      return {
        t,
        region: text(o.region, REGION, 'region'),
        fighter: text(o.fighter, CONTENT_ID, 'fighter'),
      };
    case 'result':
      keys('gameId', 'result');
      return { t, gameId: text(o.gameId, GAME_ID, 'gameId'), result: readDeclaredResult(o.result) };
    default:
      return fail('type de message inconnu');
  }
}

/** Valide un message reçu d'un client. Ne lève jamais d'exception. */
export function parseClientMessage(data: string): ParseResult<ClientMessage> {
  if (typeof data !== 'string') return { ok: false, error: 'message texte attendu' };
  if (data.length > MAX_RESULT_CHARS) return { ok: false, error: 'message trop gros' };
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return { ok: false, error: 'JSON invalide' };
  }
  try {
    const message = readClient(value);
    if (message.t !== 'result' && data.length > MAX_MESSAGE_CHARS) {
      return { ok: false, error: 'message trop gros' };
    }
    return { ok: true, message };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    return { ok: false, error: 'message invalide' };
  }
}

const SERVER_TYPES = new Set([
  'welcome',
  'pong',
  'room',
  'roomClosed',
  'queued',
  'unqueued',
  'countdown',
  'matchStart',
  'matchEnd',
  'error',
  'bye',
]);

/**
 * Lit un message du serveur. Le client fait confiance au serveur pour le contenu, mais ne plante
 * jamais sur un message mal formé : il l'ignore.
 */
export function parseServerMessage(data: unknown): ParseResult<ServerMessage> {
  if (typeof data !== 'string' || data.length > 256 * 1024) {
    return { ok: false, error: 'message texte attendu' };
  }
  try {
    const value: unknown = JSON.parse(data);
    if (typeof value !== 'object' || value === null) return { ok: false, error: 'objet attendu' };
    const t = (value as Obj).t;
    if (typeof t !== 'string' || !SERVER_TYPES.has(t)) return { ok: false, error: 'type inconnu' };
    return { ok: true, message: value as ServerMessage };
  } catch {
    return { ok: false, error: 'JSON invalide' };
  }
}

/** Vrai si `id` est un identifiant de personnage ou de stage bien formé. */
export function isContentId(id: string): boolean {
  return CONTENT_ID.test(id);
}

/** Vrai si `region` est un identifiant de région bien formé. */
export function isRegion(region: string): boolean {
  return REGION.test(region);
}

/** Les règles réglables d'une `MatchConfig`. */
export function rulesOf(config: MatchConfig): RoomRules {
  return {
    mode: config.mode,
    stocks: config.stocks,
    timeLimit: config.timeLimit,
    stamina: config.stamina,
    teams: config.teams,
    teamAttack: config.teamAttack,
    ultimate: config.ultimate,
    items: { enabled: config.items.enabled, frequency: config.items.frequency },
  };
}
