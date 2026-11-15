/**
 * Le service du lobby (SPEC-lobby.md) : connexions, identité, salons, file d'attente, lancement
 * des parties sur le relais, suivi du match et fin. Logique sans socket, comme le relais : chaque
 * connexion est une interface `LobbyConnection` fournie par l'hôte (WebSocket réel, ou connexions
 * en mémoire des tests), l'horloge et l'aléa sont injectés.
 *
 * Le relais est appelé directement (même processus) : `reserve` au lancement, `cancel` à la fin.
 * Ses événements (`onGameEvent`, `onDesync`) doivent être transmis à `relayEvent` et
 * `relayDesync` : c'est l'assemblage (`server.ts`) qui les branche.
 */
import { defaultMatchConfig } from '@game/match-rules';
import type { Relay, RelayGameEvent } from '@game/netcode/server';
import { drawCode, normalizeCode } from './codes.ts';
import {
  createAddressCounter,
  createBuckets,
  createReplayGuard,
  type BucketRule,
} from './limits.ts';
import { createMatchmaker, type QueueEntry } from './matchmaking.ts';
import {
  LOBBY_PROTOCOL_VERSION,
  RANDOM,
  parseClientMessage,
  rulesOf,
  type ByeReason,
  type ClientMessage,
  type DeclaredResult,
  type Identity,
  type LobbyErrorCode,
  type MatchEndView,
  type MatchStartInfo,
  type MatchStatus,
  type RoomClosedReason,
  type RoomRules,
  type ServerMessage,
} from './protocol.ts';
import {
  buildRecord,
  createTracker,
  declare,
  settle,
  type MatchRecord,
  type MatchTracker,
} from './results.ts';
import {
  buildLaunch,
  canStart,
  createRoom,
  join,
  kick,
  leave,
  roomView,
  setConnected,
  setFighter,
  setReady,
  setRules,
  setTeam,
  type LobbyContent,
  type Outcome,
  type Room,
} from './room.ts';

/** Côté serveur d'une connexion. `send` reçoit un message JSON déjà sérialisé. */
export interface LobbyConnection {
  send(text: string): void;
  /** Ferme la connexion ; l'hôte appelle ensuite `LobbyPeer.closed`. */
  close(reason: string): void;
}

/** Ce que l'hôte signale au lobby pour une connexion. */
export interface LobbyPeer {
  receive(text: string): void;
  closed(): void;
}

/** Identité tirée d'un ticket vérifié (audience « lobby »). */
export interface TicketIdentity extends Identity {
  /** Identifiant unique du ticket, pour refuser un rejeu. */
  readonly jti: string;
}

export interface QuickMatchSettings {
  readonly groupSize: number;
  readonly minPlayers: number;
  readonly maxWaitMs: number;
  readonly maxRttMs: number;
  readonly countdownMs: number;
  readonly rules: RoomRules;
}

export interface LobbyLimits {
  readonly helloTimeoutMs: number;
  readonly silenceMs: number;
  /** Délai de grâce d'un membre déconnecté dans un salon. */
  readonly graceMs: number;
  readonly messages: BucketRule;
  readonly maxConnectionsPerAddress: number;
  readonly maxConnections: number;
  readonly maxRooms: number;
  readonly roomCreations: BucketRule;
  readonly failedJoinsPerMinute: BucketRule;
  readonly failedJoinsPerHour: BucketRule;
  readonly queueOps: BucketRule;
  readonly ticketReplayMs: number;
  /** Délai pour que tous les joueurs rejoignent le relais. */
  readonly joinTimeoutMs: number;
  readonly resultTimeoutMs: number;
  readonly countdownMs: number;
  /** Durée maximale d'un match sans limite de temps, et marge au-delà de la limite. */
  readonly untimedMatchMs: number;
  readonly matchMarginMs: number;
}

export const DEFAULT_LIMITS: LobbyLimits = {
  helloTimeoutMs: 5_000,
  silenceMs: 30_000,
  graceMs: 30_000,
  messages: { capacity: 20, refillMs: 200 },
  maxConnectionsPerAddress: 16,
  maxConnections: 5_000,
  maxRooms: 2_000,
  roomCreations: { capacity: 5, refillMs: 12_000 },
  failedJoinsPerMinute: { capacity: 10, refillMs: 6_000 },
  failedJoinsPerHour: { capacity: 60, refillMs: 60_000 },
  queueOps: { capacity: 10, refillMs: 6_000 },
  ticketReplayMs: 70_000,
  joinTimeoutMs: 20_000,
  resultTimeoutMs: 15_000,
  countdownMs: 3_000,
  untimedMatchMs: 30 * 60_000,
  matchMarginMs: 5 * 60_000,
};

export const DEFAULT_QUICK: QuickMatchSettings = {
  groupSize: 4,
  minPlayers: 2,
  maxWaitMs: 20_000,
  maxRttMs: 250,
  countdownMs: 5_000,
  rules: rulesOf(defaultMatchConfig('stock', 2)),
};

export interface LobbyOptions {
  readonly now: () => number;
  /** Relais en mode réservé, dans le même processus. */
  readonly relay: Relay;
  /** Chemin du relais transmis aux clients (« /net »). */
  readonly relayPath: string;
  /** Vérifie un ticket (audience « lobby ») ; le rejeu est refusé par le lobby. */
  readonly verifyTicket: (ticket: string) => TicketIdentity | null;
  readonly content: LobbyContent;
  readonly regions?: readonly string[];
  readonly quick?: Partial<QuickMatchSettings>;
  readonly limits?: Partial<LobbyLimits>;
  /** Entier uniforme dans `[0, max)` ; `crypto.randomInt` en production. */
  readonly random: (max: number) => number;
  /** UUID v4 ; `crypto.randomUUID` en production. */
  readonly uuid: () => string;
  /** Point d'extension pour le classement : appelé à la fin de chaque match. */
  readonly onMatchResult?: (record: MatchRecord) => void;
  /** Journal : jamais de ticket, de pseudo ni d'adresse. */
  readonly log?: (message: string) => void;
}

export interface Lobby {
  /** Nouvelle connexion ; `address` ne sert qu'aux limites par adresse. */
  connect(conn: LobbyConnection, address: string): LobbyPeer;
  /** À appeler souvent (toutes les 100 ms) : délais, file, comptes à rebours, échéances. */
  tick(): void;
  /** Événement du relais (`RelayOptions.onGameEvent`). */
  relayEvent(event: RelayGameEvent): void;
  /** Désynchronisation signalée par le relais (`RelayOptions.onDesync`). */
  relayDesync(gameId: string): void;
  stats(): { connections: number; rooms: number; queued: number; playing: number };
}

interface Session {
  readonly conn: LobbyConnection;
  readonly address: string;
  readonly openedAt: number;
  identity: Identity | null;
  lastHeard: number;
  invalidStreak: number;
  rttMs: number | null;
  open: boolean;
}

interface ActiveMatch {
  readonly room: Room;
  readonly tracker: MatchTracker;
  readonly starts: Map<string, MatchStartInfo>;
  readonly deadline: number;
}

interface RoomState {
  readonly room: Room;
  countdownAt: number;
  match: ActiveMatch | null;
}

const GAME_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function createLobby(options: LobbyOptions): Lobby {
  const { now, relay, content } = options;
  const limits: LobbyLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const quick: QuickMatchSettings = { ...DEFAULT_QUICK, ...options.quick };
  const regions = options.regions ?? ['eu'];
  const log = options.log ?? (() => {});
  const privateRules = rulesOf(defaultMatchConfig('stock', 2));

  const sessions = new Set<Session>();
  /** Connexion active de chaque compte. */
  const accounts = new Map<string, Session>();
  /** Salon de chaque compte (même déconnecté pendant son délai de grâce). */
  const memberships = new Map<string, RoomState>();
  const rooms = new Set<RoomState>();
  const byCode = new Map<string, RoomState>();
  const matches = new Map<string, ActiveMatch>();
  const addresses = createAddressCounter(limits.maxConnectionsPerAddress);
  const replay = createReplayGuard(limits.ticketReplayMs, now);
  const messageBuckets = createBuckets(limits.messages, now);
  const creations = createBuckets(limits.roomCreations, now);
  const joinsMinute = createBuckets(limits.failedJoinsPerMinute, now);
  const joinsHour = createBuckets(limits.failedJoinsPerHour, now);
  const queueOps = createBuckets(limits.queueOps, now);
  const matchmaker = createMatchmaker({
    regions,
    groupSize: quick.groupSize,
    minPlayers: quick.minPlayers,
    maxWaitMs: quick.maxWaitMs,
    maxRttMs: quick.maxRttMs,
  });
  let sessionCounter = 0;
  const sessionKeys = new WeakMap<Session, string>();

  // ── Envois ────────────────────────────────────────────────────────────────────────────────

  function send(session: Session | undefined, message: ServerMessage): void {
    if (session === undefined || !session.open) return;
    session.conn.send(JSON.stringify(message));
  }

  function sendTo(accountId: string, message: ServerMessage): void {
    send(accounts.get(accountId), message);
  }

  function error(session: Session, code: LobbyErrorCode, message: string): void {
    send(session, { t: 'error', code, message });
  }

  function reply(session: Session, outcome: Outcome): boolean {
    if (!outcome.ok) error(session, outcome.code, outcome.message);
    return outcome.ok;
  }

  function bye(session: Session, reason: ByeReason): void {
    send(session, { t: 'bye', reason });
    session.conn.close(reason);
    closed(session, reason === 'replaced');
  }

  function broadcast(state: RoomState): void {
    const view = roomView(state.room);
    for (const id of state.room.members.keys()) sendTo(id, { t: 'room', room: view });
  }

  // ── Salons ────────────────────────────────────────────────────────────────────────────────

  function addRoom(room: Room): RoomState {
    const state: RoomState = { room, countdownAt: Number.NaN, match: null };
    rooms.add(state);
    if (room.code !== null) byCode.set(room.code, state);
    return state;
  }

  function removeRoom(state: RoomState): void {
    rooms.delete(state);
    if (state.room.code !== null) byCode.delete(state.room.code);
  }

  /** Retire un membre de son salon ; supprime le salon vide (sauf match en cours). */
  function removeMember(state: RoomState, id: string, reason: RoomClosedReason): void {
    memberships.delete(id);
    const outcome = leave(state.room, id);
    sendTo(id, { t: 'roomClosed', reason });
    cancelCountdown(state, 'Un joueur est parti : lancement annulé.');
    if (outcome.empty && state.match === null) {
      removeRoom(state);
      return;
    }
    broadcast(state);
  }

  function enter(session: Session, state: RoomState): void {
    const id = session.identity!.id;
    memberships.set(id, state);
    matchmaker.leave(id);
    const m = state.room.members.get(id);
    if (m !== undefined) m.rttMs = session.rttMs;
    broadcast(state);
  }

  function uniqueCode(): string | null {
    for (let i = 0; i < 20; i++) {
      const code = drawCode(options.random);
      if (!byCode.has(code)) return code;
    }
    return null;
  }

  function createPrivate(session: Session, capacity: number): void {
    const who = session.identity!;
    if (memberships.has(who.id)) {
      error(session, 'already_in_room', 'Quittez d’abord votre salon.');
      return;
    }
    if (!creations.take(who.id)) {
      error(session, 'rate_limited', 'Trop de salons créés : attendez un peu.');
      return;
    }
    const code = rooms.size < limits.maxRooms ? uniqueCode() : null;
    if (code === null) {
      error(session, 'server_full', 'Le serveur n’accepte plus de nouveau salon.');
      return;
    }
    const room = createRoom({
      code,
      kind: 'private',
      region: regions[0]!,
      capacity,
      rules: privateRules,
      stage: RANDOM,
    });
    join(room, who);
    enter(session, addRoom(room));
    log(`salon ${code.slice(0, 2)}… créé`);
  }

  function joinByCode(session: Session, raw: string): void {
    const who = session.identity!;
    if (memberships.has(who.id)) {
      error(session, 'already_in_room', 'Quittez d’abord votre salon.');
      return;
    }
    const addressKey = `@${session.address}`;
    const keys = [who.id, addressKey];
    // Limite vérifiée avant de chercher : un essai de trop ne dit pas si le code existe.
    if (keys.some((k) => !joinsMinute.peek(k) || !joinsHour.peek(k))) {
      error(session, 'rate_limited', 'Trop de codes faux : attendez avant de réessayer.');
      return;
    }
    const code = normalizeCode(raw);
    const state = code === null ? undefined : byCode.get(code);
    if (state === undefined) {
      for (const k of keys) {
        joinsMinute.take(k);
        joinsHour.take(k);
      }
      error(session, 'not_found', 'Aucun salon ne porte ce code.');
      return;
    }
    if (!reply(session, join(state.room, who))) return;
    enter(session, state);
  }

  function leaveRoom(session: Session): void {
    const id = session.identity!.id;
    const state = memberships.get(id);
    if (state === undefined) {
      error(session, 'not_in_room', 'Vous n’êtes dans aucun salon.');
      return;
    }
    removeMember(state, id, 'left');
  }

  // ── Lancement ─────────────────────────────────────────────────────────────────────────────

  function startCountdown(state: RoomState, ms: number): void {
    state.room.phase = 'countdown';
    state.countdownAt = now() + ms;
    const seconds = Math.ceil(ms / 1000);
    for (const id of state.room.members.keys()) sendTo(id, { t: 'countdown', seconds });
    broadcast(state);
  }

  function cancelCountdown(state: RoomState, why: string): void {
    if (state.room.phase !== 'countdown') return;
    state.room.phase = 'lobby';
    state.countdownAt = Number.NaN;
    for (const id of state.room.members.keys())
      sendTo(id, { t: 'error', code: 'not_ready', message: why });
    broadcast(state);
  }

  /** Démarre automatiquement un salon rapide dont tout le monde est prêt. */
  function maybeAutoStart(state: RoomState): void {
    if (state.room.kind === 'quick' && canStart(state.room, null).ok) {
      startCountdown(state, quick.countdownMs);
    }
  }

  function newGameId(): string {
    let id = '';
    for (let i = 0; i < 16; i++) id += GAME_ID_CHARS[options.random(GAME_ID_CHARS.length)];
    return id;
  }

  function launch(state: RoomState): void {
    const room = state.room;
    state.countdownAt = Number.NaN;
    // Les conditions sont revérifiées au moment de partir (phase « salon » le temps du contrôle).
    room.phase = 'lobby';
    const check = canStart(room, room.host);
    if (!check.ok) {
      room.phase = 'lobby';
      for (const id of room.members.keys())
        sendTo(id, { t: 'error', code: check.code, message: check.message });
      broadcast(state);
      return;
    }
    const plan = buildLaunch(room, content, options.random);
    const gameId = newGameId();
    const seats = plan.players.map((p) => p.id);
    if (!relay.reserve(gameId, { seats, expiresInMs: limits.joinTimeoutMs })) {
      room.phase = 'lobby';
      for (const id of seats)
        sendTo(id, { t: 'error', code: 'server_full', message: 'Le relais est plein.' });
      broadcast(state);
      return;
    }
    const t = now();
    const tracker = createTracker({
      matchId: options.uuid(),
      gameId,
      kind: room.kind,
      region: room.region,
      config: plan.config,
      stage: plan.stage,
      startedAt: t,
      players: plan.players,
    });
    const starts = new Map<string, MatchStartInfo>();
    plan.players.forEach((p, slot) => {
      starts.set(p.id, {
        gameId,
        relayPath: options.relayPath,
        slot,
        config: plan.config,
        stage: plan.stage,
        players: plan.players,
      });
    });
    const limit = plan.config.timeLimit > 0 ? plan.config.timeLimit * 1000 : limits.untimedMatchMs;
    const match: ActiveMatch = {
      room,
      tracker,
      starts,
      deadline: t + limits.joinTimeoutMs + limit + limits.matchMarginMs,
    };
    state.match = match;
    matches.set(gameId, match);
    room.phase = 'playing';
    room.gameId = gameId;
    for (const [id, info] of starts) sendTo(id, { t: 'matchStart', match: info });
    broadcast(state);
    log(`partie lancée : ${plan.players.length} joueurs (${room.kind})`);
  }

  function stateOf(match: ActiveMatch): RoomState | undefined {
    for (const s of rooms) if (s.match === match) return s;
    return undefined;
  }

  /** Fin d'un match, quelle qu'en soit l'issue : relais fermé, salon rendu, classement prévenu. */
  function finish(
    match: ActiveMatch,
    status: MatchStatus,
    result: DeclaredResult | null,
    message: string,
  ): void {
    const gameId = match.tracker.gameId;
    if (matches.get(gameId) !== match) return;
    matches.delete(gameId);
    relay.cancel(gameId, 'Le match est terminé.');
    const t = now();
    if (status !== 'cancelled') {
      const record = buildRecord(match.tracker, status, result, t);
      try {
        options.onMatchResult?.(record);
      } catch (e) {
        log(`onMatchResult a levé une erreur : ${e instanceof Error ? e.message : 'inconnue'}`);
      }
    }
    const end: MatchEndView = {
      gameId,
      status,
      result: status === 'agreed' ? result : null,
      message,
    };
    log(`partie terminée : ${status}`);
    const state = stateOf(match);
    if (state === undefined) return;
    state.match = null;
    const room = state.room;
    room.phase = 'lobby';
    room.gameId = null;
    room.lastEnd = end;
    for (const m of room.members.values()) {
      m.ready = false;
      // Un membre resté déconnecté pendant le match a de nouveau tout son délai de grâce.
      if (!m.connected) m.disconnectedAt = t;
    }
    if (room.members.size === 0) {
      removeRoom(state);
      return;
    }
    for (const id of room.members.keys()) sendTo(id, { t: 'matchEnd', end });
    broadcast(state);
  }

  function trySettle(match: ActiveMatch): void {
    const s = settle(match.tracker, now(), limits.resultTimeoutMs);
    if (s === null) return;
    if (s.status === 'agreed')
      finish(match, 'agreed', s.result, 'Résultat accepté par tous les joueurs.');
    else finish(match, 'contested', null, s.message);
  }

  // ── Partie rapide ─────────────────────────────────────────────────────────────────────────

  function queue(session: Session, region: string, fighter: string): void {
    const who = session.identity!;
    if (memberships.has(who.id)) {
      error(session, 'already_in_room', 'Quittez d’abord votre salon.');
      return;
    }
    if (!queueOps.take(who.id)) {
      error(session, 'rate_limited', 'Trop d’entrées dans la file : attendez un peu.');
      return;
    }
    if (fighter !== RANDOM && !content.fighters.includes(fighter)) {
      error(session, 'invalid_fighter', 'Ce personnage n’existe pas.');
      return;
    }
    if (!reply(session, matchmaker.join(who.id, region, fighter, session.rttMs, now()))) return;
    send(session, { t: 'queued', region, waiting: matchmaker.waiting(region) });
  }

  function formQuickRoom(group: QueueEntry[]): void {
    const room = createRoom({
      code: null,
      kind: 'quick',
      region: group[0]!.region,
      capacity: quick.groupSize,
      rules: quick.rules,
      stage: RANDOM,
    });
    const state = addRoom(room);
    for (const entry of group) {
      const session = accounts.get(entry.id);
      if (session?.identity == null) continue;
      join(room, session.identity);
      setFighter(room, entry.id, entry.fighter, content);
      setReady(room, entry.id, true);
      memberships.set(entry.id, state);
      room.members.get(entry.id)!.rttMs = session.rttMs;
    }
    if (room.members.size < 2) {
      // Quelqu'un est parti entre-temps : les autres retournent dans la file.
      for (const id of [...room.members.keys()]) {
        memberships.delete(id);
        const e = group.find((g) => g.id === id)!;
        matchmaker.join(id, e.region, e.fighter, null, e.since);
        sendTo(id, { t: 'queued', region: e.region, waiting: matchmaker.waiting(e.region) });
      }
      removeRoom(state);
      return;
    }
    startCountdown(state, quick.countdownMs);
  }

  // ── Messages ──────────────────────────────────────────────────────────────────────────────

  function hello(session: Session, m: Extract<ClientMessage, { t: 'hello' }>): void {
    if (m.version !== LOBBY_PROTOCOL_VERSION) {
      error(
        session,
        'version',
        `Version du lobby ${m.version} ; le serveur parle la ${LOBBY_PROTOCOL_VERSION}.`,
      );
      bye(session, 'invalid');
      return;
    }
    const identity = options.verifyTicket(m.ticket);
    if (identity === null || !replay.first(identity.jti)) {
      error(session, 'ticket', 'Ticket refusé : reconnectez-vous.');
      bye(session, 'invalid');
      return;
    }
    const who: Identity = { id: identity.id, name: identity.name, guest: identity.guest };
    const previous = accounts.get(who.id);
    if (previous !== undefined) bye(previous, 'replaced');
    session.identity = who;
    accounts.set(who.id, session);
    send(session, {
      t: 'welcome',
      you: who,
      content: { fighters: content.fighters, stages: content.stages },
      regions,
      quickRules: quick.rules,
    });
    const state = memberships.get(who.id);
    if (state !== undefined) {
      setConnected(state.room, who.id, true, now());
      const member = state.room.members.get(who.id);
      if (member !== undefined) member.name = who.name;
      broadcast(state);
      const start = state.match?.starts.get(who.id);
      if (start !== undefined) send(session, { t: 'matchStart', match: start });
    }
    const queued = matchmaker.entry(who.id);
    if (queued !== undefined)
      send(session, {
        t: 'queued',
        region: queued.region,
        waiting: matchmaker.waiting(queued.region),
      });
  }

  function handle(session: Session, m: ClientMessage): void {
    if (m.t === 'ping') {
      if (m.rtt !== undefined) {
        session.rttMs = m.rtt;
        const id = session.identity?.id;
        const member = id === undefined ? undefined : memberships.get(id)?.room.members.get(id);
        if (member !== undefined) member.rttMs = m.rtt;
      }
      send(session, { t: 'pong', time: m.time });
      return;
    }
    if (session.identity === null) {
      if (m.t === 'hello') hello(session, m);
      else {
        error(session, 'unauthenticated', 'Présentez-vous d’abord (hello).');
        bye(session, 'invalid');
      }
      return;
    }
    const id = session.identity.id;
    const state = memberships.get(id);
    const inRoom = (): RoomState | null => {
      if (state === undefined) error(session, 'not_in_room', 'Vous n’êtes dans aucun salon.');
      return state ?? null;
    };
    switch (m.t) {
      case 'hello':
        error(session, 'bad_request', 'Déjà présenté.');
        return;
      case 'createRoom':
        createPrivate(session, m.capacity ?? 8);
        return;
      case 'joinRoom':
        joinByCode(session, m.code);
        return;
      case 'leaveRoom':
        leaveRoom(session);
        return;
      case 'setFighter': {
        const s = inRoom();
        if (s !== null && reply(session, setFighter(s.room, id, m.fighter, content))) broadcast(s);
        return;
      }
      case 'setTeam': {
        const s = inRoom();
        if (s !== null && reply(session, setTeam(s.room, id, m.team))) broadcast(s);
        return;
      }
      case 'setReady': {
        const s = inRoom();
        if (s !== null && reply(session, setReady(s.room, id, m.ready))) {
          broadcast(s);
          maybeAutoStart(s);
        }
        return;
      }
      case 'setRules': {
        const s = inRoom();
        if (s !== null && reply(session, setRules(s.room, id, m, content))) broadcast(s);
        return;
      }
      case 'kick': {
        const s = inRoom();
        if (s === null) return;
        if (reply(session, kick(s.room, id, m.player))) {
          // `kick` a déjà retiré le membre du salon.
          memberships.delete(m.player);
          sendTo(m.player, { t: 'roomClosed', reason: 'kicked' });
          broadcast(s);
        }
        return;
      }
      case 'start': {
        const s = inRoom();
        if (s !== null && reply(session, canStart(s.room, id)))
          startCountdown(s, limits.countdownMs);
        return;
      }
      case 'queue':
        queue(session, m.region, m.fighter);
        return;
      case 'leaveQueue':
        if (matchmaker.leave(id)) send(session, { t: 'unqueued' });
        return;
      case 'result': {
        const match = matches.get(m.gameId);
        if (match === undefined) {
          error(session, 'not_in_match', 'Ce match n’est pas en cours.');
          return;
        }
        if (reply(session, declare(match.tracker, id, m.result, now()))) trySettle(match);
        return;
      }
    }
  }

  // ── Connexions ────────────────────────────────────────────────────────────────────────────

  /** Fin d'une connexion. `replaced` : le compte s'est reconnecté ailleurs, rien ne change. */
  function closed(session: Session, replaced = false): void {
    if (!session.open) return;
    session.open = false;
    sessions.delete(session);
    addresses.close(session.address);
    const who = session.identity;
    if (who === null || accounts.get(who.id) !== session) return;
    accounts.delete(who.id);
    if (replaced) return;
    matchmaker.leave(who.id);
    const state = memberships.get(who.id);
    if (state === undefined) return;
    setConnected(state.room, who.id, false, now());
    cancelCountdown(state, `${who.name} s’est déconnecté : lancement annulé.`);
    broadcast(state);
  }

  return {
    connect(conn, address) {
      const session: Session = {
        conn,
        address,
        openedAt: now(),
        identity: null,
        lastHeard: now(),
        invalidStreak: 0,
        rttMs: null,
        open: true,
      };
      sessionKeys.set(session, `s${sessionCounter++}`);
      if (sessions.size >= limits.maxConnections || !addresses.open(address)) {
        conn.send(JSON.stringify({ t: 'bye', reason: 'rate_limited' } satisfies ServerMessage));
        conn.close('rate_limited');
        session.open = false;
        return { receive() {}, closed() {} };
      }
      sessions.add(session);
      return {
        receive(text) {
          if (!session.open) return;
          session.lastHeard = now();
          if (!messageBuckets.take(sessionKeys.get(session)!)) {
            bye(session, 'rate_limited');
            return;
          }
          const parsed = parseClientMessage(text);
          if (!parsed.ok) {
            error(session, 'bad_request', `Message refusé : ${parsed.error}.`);
            if (++session.invalidStreak >= 3) bye(session, 'invalid');
            return;
          }
          session.invalidStreak = 0;
          handle(session, parsed.message);
        },
        closed() {
          closed(session);
        },
      };
    },

    tick() {
      const t = now();
      for (const session of [...sessions]) {
        if (session.identity === null && t - session.openedAt > limits.helloTimeoutMs) {
          bye(session, 'timeout');
        } else if (t - session.lastHeard > limits.silenceMs) {
          bye(session, 'timeout');
        }
      }
      for (const state of [...rooms]) {
        const room = state.room;
        if (room.phase === 'countdown' && t >= state.countdownAt) launch(state);
        if (room.phase === 'lobby') {
          for (const m of [...room.members.values()]) {
            if (!m.connected && t - m.disconnectedAt >= limits.graceMs) {
              removeMember(state, m.id, 'expired');
            }
          }
        }
      }
      for (const match of [...matches.values()]) {
        if (t >= match.deadline)
          finish(match, 'abandoned', null, 'Le match a dépassé sa durée maximale.');
        else if (match.tracker.declarations.size > 0) trySettle(match);
      }
      for (const group of matchmaker.poll(t)) formQuickRoom(group);
    },

    relayEvent(event) {
      const match = matches.get(event.gameId);
      if (match === undefined) return;
      switch (event.type) {
        case 'started':
          return;
        case 'left':
          match.tracker.leftAt[event.slot] = event.frame;
          trySettle(match);
          return;
        case 'rejoined':
          match.tracker.leftAt[event.slot] = null;
          return;
        case 'closed':
          if (event.reason === 'expired') {
            finish(
              match,
              'cancelled',
              null,
              'Tous les joueurs n’ont pas rejoint la partie à temps.',
            );
          } else if (match.tracker.declarations.size > 0) {
            // Plus personne au relais : les déclarations reçues décident.
            for (let s = 0; s < match.tracker.leftAt.length; s++) {
              match.tracker.leftAt[s] ??= -1;
            }
            const s = settle(match.tracker, now(), 0);
            if (s?.status === 'agreed') finish(match, 'agreed', s.result, 'Résultat accepté.');
            else
              finish(
                match,
                'contested',
                null,
                s?.status === 'contested' ? s.message : 'Résultat incomplet.',
              );
          } else {
            finish(match, 'abandoned', null, 'Tous les joueurs ont quitté la partie.');
          }
          return;
      }
    },

    relayDesync(gameId) {
      const match = matches.get(gameId);
      if (match !== undefined) match.tracker.desynced = true;
    },

    stats() {
      let queued = 0;
      for (const r of regions) queued += matchmaker.waiting(r);
      return { connections: sessions.size, rooms: rooms.size, queued, playing: matches.size };
    },
  };
}
