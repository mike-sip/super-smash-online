/**
 * Session client : connexion au relais, horloge, rollback, envoi des inputs, mesures.
 *
 * L'application appelle `update` à chaque image, dès la création (c'est aussi ce qui envoie les
 * pings pendant l'attente). Quand la partie est connue (`status` passe à « starting »), elle crée
 * son jeu et appelle `begin`. Le client n'a ni minuterie ni horloge propre : `now` est injecté.
 */
import {
  addClockSample,
  clockOffset,
  clockRtt,
  createClockEstimator,
  createGameClock,
  frameAt,
  frameFraction,
  gameTime,
} from './clock.ts';
import { MAX_CATCH_UP_FRAMES, MAX_FRAMES_PER_MESSAGE } from './constants.ts';
import type { RollbackGame } from './game.ts';
import {
  MAX_MESSAGE_BYTES,
  MSG_CHECKSUM,
  MSG_DESYNC,
  MSG_ERROR,
  MSG_HELLO,
  MSG_INPUT,
  MSG_INPUTS,
  MSG_LEFT,
  MSG_PING,
  MSG_PONG,
  MSG_START,
  MSG_WAITING,
  PROTOCOL_VERSION,
  createMessage,
  decode,
  encode,
} from './protocol.ts';
import { createRollback, type Rollback } from './rollback.ts';
import { localInputAt } from './timeline.ts';
import type { Transport } from './transport.ts';

export type NetStatus = 'connecting' | 'waiting' | 'starting' | 'running' | 'closed';

export interface MatchInfo {
  readonly seed: number;
  readonly players: number;
  /** Emplacements tenus par ce client, dans l'ordre de ses joueurs locaux. */
  readonly localSlots: readonly number[];
  readonly inputDelay: number;
  readonly maxPrediction: number;
  readonly checksumInterval: number;
  /** Instant de la frame 0, dans l'horloge du serveur. */
  readonly startAt: number;
}

export interface NetClientOptions {
  readonly transport: Transport;
  readonly gameId: string;
  /** Joueurs attendus dans la partie, de 2 à 8. */
  readonly players: number;
  /** Joueurs sur cette machine, de 1 à 4. */
  readonly localPlayers: number;
  /** Horloge en millisecondes : `performance.now` dans le navigateur, virtuelle en test. */
  readonly now: () => number;
  /** Ticket d'authentification (module `accounts`) ; absent pour un invité. */
  readonly ticket?: string;
}

export interface NetStats {
  frame: number;
  /** Première frame dont un input reste incertain. */
  confirmedFrame: number;
  /** Frame que dicte l'horloge ; au-dessus de `frame`, le client est en retard. */
  targetFrame: number;
  rttMs: number;
  rollbacks: number;
  maxRollback: number;
  meanRollback: number;
  /** Appels à `update` où le client a dû attendre faute d'inputs confirmés. */
  stalls: number;
  /** Inputs locaux remplacés par le serveur pour cause de retard. */
  lateInputs: number;
}

export interface NetClient {
  readonly status: NetStatus;
  /** Connue à partir de l'état « starting ». */
  readonly match: MatchInfo | null;
  /** Joueurs présents dans la partie pendant l'attente. */
  readonly joined: number;
  /** Raison de la fermeture, ou `null`. */
  readonly error: string | null;
  /** À appeler une fois, dès `match` connu, avec un jeu créé pour `match.players` et `match.seed`. */
  begin(game: RollbackGame): void;
  /**
   * À appeler à chaque image. Reçoit, corrige, puis avance jusqu'à la frame que dicte l'horloge.
   * `sample(out)` est appelé une fois par frame simulée et remplit `out[i]` pour le joueur local i.
   * `onFrame` est appelé après chaque frame nouvelle, jamais pendant une re-simulation : c'est là
   * qu'il faut appeler `Renderer.capture`. Renvoie la fraction de frame écoulée, de 0 à 1.
   */
  update(sample: (out: Uint32Array) => void, onFrame?: () => void): number;
  stats(): NetStats;
  onStatus(listener: (status: NetStatus) => void): () => void;
  onDesync(listener: (frame: number) => void): () => void;
  onPlayerLeft(listener: (slot: number, frame: number) => void): () => void;
  close(): void;
}

/** Pings pendant l'attente, puis pendant la partie. */
const PING_WAITING_MS = 100;
const PING_RUNNING_MS = 1000;
/** Sans rien de neuf, un `INPUT` part quand même à cet intervalle (accusés, renvoi). */
const INPUT_RESEND_MS = 100;

function listeners<T extends unknown[]>() {
  const set = new Set<(...args: T) => void>();
  return {
    add(l: (...args: T) => void): () => void {
      set.add(l);
      return () => set.delete(l);
    },
    emit(...args: T): void {
      for (const l of set) l(...args);
    },
  };
}

export function createNetClient(options: NetClientOptions): NetClient {
  const { transport, now } = options;
  const incoming = createMessage();
  const outgoing = createMessage();
  const buf = new Uint8Array(MAX_MESSAGE_BYTES);
  const estimator = createClockEstimator();
  const gameClock = createGameClock();
  const statusEvents = listeners<[NetStatus]>();
  const desyncEvents = listeners<[number]>();
  const leftEvents = listeners<[number, number]>();

  let status: NetStatus = 'connecting';
  let match: MatchInfo | null = null;
  let joined = 0;
  let error: string | null = null;
  let rollback: Rollback | null = null;
  let local = new Uint32Array(options.localPlayers);
  let lastPing = -Infinity;
  let lastInputSend = -Infinity;
  /** Du nouveau à envoyer : inputs locaux, ou accusés à faire avancer. */
  let dirty = false;
  let stalls = 0;
  let target = 0;

  function setStatus(next: NetStatus): void {
    if (status === next) return;
    status = next;
    statusEvents.emit(next);
  }

  function send(): void {
    transport.send(buf.subarray(0, encode(outgoing, buf)));
  }

  function ping(t: number): void {
    outgoing.type = MSG_PING;
    outgoing.clientTime = t;
    send();
    lastPing = t;
  }

  function shutdown(reason: string): void {
    if (status === 'closed') return;
    error ??= reason;
    setStatus('closed');
  }

  transport.onOpen(() => {
    outgoing.type = MSG_HELLO;
    outgoing.version = PROTOCOL_VERSION;
    outgoing.gameId = options.gameId;
    outgoing.players = options.players;
    outgoing.localPlayers = options.localPlayers;
    outgoing.ticket = options.ticket ?? '';
    send();
    ping(now());
    setStatus('waiting');
  });

  transport.onClose((reason) => shutdown(reason));

  transport.onMessage((data) => {
    if (status === 'closed') return;
    // Un message invalide du serveur est ignoré : ce que le client a de juste reste juste.
    if (decode(data, incoming) !== null) return;
    const m = incoming;
    switch (m.type) {
      case MSG_PONG:
        addClockSample(estimator, m.clientTime, m.serverTime, now());
        break;
      case MSG_WAITING:
        if (rollback !== null) break;
        joined = m.joined;
        match = null;
        setStatus('waiting');
        break;
      case MSG_START:
        if (rollback !== null || m.slotCount !== options.localPlayers) break;
        match = {
          seed: m.seed,
          players: m.players,
          localSlots: Array.from(m.slots.subarray(0, m.slotCount)),
          inputDelay: m.inputDelay,
          maxPrediction: m.maxPrediction,
          checksumInterval: m.checksumInterval,
          startAt: m.startAt,
        };
        joined = m.players;
        setStatus('starting');
        break;
      case MSG_INPUTS:
        if (rollback === null) break;
        for (let b = 0; b < m.blockCount; b++) {
          const player = m.blockPlayer[b]!;
          if (player >= rollback.timeline.players) continue;
          rollback.confirm(
            player,
            m.blockStart[b]!,
            m.blockInputs,
            b * MAX_FRAMES_PER_MESSAGE,
            m.blockLength[b]!,
          );
        }
        dirty = true;
        break;
      case MSG_DESYNC:
        desyncEvents.emit(m.frame);
        break;
      case MSG_LEFT:
        leftEvents.emit(m.slot, m.frame);
        break;
      case MSG_ERROR:
        error = m.text;
        transport.close();
        shutdown(m.text);
        break;
    }
  });

  /** Envoie les inputs locaux non accusés par le serveur, et les accusés de ce client. */
  function sendInputs(t: number): void {
    const r = rollback!;
    const tl = r.timeline;
    outgoing.type = MSG_INPUT;
    outgoing.players = tl.players;
    for (let p = 0; p < tl.players; p++) outgoing.acks[p] = tl.known[p]!;
    outgoing.blockCount = 0;
    for (let i = 0; i < tl.localSlots.length; i++) {
      const slot = tl.localSlots[i]!;
      const start = tl.known[slot]!;
      const end = Math.min(tl.localUpTo, start + MAX_FRAMES_PER_MESSAGE);
      const b = outgoing.blockCount++;
      outgoing.blockPlayer[b] = slot;
      outgoing.blockStart[b] = start;
      const n = end > start ? end - start : 0;
      outgoing.blockLength[b] = n;
      for (let k = 0; k < n; k++) {
        outgoing.blockInputs[b * MAX_FRAMES_PER_MESSAGE + k] = localInputAt(tl, slot, start + k);
      }
    }
    send();
    lastInputSend = t;
    dirty = false;
  }

  return {
    get status() {
      return status;
    },
    get match() {
      return match;
    },
    get joined() {
      return joined;
    },
    get error() {
      return error;
    },

    begin(game) {
      if (match === null) throw new Error('begin() avant que la partie soit connue.');
      if (rollback !== null) throw new Error('begin() appelé deux fois.');
      if (game.players !== match.players) {
        throw new Error(`Le jeu a ${game.players} joueurs, la partie ${match.players}.`);
      }
      local = new Uint32Array(match.localSlots.length);
      rollback = createRollback({
        game,
        localSlots: match.localSlots,
        inputDelay: match.inputDelay,
        maxPrediction: match.maxPrediction,
        checksumInterval: match.checksumInterval,
        onChecksum: (frame, value) => {
          outgoing.type = MSG_CHECKSUM;
          outgoing.frame = frame;
          outgoing.value = value;
          send();
        },
      });
    },

    update(sample, onFrame) {
      const t = now();
      if (status === 'closed' || status === 'connecting') return 0;
      if (t - lastPing >= (status === 'running' ? PING_RUNNING_MS : PING_WAITING_MS)) ping(t);
      if (rollback === null || match === null) return 0;
      const offset = clockOffset(estimator, t);
      if (Number.isNaN(offset)) return 0;
      const serverNow = gameTime(gameClock, offset, t);
      target = frameAt(serverNow, match.startAt);
      if (target < 0) return 0;
      setStatus('running');

      const r = rollback;
      r.reconcile();
      let steps = 0;
      while (r.frame() < target && steps < MAX_CATCH_UP_FRAMES) {
        if (!r.canAdvance()) {
          stalls++;
          break;
        }
        sample(local);
        r.advance(local);
        steps++;
        dirty = true;
        onFrame?.();
      }
      if (dirty || t - lastInputSend >= INPUT_RESEND_MS) sendInputs(t);
      return r.frame() === target ? frameFraction(serverNow, match.startAt) : 1;
    },

    stats() {
      const t = now();
      const r = rollback;
      return {
        frame: r?.frame() ?? 0,
        confirmedFrame: r?.confirmedFrame() ?? 0,
        targetFrame: target,
        rttMs: clockRtt(estimator, t),
        rollbacks: r?.stats.rollbacks ?? 0,
        maxRollback: r?.stats.maxRollback ?? 0,
        meanRollback:
          r !== null && r.stats.rollbacks > 0 ? r.stats.resimulated / r.stats.rollbacks : 0,
        stalls,
        lateInputs: r?.timeline.lateInputs ?? 0,
      };
    },

    onStatus: (l) => statusEvents.add(l),
    onDesync: (l) => desyncEvents.add(l),
    onPlayerLeft: (l) => leftEvents.add(l),

    close() {
      transport.close();
      shutdown('fermée par le client');
    },
  };
}
