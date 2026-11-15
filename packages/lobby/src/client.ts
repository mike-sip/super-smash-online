/**
 * Client du lobby (SPEC-lobby.md, « API publique ») : connexion WebSocket, présentation par un
 * ticket frais, état observable, commandes, reconnexion automatique. Pour le navigateur et Node
 * (WebSocket natif) ; aucun import Node. Ne lève jamais d'exception : les refus du serveur et les
 * pannes arrivent dans `state.error`.
 */
import type { MatchResult } from '@game/match-rules';
import {
  LOBBY_PROTOCOL_VERSION,
  parseServerMessage,
  type ClientMessage,
  type DeclaredResult,
  type Identity,
  type LobbyErrorCode,
  type MatchEndView,
  type MatchStartInfo,
  type RoomRules,
  type RoomView,
} from './protocol.ts';

/** Ce que le client utilise d'un WebSocket (celui du navigateur ou de Node, ou un faux en test). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type LobbyStatus = 'connecting' | 'online' | 'offline' | 'closed';

export interface LobbyError {
  readonly code: LobbyErrorCode | 'network' | 'replaced';
  readonly message: string;
}

export interface LobbyState {
  readonly status: LobbyStatus;
  readonly you: Identity | null;
  readonly content: { readonly fighters: readonly string[]; readonly stages: readonly string[] };
  readonly regions: readonly string[];
  readonly quickRules: RoomRules | null;
  readonly room: RoomView | null;
  readonly queue: { readonly region: string; readonly waiting: number } | null;
  /** Secondes annoncées par le dernier compte à rebours, ou `null`. */
  readonly countdown: number | null;
  /** Partie en cours, ou `null`. */
  readonly match: MatchStartInfo | null;
  readonly lastEnd: MatchEndView | null;
  readonly error: LobbyError | null;
  readonly rttMs: number | null;
}

export interface LobbyClientOptions {
  /** `ws(s)://hôte/lobby`. */
  readonly url: string;
  /** Ticket « lobby » frais (`AccountsClient.ticket('lobby')`), ou `null` en cas d'échec. */
  readonly getTicket: () => Promise<string | null>;
  readonly now: () => number;
  readonly WebSocket?: new (url: string) => SocketLike;
  readonly timers?: {
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
}

export interface LobbyClient {
  readonly state: LobbyState;
  onChange(listener: (state: LobbyState) => void): () => void;
  /** À chaque `matchStart` reçu, y compris celui renvoyé après une reconnexion. */
  onMatchStart(listener: (match: MatchStartInfo) => void): () => void;
  createRoom(capacity?: number): void;
  joinRoom(code: string): void;
  leaveRoom(): void;
  setFighter(fighter: string): void;
  setTeam(team: number): void;
  setReady(ready: boolean): void;
  setRules(change: {
    rules?: RoomRules;
    stage?: string;
    capacity?: number;
    locked?: boolean;
  }): void;
  kick(player: string): void;
  start(): void;
  queue(region: string, fighter: string): void;
  leaveQueue(): void;
  reportResult(gameId: string, result: MatchResult | DeclaredResult): void;
  close(): void;
}

const PING_MS = 5_000;
const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;
const OPEN = 1;

/** La partie déclarée d'un `MatchResult` (les champs en plus, comme `config`, sont retirés). */
export function declaredResult(result: MatchResult | DeclaredResult): DeclaredResult {
  return {
    endFrame: result.endFrame,
    reason: result.reason,
    winners: [...result.winners],
    winningTeam: result.winningTeam,
    players: result.players.map((p) => ({
      team: p.team,
      placement: p.placement,
      kos: p.kos,
      falls: p.falls,
      selfDestructs: p.selfDestructs,
      score: p.score,
      damageDealt: p.damageDealt,
      damageTaken: p.damageTaken,
      stocksLeft: p.stocksLeft,
      ultimatesUsed: p.ultimatesUsed,
      eliminatedAt: p.eliminatedAt,
    })),
  };
}

export function createLobbyClient(options: LobbyClientOptions): LobbyClient {
  const Socket =
    options.WebSocket ?? (globalThis.WebSocket as unknown as new (url: string) => SocketLike);
  const timers = options.timers ?? {
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h: unknown) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const changeListeners = new Set<(state: LobbyState) => void>();
  const matchListeners = new Set<(match: MatchStartInfo) => void>();

  let state: LobbyState = {
    status: 'connecting',
    you: null,
    content: { fighters: [], stages: [] },
    regions: [],
    quickRules: null,
    room: null,
    queue: null,
    countdown: null,
    match: null,
    lastEnd: null,
    error: null,
    rttMs: null,
  };
  let socket: SocketLike | null = null;
  let closedByUser = false;
  let backoff = MIN_BACKOFF_MS;
  let retryTimer: unknown = null;
  let pingTimer: unknown = null;
  const rtts: number[] = [];

  function update(changes: Partial<LobbyState>): void {
    state = { ...state, ...changes };
    for (const l of changeListeners) {
      try {
        l(state);
      } catch {
        // Un écouteur fautif ne doit pas casser le client.
      }
    }
  }

  function median(): number | null {
    if (rtts.length === 0) return null;
    const sorted = [...rtts].sort((a, b) => a - b);
    return Math.round(sorted[sorted.length >> 1]!);
  }

  function send(message: ClientMessage): void {
    if (socket === null || socket.readyState !== OPEN) {
      update({ error: { code: 'network', message: 'Pas de connexion au serveur.' } });
      return;
    }
    socket.send(JSON.stringify(message));
  }

  function ping(): void {
    if (socket !== null && socket.readyState === OPEN) {
      const rtt = median();
      socket.send(
        JSON.stringify(
          rtt === null
            ? { t: 'ping', time: options.now() }
            : { t: 'ping', time: options.now(), rtt },
        ),
      );
    }
    pingTimer = timers.setTimeout(ping, PING_MS);
  }

  function stopTimers(): void {
    if (pingTimer !== null) timers.clearTimeout(pingTimer);
    if (retryTimer !== null) timers.clearTimeout(retryTimer);
    pingTimer = null;
    retryTimer = null;
  }

  function scheduleRetry(): void {
    if (closedByUser || retryTimer !== null) return;
    const delay = backoff;
    backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      void open();
    }, delay);
  }

  function receive(data: unknown): void {
    const parsed = parseServerMessage(data);
    if (!parsed.ok) return;
    const m = parsed.message;
    switch (m.t) {
      case 'welcome':
        backoff = MIN_BACKOFF_MS;
        update({
          status: 'online',
          you: m.you,
          content: m.content,
          regions: m.regions,
          quickRules: m.quickRules,
          error: null,
        });
        break;
      case 'pong':
        rtts.push(options.now() - m.time);
        if (rtts.length > 5) rtts.shift();
        update({ rttMs: median() });
        break;
      case 'room':
        update({
          room: m.room,
          queue: null,
          countdown: m.room.phase === 'countdown' ? state.countdown : null,
          match: m.room.phase === 'playing' ? state.match : null,
          lastEnd: m.room.lastEnd ?? state.lastEnd,
        });
        break;
      case 'roomClosed':
        update({
          room: null,
          match: null,
          countdown: null,
          error:
            m.reason === 'kicked'
              ? { code: 'banned', message: 'Vous avez été expulsé du salon.' }
              : m.reason === 'expired'
                ? {
                    code: 'not_in_room',
                    message: 'Vous avez été retiré du salon après une longue absence.',
                  }
                : state.error,
        });
        break;
      case 'queued':
        update({ queue: { region: m.region, waiting: m.waiting } });
        break;
      case 'unqueued':
        update({ queue: null });
        break;
      case 'countdown':
        update({ countdown: m.seconds });
        break;
      case 'matchStart':
        update({ match: m.match, queue: null, countdown: null });
        for (const l of matchListeners) {
          try {
            l(m.match);
          } catch {
            // idem
          }
        }
        break;
      case 'matchEnd':
        update({ match: null, lastEnd: m.end });
        break;
      case 'error':
        update({ error: { code: m.code, message: m.message } });
        break;
      case 'bye':
        if (m.reason === 'replaced') {
          closedByUser = true;
          update({
            status: 'closed',
            error: { code: 'replaced', message: 'Le jeu a été ouvert ailleurs avec ce compte.' },
          });
        }
        break;
    }
  }

  async function open(): Promise<void> {
    if (closedByUser) return;
    update({ status: state.status === 'online' ? 'offline' : state.status });
    let ticket: string | null = null;
    try {
      ticket = await options.getTicket();
    } catch {
      ticket = null;
    }
    if (closedByUser) return;
    if (ticket === null) {
      update({
        status: 'offline',
        error: {
          code: 'network',
          message: 'Impossible d’obtenir un ticket du serveur des comptes.',
        },
      });
      scheduleRetry();
      return;
    }
    let ws: SocketLike;
    try {
      ws = new Socket(options.url);
    } catch {
      update({ status: 'offline', error: { code: 'network', message: 'Connexion impossible.' } });
      scheduleRetry();
      return;
    }
    socket = ws;
    const helloTicket = ticket;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hello', version: LOBBY_PROTOCOL_VERSION, ticket: helloTicket }));
      if (pingTimer === null) ping();
    };
    ws.onmessage = (event) => {
      if (socket === ws) receive(event.data);
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      if (pingTimer !== null) timers.clearTimeout(pingTimer);
      pingTimer = null;
      if (closedByUser) {
        if (state.status !== 'closed') update({ status: 'closed' });
        return;
      }
      update({ status: 'offline' });
      scheduleRetry();
    };
  }

  void open();

  return {
    get state() {
      return state;
    },
    onChange(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    onMatchStart(listener) {
      matchListeners.add(listener);
      return () => matchListeners.delete(listener);
    },
    createRoom: (capacity) =>
      send(capacity === undefined ? { t: 'createRoom' } : { t: 'createRoom', capacity }),
    joinRoom: (code) => send({ t: 'joinRoom', code }),
    leaveRoom: () => send({ t: 'leaveRoom' }),
    setFighter: (fighter) => send({ t: 'setFighter', fighter }),
    setTeam: (team) => send({ t: 'setTeam', team }),
    setReady: (ready) => send({ t: 'setReady', ready }),
    setRules: (change) => send({ t: 'setRules', ...change }),
    kick: (player) => send({ t: 'kick', player }),
    start: () => send({ t: 'start' }),
    queue: (region, fighter) => send({ t: 'queue', region, fighter }),
    leaveQueue: () => send({ t: 'leaveQueue' }),
    reportResult: (gameId, result) => send({ t: 'result', gameId, result: declaredResult(result) }),
    close() {
      closedByUser = true;
      stopTimers();
      const ws = socket;
      if (ws !== null) ws.close(1000, 'fermé par le client');
      else update({ status: 'closed' });
    },
  };
}
