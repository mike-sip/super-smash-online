/**
 * Relais d'inputs : parties, emplacements, arbitrage des inputs, relais, désynchronisations.
 * Logique pure, sans socket : chaque connexion est une interface `Connection` fournie par l'hôte
 * (WebSocket réel, ou réseau simulé des tests), et l'horloge est injectée.
 *
 * Le relais est l'arbitre des inputs (SPEC-netcode.md, « Côté serveur ») : il tient, par joueur,
 * la suite des inputs confirmés ; un input en retard de `G` frames est remplacé par le précédent ;
 * un joueur déconnecté reçoit des inputs neutres. Il ne fait jamais confiance au client.
 */
import {
  DEFAULT_CHECKSUM_INTERVAL,
  DEFAULT_INPUT_DELAY,
  DEFAULT_LATE_TOLERANCE,
  DEFAULT_MAX_PREDICTION,
  FRAME_MS,
  MAX_FRAMES_PER_MESSAGE,
  START_DELAY_MS,
} from '../constants.ts';
import {
  ERR_FULL,
  ERR_INVALID,
  ERR_MISMATCH,
  ERR_SERVER_FULL,
  ERR_STARTED,
  ERR_TIMEOUT,
  ERR_VERSION,
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
  type Message,
} from '../protocol.ts';

/** Côté serveur d'une connexion. `send` peut garder `data` : l'hôte copie s'il en a besoin. */
export interface Connection {
  send(data: Uint8Array): void;
  /** Ferme la connexion ; l'hôte appelle ensuite `RelayPeer.closed`. */
  close(reason: string): void;
}

/** Ce que l'hôte signale au relais pour une connexion. */
export interface RelayPeer {
  receive(data: Uint8Array): void;
  closed(): void;
}

export interface RelayOptions {
  readonly now: () => number;
  readonly inputDelay?: number;
  readonly maxPrediction?: number;
  readonly lateTolerance?: number;
  readonly checksumInterval?: number;
  readonly startDelayMs?: number;
  /** Une partie qui attend ses joueurs plus longtemps est supprimée. */
  readonly waitingTimeoutMs?: number;
  readonly maxGames?: number;
  /** Graine de chaque partie. Par défaut : aléatoire. */
  readonly seed?: () => number;
  /** Garde tout l'historique des inputs confirmés de chaque partie (tests). */
  readonly record?: boolean;
  readonly onDesync?: (gameId: string, frame: number, checksums: readonly number[]) => void;
  /** Journal des événements notables (connexions refusées, désync, départs). */
  readonly log?: (message: string) => void;
}

export interface Relay {
  /** Nouvelle connexion : renvoie ce que l'hôte doit appeler à chaque message et à la fermeture. */
  connect(conn: Connection): RelayPeer;
  /** À appeler souvent (toutes les 4 ms) : retards, déconnexions, délais d'attente, renvois. */
  tick(): void;
  gameCount(): number;
  /** Inputs confirmés de la partie, `[frame][joueur]` (option `record`), ou `null`. */
  history(gameId: string): Uint32Array[] | null;
}

/** Capacité de l'anneau d'inputs confirmés, par joueur, côté serveur (68 s). Puissance de deux. */
export const SERVER_HISTORY = 4096;
const SERVER_MASK = SERVER_HISTORY - 1;
/** Un client peut envoyer des inputs jusqu'à `D + MAX_AHEAD` frames en avance sur le serveur. */
const MAX_AHEAD = 60;
/** Sans nouvelle donnée, les inputs non accusés sont renvoyés à cet intervalle. */
const RESEND_MS = 100;
/** Messages `INPUTS` au plus par envoi à un client (rattrapage d'un client en retard). */
const MAX_CHUNKS = 4;
/** Empreintes en attente gardées au plus, par partie. */
const MAX_PENDING_CHECKSUMS = 64;

interface Client {
  readonly conn: Connection;
  game: Game | null;
  slots: number[];
  /** Frontière des inputs confirmés connue du client, par joueur (ses accusés). */
  readonly acks: Int32Array;
  /** Plus haute frame déjà envoyée au client, plus un, par joueur. */
  readonly sent: Int32Array;
  lastSend: number;
  open: boolean;
}

interface PendingChecksum {
  frame: number;
  readonly values: Uint32Array;
  /** Bit c à 1 si le client d'index c a envoyé son empreinte. */
  reported: number;
}

interface Game {
  readonly id: string;
  readonly players: number;
  readonly seed: number;
  readonly clients: Client[];
  /** Index dans `clients` du propriétaire de chaque emplacement, ou -1. */
  readonly owner: Int8Array;
  readonly known: Int32Array;
  readonly connected: Uint8Array;
  readonly confirmed: Uint32Array;
  readonly record: Uint32Array[] | null;
  readonly createdAt: number;
  /** Instant de départ (horloge du serveur), `NaN` tant que des joueurs manquent. */
  startAt: number;
  desynced: boolean;
  readonly pending: PendingChecksum[];
}

export function createRelay(options: RelayOptions): Relay {
  const now = options.now;
  const inputDelay = options.inputDelay ?? DEFAULT_INPUT_DELAY;
  const maxPrediction = options.maxPrediction ?? DEFAULT_MAX_PREDICTION;
  const lateTolerance = options.lateTolerance ?? DEFAULT_LATE_TOLERANCE;
  const checksumInterval = options.checksumInterval ?? DEFAULT_CHECKSUM_INTERVAL;
  const startDelayMs = options.startDelayMs ?? START_DELAY_MS;
  const waitingTimeoutMs = options.waitingTimeoutMs ?? 10 * 60 * 1000;
  const maxGames = options.maxGames ?? 1000;
  const nextSeed = options.seed ?? (() => (Math.random() * 0x7fff_ffff) | 0 || 1);
  const log = options.log ?? (() => {});

  const games = new Map<string, Game>();
  /** Historiques gardés après la fin des parties (option `record`). */
  const records = new Map<string, Uint32Array[]>();
  const incoming = createMessage();
  const outgoing = createMessage();
  const buf = new Uint8Array(MAX_MESSAGE_BYTES);

  function send(client: Client, m: Message): void {
    if (!client.open) return;
    client.conn.send(buf.subarray(0, encode(m, buf)));
  }

  function fail(client: Client, code: number, text: string): void {
    outgoing.type = MSG_ERROR;
    outgoing.code = code;
    outgoing.text = text;
    send(client, outgoing);
    drop(client, text);
  }

  /** Ferme la connexion du client et le retire de sa partie. */
  function drop(client: Client, reason: string): void {
    if (!client.open) return;
    client.open = false;
    client.conn.close(reason);
    leave(client);
  }

  /** Départ programmé : tous les joueurs sont là. */
  function scheduled(game: Game): boolean {
    return !Number.isNaN(game.startAt);
  }

  /** La partie a commencé (l'heure de départ est passée). */
  function running(game: Game): boolean {
    return now() >= game.startAt;
  }

  function serverFrame(game: Game): number {
    return Math.floor((now() - game.startAt) / FRAME_MS);
  }

  // ── Arrivée dans une partie ───────────────────────────────────────────────────────────────

  function hello(client: Client, m: Message): void {
    if (m.version !== PROTOCOL_VERSION) {
      fail(
        client,
        ERR_VERSION,
        `Version du protocole ${m.version} ; le serveur parle la ${PROTOCOL_VERSION}.`,
      );
      return;
    }
    let game = games.get(m.gameId);
    if (game === undefined) {
      if (games.size >= maxGames) {
        fail(client, ERR_SERVER_FULL, 'Le serveur n’accepte plus de nouvelle partie.');
        return;
      }
      game = createGame(m.gameId, m.players);
      games.set(game.id, game);
      if (game.record !== null) records.set(game.id, game.record);
    } else if (scheduled(game)) {
      fail(client, ERR_STARTED, `La partie « ${game.id} » a déjà commencé.`);
      return;
    } else if (game.players !== m.players) {
      fail(
        client,
        ERR_MISMATCH,
        `La partie « ${game.id} » attend ${game.players} joueurs, pas ${m.players}.`,
      );
      return;
    }
    let free = 0;
    for (let p = 0; p < game.players; p++) if (game.owner[p] === -1) free++;
    if (free < m.localPlayers) {
      fail(client, ERR_FULL, `La partie « ${game.id} » n’a plus que ${free} place(s).`);
      return;
    }
    const index = game.clients.length;
    game.clients.push(client);
    client.game = game;
    for (let p = 0; p < game.players && client.slots.length < m.localPlayers; p++) {
      if (game.owner[p] === -1) {
        game.owner[p] = index;
        client.slots.push(p);
      }
    }
    if (free === m.localPlayers) {
      game.startAt = now() + startDelayMs;
      for (const c of game.clients) sendStart(game, c);
    } else {
      broadcastWaiting(game);
    }
  }

  function createGame(id: string, players: number): Game {
    const known = new Int32Array(players);
    known.fill(inputDelay);
    return {
      id,
      players,
      seed: nextSeed() >>> 0,
      clients: [],
      owner: new Int8Array(players).fill(-1),
      known,
      connected: new Uint8Array(players).fill(1),
      confirmed: new Uint32Array(players * SERVER_HISTORY),
      record: options.record === true ? [] : null,
      createdAt: now(),
      startAt: Number.NaN,
      desynced: false,
      pending: [],
    };
  }

  function broadcastWaiting(game: Game): void {
    outgoing.type = MSG_WAITING;
    let joined = 0;
    for (let p = 0; p < game.players; p++) if (game.owner[p] !== -1) joined++;
    outgoing.joined = joined;
    outgoing.players = game.players;
    for (const c of game.clients) send(c, outgoing);
  }

  function sendStart(game: Game, client: Client): void {
    outgoing.type = MSG_START;
    outgoing.seed = game.seed;
    outgoing.players = game.players;
    outgoing.slotCount = client.slots.length;
    for (let i = 0; i < client.slots.length; i++) outgoing.slots[i] = client.slots[i]!;
    outgoing.startAt = game.startAt;
    outgoing.inputDelay = inputDelay;
    outgoing.maxPrediction = maxPrediction;
    outgoing.lateTolerance = lateTolerance;
    outgoing.checksumInterval = checksumInterval;
    send(client, outgoing);
    client.acks.fill(inputDelay);
    client.sent.fill(inputDelay);
    client.lastSend = now();
  }

  // ── Inputs ────────────────────────────────────────────────────────────────────────────────

  /** Confirme l'input `value` du joueur `p` pour sa prochaine frame. */
  function confirmNext(game: Game, p: number, value: number): void {
    const f = game.known[p]!;
    game.confirmed[p * SERVER_HISTORY + (f & SERVER_MASK)] = value;
    game.known[p] = f + 1;
    if (game.record !== null) {
      while (game.record.length <= f) game.record.push(new Uint32Array(game.players));
      game.record[f]![p] = value;
    }
  }

  function lastInput(game: Game, p: number): number {
    const f = game.known[p]! - 1;
    return f < inputDelay ? 0 : game.confirmed[p * SERVER_HISTORY + (f & SERVER_MASK)]!;
  }

  function input(client: Client, m: Message): void {
    const game = client.game!;
    if (m.players !== game.players) {
      fail(client, ERR_INVALID, 'Nombre de joueurs incohérent.');
      return;
    }
    for (let p = 0; p < game.players; p++) {
      const ack = m.acks[p]!;
      // Un accusé ne recule pas et ne dépasse pas ce qui a été confirmé.
      if (ack > client.acks[p]! && ack <= game.known[p]!) client.acks[p] = ack;
    }
    const index = game.clients.indexOf(client);
    if (!scheduled(game)) return;
    const limit = serverFrame(game) + inputDelay + MAX_AHEAD;
    let changed = false;
    for (let b = 0; b < m.blockCount; b++) {
      const p = m.blockPlayer[b]!;
      // Seuls les emplacements du client : le reste est ignoré.
      if (p >= game.players || game.owner[p] !== index || game.connected[p] === 0) continue;
      const start = m.blockStart[b]!;
      const n = m.blockLength[b]!;
      const known = game.known[p]!;
      if (start > known) continue;
      for (let k = known - start; k < n; k++) {
        if (start + k >= limit) break;
        confirmNext(game, p, m.blockInputs[b * MAX_FRAMES_PER_MESSAGE + k]!);
        changed = true;
      }
    }
    if (changed) flushAll(game);
  }

  /** Envoie à chaque client ce qu'il n'a pas encore. */
  function flushAll(game: Game): void {
    for (const c of game.clients) flush(game, c, false);
  }

  /**
   * Envoie au client les inputs confirmés qu'il n'a pas accusés, s'il y a du nouveau ou si le
   * dernier envoi date de plus de `RESEND_MS` (renvoi pour un transport à pertes).
   */
  function flush(game: Game, client: Client, timer: boolean): void {
    if (!client.open || !running(game)) return;
    let fresh = false;
    let unacked = false;
    for (let p = 0; p < game.players; p++) {
      if (game.known[p]! > client.sent[p]!) fresh = true;
      if (game.known[p]! > client.acks[p]!) unacked = true;
      if (game.known[p]! - client.acks[p]! > SERVER_HISTORY - MAX_FRAMES_PER_MESSAGE) {
        fail(client, ERR_TIMEOUT, 'Trop de retard : la partie ne peut plus être rattrapée.');
        return;
      }
    }
    if (!fresh && !(unacked && timer && now() - client.lastSend >= RESEND_MS)) return;
    for (let chunk = 0; chunk < MAX_CHUNKS; chunk++) {
      outgoing.type = MSG_INPUTS;
      outgoing.blockCount = 0;
      for (let p = 0; p < game.players; p++) {
        const start = client.acks[p]! + chunk * MAX_FRAMES_PER_MESSAGE;
        const end = Math.min(game.known[p]!, start + MAX_FRAMES_PER_MESSAGE);
        if (end <= start) continue;
        const b = outgoing.blockCount++;
        outgoing.blockPlayer[b] = p;
        outgoing.blockStart[b] = start;
        outgoing.blockLength[b] = end - start;
        const row = p * SERVER_HISTORY;
        for (let f = start; f < end; f++) {
          outgoing.blockInputs[b * MAX_FRAMES_PER_MESSAGE + f - start] =
            game.confirmed[row + (f & SERVER_MASK)]!;
        }
        if (end > client.sent[p]!) client.sent[p] = end;
      }
      if (outgoing.blockCount === 0) break;
      send(client, outgoing);
    }
    client.lastSend = now();
  }

  /** Inputs en retard remplacés par le précédent ; joueurs partis : inputs neutres d'avance. */
  function arbitrate(game: Game): boolean {
    const frame = serverFrame(game);
    let changed = false;
    for (let p = 0; p < game.players; p++) {
      if (game.connected[p] === 0) {
        while (game.known[p]! < frame + inputDelay + maxPrediction) {
          confirmNext(game, p, 0);
          changed = true;
        }
      } else {
        while (game.known[p]! + lateTolerance <= frame) {
          confirmNext(game, p, lastInput(game, p));
          changed = true;
        }
      }
    }
    return changed;
  }

  // ── Désynchronisations ────────────────────────────────────────────────────────────────────

  function checksumReport(client: Client, m: Message): void {
    const game = client.game!;
    if (!running(game) || m.frame === 0 || m.frame % checksumInterval !== 0) return;
    let frontier = game.known[0]!;
    for (let p = 1; p < game.players; p++) frontier = Math.min(frontier, game.known[p]!);
    // Une empreinte n'existe que pour un état confirmé.
    if (m.frame > frontier) return;
    const index = game.clients.indexOf(client);
    let entry = game.pending.find((e) => e.frame === m.frame);
    if (entry === undefined) {
      if (game.pending.length >= MAX_PENDING_CHECKSUMS) game.pending.shift();
      entry = { frame: m.frame, values: new Uint32Array(game.clients.length), reported: 0 };
      game.pending.push(entry);
    }
    entry.values[index] = m.value;
    entry.reported |= 1 << index;
    settleChecksums(game);
  }

  /** Compare les empreintes reçues de tous les clients encore connectés. */
  function settleChecksums(game: Game): void {
    let expected = 0;
    for (let c = 0; c < game.clients.length; c++) if (game.clients[c]!.open) expected |= 1 << c;
    for (let i = 0; i < game.pending.length;) {
      const entry = game.pending[i]!;
      if ((entry.reported & expected) !== expected) {
        i++;
        continue;
      }
      game.pending.splice(i, 1);
      let reference = -1;
      let mismatch = false;
      for (let c = 0; c < game.clients.length; c++) {
        if ((expected & (1 << c)) === 0) continue;
        if (reference < 0) reference = entry.values[c]!;
        else if (entry.values[c] !== reference) mismatch = true;
      }
      if (mismatch && !game.desynced) desync(game, entry);
    }
  }

  function desync(game: Game, entry: PendingChecksum): void {
    game.desynced = true;
    outgoing.type = MSG_DESYNC;
    outgoing.frame = entry.frame;
    outgoing.players = game.players;
    outgoing.reportedMask = 0;
    const perPlayer: number[] = [];
    for (let p = 0; p < game.players; p++) {
      const c = game.owner[p]!;
      const has = c >= 0 && (entry.reported & (1 << c)) !== 0;
      outgoing.checksums[p] = has ? entry.values[c]! : 0;
      if (has) outgoing.reportedMask |= 1 << p;
      perPlayer.push(outgoing.checksums[p]!);
    }
    for (const c of game.clients) send(c, outgoing);
    log(
      `désync dans la partie « ${game.id} » à la frame ${entry.frame} : ${perPlayer.map((v) => v.toString(16)).join(' ')}`,
    );
    options.onDesync?.(game.id, entry.frame, perPlayer);
  }

  // ── Départs ───────────────────────────────────────────────────────────────────────────────

  function leave(client: Client): void {
    const game = client.game;
    if (game === null) return;
    const index = game.clients.indexOf(client);
    if (!running(game)) {
      // Avant le départ : l'emplacement se libère, la partie (re)passe en attente.
      game.clients.splice(index, 1);
      for (let p = 0; p < game.players; p++) {
        const o = game.owner[p]!;
        if (o === index) game.owner[p] = -1;
        else if (o > index) game.owner[p] = o - 1;
      }
      if (game.clients.length === 0) {
        games.delete(game.id);
        return;
      }
      game.startAt = Number.NaN;
      broadcastWaiting(game);
      return;
    }
    // Partie commencée : le client reste dans la liste (son index sert aux empreintes).
    for (const p of client.slots) {
      if (game.connected[p] === 0) continue;
      game.connected[p] = 0;
      outgoing.type = MSG_LEFT;
      outgoing.slot = p;
      outgoing.frame = game.known[p]!;
      for (const c of game.clients) send(c, outgoing);
      log(`partie « ${game.id} » : joueur ${p + 1} parti à la frame ${game.known[p]}`);
    }
    if (game.clients.every((c) => !c.open)) {
      games.delete(game.id);
      return;
    }
    if (arbitrate(game)) flushAll(game);
    settleChecksums(game);
  }

  // ── Connexions ────────────────────────────────────────────────────────────────────────────

  return {
    connect(conn) {
      const client: Client = {
        conn,
        game: null,
        slots: [],
        acks: new Int32Array(8),
        sent: new Int32Array(8),
        lastSend: 0,
        open: true,
      };
      return {
        receive(data) {
          if (!client.open) return;
          const error = decode(data, incoming);
          if (error !== null) {
            fail(client, ERR_INVALID, `Message invalide : ${error}.`);
            return;
          }
          const m = incoming;
          if (m.type === MSG_PING) {
            outgoing.type = MSG_PONG;
            outgoing.clientTime = m.clientTime;
            outgoing.serverTime = now();
            send(client, outgoing);
          } else if (client.game === null) {
            if (m.type === MSG_HELLO) hello(client, m);
            else fail(client, ERR_INVALID, 'Message reçu avant HELLO.');
          } else if (m.type === MSG_INPUT) {
            input(client, m);
          } else if (m.type === MSG_CHECKSUM) {
            checksumReport(client, m);
          } else {
            fail(client, ERR_INVALID, `Message inattendu (type ${m.type}).`);
          }
        },
        closed() {
          if (!client.open) return;
          client.open = false;
          leave(client);
        },
      };
    },

    tick() {
      const t = now();
      for (const game of games.values()) {
        if (scheduled(game)) {
          if (t < game.startAt) continue;
          arbitrate(game);
          for (const c of game.clients) flush(game, c, true);
        } else if (t - game.createdAt > waitingTimeoutMs) {
          for (const c of [...game.clients]) fail(c, ERR_TIMEOUT, 'Personne d’autre n’est venu.');
          games.delete(game.id);
        }
      }
    },

    gameCount: () => games.size,

    history(gameId) {
      return records.get(gameId) ?? null;
    },
  };
}
