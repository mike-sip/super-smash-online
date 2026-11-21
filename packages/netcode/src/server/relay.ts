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
  HISTORY_FRAMES,
  MAX_FRAMES_PER_MESSAGE,
  START_DELAY_MS,
} from '../constants.ts';
import {
  ERR_AUTH,
  ERR_CLOSED,
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
  MSG_REJOINED,
  MSG_START,
  MSG_WAITING,
  PROTOCOL_VERSION,
  createMessage,
  decode,
  encode,
  isValidGameId,
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
  /**
   * Mode réservé (SPEC-lobby.md, « Relais authentifié ») : vérifie le ticket d'un `HELLO` et
   * renvoie l'identifiant du compte, ou `null`. Avec elle, seules les parties créées par
   * `reserve` existent et chaque compte reçoit sa place. Sans elle, le relais reste ouvert.
   */
  readonly authenticate?: (ticket: string) => { readonly id: string } | null;
  /** Événements de partie, pour le lobby. */
  readonly onGameEvent?: (event: RelayGameEvent) => void;
}

export type RelayGameEvent =
  | { readonly type: 'started'; readonly gameId: string }
  | {
      readonly type: 'left';
      readonly gameId: string;
      readonly slot: number;
      readonly frame: number;
    }
  | {
      readonly type: 'rejoined';
      readonly gameId: string;
      readonly slot: number;
      readonly frame: number;
    }
  | {
      readonly type: 'closed';
      readonly gameId: string;
      readonly reason: 'empty' | 'cancelled' | 'expired' | 'timeout';
    };

export interface Reservation {
  /** Identifiant de compte de chaque place, de 2 à 8, tous différents. */
  readonly seats: readonly string[];
  /** Délai pour que toutes les places soient prises ; au-delà, la partie est fermée. */
  readonly expiresInMs: number;
}

export interface Relay {
  /** Nouvelle connexion : renvoie ce que l'hôte doit appeler à chaque message et à la fermeture. */
  connect(conn: Connection): RelayPeer;
  /**
   * Réserve une partie (mode réservé seulement). Renvoie `false` si l'identifiant est invalide
   * ou déjà pris, les places mal formées, le serveur plein, ou sans `authenticate`.
   */
  reserve(gameId: string, reservation: Reservation): boolean;
  /** Ferme une partie et ses connexions (`ERR_CLOSED` avec `reason`). `false` si inconnue. */
  cancel(gameId: string, reason: string): boolean;
  /** À appeler souvent (toutes les 4 ms) : retards, déconnexions, délais d'attente, renvois. */
  tick(): void;
  gameCount(): number;
  /** Inputs confirmés de la partie, `[frame][joueur]` (option `record`), ou `null`. */
  history(gameId: string): Uint32Array[] | null;
}

/** Capacité de l'anneau d'inputs confirmés, par joueur, côté serveur (68 s). Puissance de deux. */
export const SERVER_HISTORY = 4096;
const SERVER_MASK = SERVER_HISTORY - 1;
const SERVER_SHIFT = 12;
/** Un client peut envoyer des inputs jusqu'à `D + MAX_AHEAD` frames en avance sur le serveur. */
const MAX_AHEAD = 60;
/** Si les accusés d'un client n'avancent plus depuis ce délai, tout le non-accusé est renvoyé. */
const RESEND_MS = 100;
/** Chaque envoi reprend aussi les dernières frames déjà envoyées : une perte isolée est comblée. */
const REDUNDANT_FRAMES = 3;
/** Messages `INPUTS` au plus par envoi à un client (rattrapage d'un client en retard). */
const MAX_CHUNKS = 4;
/** Empreintes en attente gardées au plus, par partie. */
const MAX_PENDING_CHECKSUMS = 64;
/** Partie réservée commencée sans plus personne : fermée après ce délai si personne ne revient. */
export const EMPTY_GRACE_MS = 30_000;
/**
 * Partie réservée : frames envoyées au plus au-delà de l'accusé d'un client, pour qu'un client qui
 * rattrape la partie ne reçoive que ce que son historique peut garder (`HISTORY_FRAMES`).
 */
const CATCH_UP_WINDOW = HISTORY_FRAMES - 4 * MAX_FRAMES_PER_MESSAGE;

interface Client {
  readonly conn: Connection;
  game: Game | null;
  slots: number[];
  /** Frontière des inputs confirmés connue du client, par joueur (ses accusés). */
  readonly acks: Int32Array;
  /** Plus haute frame déjà envoyée au client, plus un, par joueur. */
  readonly sent: Int32Array;
  /** Par joueur : dernière fois que l'accusé du client a avancé, ou qu'il était à jour. */
  readonly ackedAt: Float64Array;
  open: boolean;
  /** Compte authentifié (mode réservé), sinon `null`. */
  account: string | null;
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
  /**
   * Mode réservé : historique complet, par blocs de `SERVER_HISTORY` frames (`confirmed` est le
   * premier), pour qu'un joueur revenu en pleine partie la rattrape depuis le début.
   */
  readonly chunks: Uint32Array[] | null;
  /** Plus haute frame dont les empreintes ont été comparées. */
  lastSettled: number;
  readonly record: Uint32Array[] | null;
  readonly createdAt: number;
  /** Mode réservé : compte de chaque place ; `null` pour une partie ouverte. */
  readonly seats: readonly string[] | null;
  /** Mode réservé : échéance pour que toutes les places soient prises. */
  readonly expiresAt: number;
  /** Instant de départ (horloge du serveur), `NaN` tant que des joueurs manquent. */
  startAt: number;
  desynced: boolean;
  /** Fermeture en cours : les départs ne sont plus annoncés. */
  closing: boolean;
  /** Partie réservée commencée dont tout le monde est parti : depuis quand, sinon `NaN`. */
  emptySince: number;
  /** Des inputs ont été confirmés depuis le dernier envoi. */
  dirty: boolean;
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
    if (options.authenticate !== undefined) {
      reservedHello(client, m, options.authenticate);
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

  /** `HELLO` en mode réservé : ticket, partie réservée, place du compte. */
  function reservedHello(
    client: Client,
    m: Message,
    authenticate: NonNullable<RelayOptions['authenticate']>,
  ): void {
    const identity = m.ticket === '' ? null : authenticate(m.ticket);
    if (identity === null) {
      fail(client, ERR_AUTH, 'Ticket d’authentification refusé.');
      return;
    }
    const game = games.get(m.gameId);
    const seats = game?.seats ?? null;
    if (game === undefined || seats === null) {
      fail(client, ERR_AUTH, 'Cette partie n’existe pas ou n’est pas réservée.');
      return;
    }
    const slots: number[] = [];
    for (let p = 0; p < seats.length; p++) if (seats[p] === identity.id) slots.push(p);
    if (slots.length === 0) {
      fail(client, ERR_AUTH, 'Vous n’avez pas de place dans cette partie.');
      return;
    }
    if (m.players !== game.players || m.localPlayers !== slots.length) {
      fail(client, ERR_MISMATCH, 'La demande ne correspond pas à la réservation.');
      return;
    }
    // Même compte déjà connecté (page rechargée) : la nouvelle connexion gagne. Avant le départ,
    // l'ancienne libère sa place ; en pleine partie, ses places deviennent absentes.
    const previous = game.clients.find((c) => c.open && c.account === identity.id);
    if (previous !== undefined) fail(previous, ERR_AUTH, 'Connexion remplacée par une autre.');
    if (games.get(game.id) !== game) {
      fail(client, ERR_CLOSED, 'Cette partie est terminée.');
      return;
    }
    client.account = identity.id;
    if (scheduled(game)) {
      // Une partie ne reste programmée sans avoir commencé que si tout le monde est là : ce
      // compte y avait donc une connexion, remplacée ci-dessus, ce qui l'a déprogrammée.
      rejoin(game, client, slots);
      return;
    }
    const index = game.clients.length;
    game.clients.push(client);
    client.game = game;
    for (const p of slots) {
      game.owner[p] = index;
      client.slots.push(p);
    }
    let free = 0;
    for (let p = 0; p < game.players; p++) if (game.owner[p] === -1) free++;
    if (free === 0) {
      game.startAt = now() + startDelayMs;
      for (const c of game.clients) sendStart(game, c);
      options.onGameEvent?.({ type: 'started', gameId: game.id });
    } else {
      broadcastWaiting(game);
    }
  }

  /**
   * Retour d'un joueur en pleine partie : il reprend l'index de son ancienne connexion (les
   * empreintes en attente restent cohérentes), reçoit le `START` d'origine puis tout l'historique
   * depuis la frame `D` ; ses inputs comptent de nouveau à partir de la frame annoncée.
   */
  function rejoin(game: Game, client: Client, slots: readonly number[]): void {
    game.emptySince = Number.NaN;
    const index = game.owner[slots[0]!]!;
    game.clients[index] = client;
    client.game = game;
    for (const p of slots) client.slots.push(p);
    sendStart(game, client);
    for (const p of slots) {
      game.connected[p] = 1;
      outgoing.type = MSG_REJOINED;
      outgoing.slot = p;
      outgoing.frame = game.known[p]!;
      for (const c of game.clients) send(c, outgoing);
      log(`partie « ${game.id} » : joueur ${p + 1} revenu à la frame ${game.known[p]}`);
      options.onGameEvent?.({ type: 'rejoined', gameId: game.id, slot: p, frame: game.known[p]! });
    }
    game.dirty = true;
  }

  function createGame(
    id: string,
    players: number,
    seats: readonly string[] | null = null,
    expiresAt = Number.POSITIVE_INFINITY,
  ): Game {
    const known = new Int32Array(players);
    const confirmed = new Uint32Array(players * SERVER_HISTORY);
    known.fill(inputDelay);
    return {
      id,
      players,
      seed: nextSeed() >>> 0,
      clients: [],
      owner: new Int8Array(players).fill(-1),
      known,
      connected: new Uint8Array(players).fill(1),
      confirmed,
      chunks: seats === null ? null : [confirmed],
      lastSettled: 0,
      record: options.record === true ? [] : null,
      createdAt: now(),
      seats,
      expiresAt,
      startAt: Number.NaN,
      desynced: false,
      closing: false,
      emptySince: Number.NaN,
      dirty: false,
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
    client.ackedAt.fill(now());
  }

  // ── Inputs ────────────────────────────────────────────────────────────────────────────────

  /** Confirme l'input `value` du joueur `p` pour sa prochaine frame. */
  function confirmNext(game: Game, p: number, value: number): void {
    const f = game.known[p]!;
    writeConfirmed(game, p, f, value);
    game.known[p] = f + 1;
    if (game.record !== null) {
      while (game.record.length <= f) game.record.push(new Uint32Array(game.players));
      game.record[f]![p] = value;
    }
  }

  function readConfirmed(game: Game, p: number, f: number): number {
    const store = game.chunks === null ? game.confirmed : game.chunks[f >>> SERVER_SHIFT]!;
    return store[p * SERVER_HISTORY + (f & SERVER_MASK)]!;
  }

  function writeConfirmed(game: Game, p: number, f: number, value: number): void {
    let store = game.confirmed;
    if (game.chunks !== null) {
      const c = f >>> SERVER_SHIFT;
      // Un bloc de plus toutes les 68 s de jeu : allocation rare, hors du chemin d'une frame.
      while (game.chunks.length <= c) {
        game.chunks.push(new Uint32Array(game.players * SERVER_HISTORY));
      }
      store = game.chunks[c]!;
    }
    store[p * SERVER_HISTORY + (f & SERVER_MASK)] = value;
  }

  function lastInput(game: Game, p: number): number {
    const f = game.known[p]! - 1;
    return f < inputDelay ? 0 : readConfirmed(game, p, f);
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
      if (ack > client.acks[p]! && ack <= game.known[p]!) {
        client.acks[p] = ack;
        client.ackedAt[p] = now();
      }
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
    // Le relais envoie à son pas suivant (au plus 4 ms) : les inputs de plusieurs joueurs
    // partent ensemble, au lieu d'un message par input reçu et par destinataire.
    if (changed) game.dirty = true;
  }

  /** Envoie à chaque client ce qu'il n'a pas encore. */
  function flushAll(game: Game): void {
    game.dirty = false;
    for (const c of game.clients) flush(game, c);
  }

  /**
   * Envoie au client les inputs confirmés qu'il n'a pas encore reçus, avec les
   * `REDUNDANT_FRAMES` dernières frames déjà envoyées. Si ses accusés stagnent depuis
   * `RESEND_MS` (pertes sur un transport non fiable, ou client qui ne lit plus), tout le
   * non-accusé est renvoyé.
   */
  function flush(game: Game, client: Client): void {
    if (!client.open || !running(game)) return;
    const t = now();
    for (let p = 0; p < game.players; p++) {
      if (game.known[p]! === client.acks[p]!) {
        client.ackedAt[p] = t;
      } else if (t - client.ackedAt[p]! >= RESEND_MS) {
        // Accusé bloqué (message perdu) : on reprend ce joueur depuis l'accusé.
        client.sent[p] = client.acks[p]!;
        client.ackedAt[p] = t;
      }
      if (
        game.chunks === null &&
        game.known[p]! - client.acks[p]! > SERVER_HISTORY - MAX_FRAMES_PER_MESSAGE
      ) {
        fail(client, ERR_TIMEOUT, 'Trop de retard : la partie ne peut plus être rattrapée.');
        return;
      }
    }
    let fresh = false;
    for (let p = 0; p < game.players; p++) if (game.known[p]! > client.sent[p]!) fresh = true;
    if (!fresh) return;
    for (let chunk = 0; chunk < MAX_CHUNKS; chunk++) {
      outgoing.type = MSG_INPUTS;
      outgoing.blockCount = 0;
      for (let p = 0; p < game.players; p++) {
        const sent = client.sent[p]!;
        const start = chunk === 0 ? Math.max(client.acks[p]!, sent - REDUNDANT_FRAMES) : sent;
        // Partie réservée : jamais plus d'une fenêtre au-delà de l'accusé, ce que le client
        // peut garder ; un client qui rattrape la partie la reçoit ainsi à chaque pas.
        const cap = game.chunks === null ? Infinity : client.acks[p]! + CATCH_UP_WINDOW;
        const end = Math.min(game.known[p]!, start + MAX_FRAMES_PER_MESSAGE, cap);
        if (end <= start || (chunk > 0 && end <= sent)) continue;
        const b = outgoing.blockCount++;
        outgoing.blockPlayer[b] = p;
        outgoing.blockStart[b] = start;
        outgoing.blockLength[b] = end - start;
        for (let f = start; f < end; f++) {
          outgoing.blockInputs[b * MAX_FRAMES_PER_MESSAGE + f - start] = readConfirmed(game, p, f);
        }
        if (end > sent) client.sent[p] = end;
      }
      if (outgoing.blockCount === 0) break;
      send(client, outgoing);
    }
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
    if (
      !running(game) ||
      m.frame === 0 ||
      m.frame % checksumInterval !== 0 ||
      m.frame <= game.lastSettled
    )
      return;
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
      // Un client revenu en pleine partie renvoie les empreintes des frames déjà comparées : ignorées.
      if (entry.frame > game.lastSettled) game.lastSettled = entry.frame;
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
    if (game === null || game.closing) return;
    const index = game.clients.indexOf(client);
    if (!running(game)) {
      // Avant le départ : l'emplacement se libère, la partie (re)passe en attente.
      game.clients.splice(index, 1);
      for (let p = 0; p < game.players; p++) {
        const o = game.owner[p]!;
        if (o === index) game.owner[p] = -1;
        else if (o > index) game.owner[p] = o - 1;
      }
      game.startAt = Number.NaN;
      if (game.clients.length === 0) {
        // Une partie réservée attend ses joueurs jusqu'à son échéance.
        if (game.seats === null) games.delete(game.id);
        return;
      }
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
      options.onGameEvent?.({ type: 'left', gameId: game.id, slot: p, frame: game.known[p]! });
    }
    if (game.clients.every((c) => !c.open)) {
      // Partie réservée : chacun peut encore revenir pendant `EMPTY_GRACE_MS`.
      if (game.seats === null) closeGame(game, 'empty');
      else game.emptySince = now();
      return;
    }
    if (arbitrate(game)) flushAll(game);
    settleChecksums(game);
  }

  /** Retire la partie et l'annonce. */
  function closeGame(game: Game, reason: 'empty' | 'cancelled' | 'expired' | 'timeout'): void {
    if (games.get(game.id) !== game) return;
    game.closing = true;
    games.delete(game.id);
    options.onGameEvent?.({ type: 'closed', gameId: game.id, reason });
  }

  /** Ferme les connexions de la partie avec une erreur, puis la retire. */
  function shutGame(
    game: Game,
    code: number,
    text: string,
    reason: 'cancelled' | 'expired' | 'timeout',
  ): void {
    game.closing = true;
    for (const c of [...game.clients]) fail(c, code, text);
    game.closing = false;
    closeGame(game, reason);
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
        ackedAt: new Float64Array(8),
        open: true,
        account: null,
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
          if (t - game.emptySince > EMPTY_GRACE_MS) {
            closeGame(game, 'empty');
            continue;
          }
          arbitrate(game);
          flushAll(game);
        } else if (game.seats !== null) {
          if (t >= game.expiresAt) {
            shutGame(game, ERR_TIMEOUT, 'Tous les joueurs ne sont pas venus.', 'expired');
          }
        } else if (t - game.createdAt > waitingTimeoutMs) {
          shutGame(game, ERR_TIMEOUT, 'Personne d’autre n’est venu.', 'timeout');
        }
      }
    },

    reserve(gameId, reservation) {
      const seats = reservation.seats;
      if (
        options.authenticate === undefined ||
        !isValidGameId(gameId) ||
        games.has(gameId) ||
        games.size >= maxGames ||
        seats.length < 2 ||
        seats.length > 8 ||
        new Set(seats).size !== seats.length ||
        seats.some((s) => typeof s !== 'string' || s.length === 0) ||
        !(reservation.expiresInMs > 0)
      ) {
        return false;
      }
      const game = createGame(gameId, seats.length, [...seats], now() + reservation.expiresInMs);
      games.set(gameId, game);
      if (game.record !== null) records.set(game.id, game.record);
      return true;
    },

    cancel(gameId, reason) {
      const game = games.get(gameId);
      if (game === undefined) return false;
      shutGame(game, ERR_CLOSED, reason, 'cancelled');
      return true;
    },

    gameCount: () => games.size,

    history(gameId) {
      return records.get(gameId) ?? null;
    },
  };
}
