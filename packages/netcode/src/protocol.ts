/**
 * Protocole binaire entre clients et serveur relais (SPEC-netcode.md, « Protocole »).
 *
 * Un message = un octet de type, puis ses champs, entiers petit-boutistes. Encodage et décodage
 * passent par une même structure `Message`, réutilisée d'un message à l'autre : décoder n'alloue
 * rien, sauf les chaînes (identifiant de partie, texte d'erreur), rares. Le décodage ne lève
 * jamais d'exception : un message invalide donne une description de l'erreur.
 */
import {
  MAX_FRAMES_PER_MESSAGE,
  MAX_INPUT_DELAY,
  MAX_LOCAL_PLAYERS,
  MAX_PLAYERS,
  MAX_PREDICTION_LIMIT,
  MIN_PLAYERS,
} from './constants.ts';

/** Version du protocole, portée par `HELLO`. À augmenter à tout changement de format. */
export const PROTOCOL_VERSION = 1;

export const MSG_HELLO = 1;
export const MSG_WAITING = 2;
export const MSG_START = 3;
export const MSG_INPUT = 4;
export const MSG_INPUTS = 5;
export const MSG_PING = 6;
export const MSG_PONG = 7;
export const MSG_CHECKSUM = 8;
export const MSG_DESYNC = 9;
export const MSG_LEFT = 10;
export const MSG_ERROR = 11;

export const ERR_VERSION = 1;
export const ERR_FULL = 2;
export const ERR_STARTED = 3;
export const ERR_MISMATCH = 4;
export const ERR_INVALID = 5;
export const ERR_TIMEOUT = 6;
export const ERR_SERVER_FULL = 7;
/** Mode réservé : ticket refusé, partie non réservée, ou compte sans place. */
export const ERR_AUTH = 8;
/** Partie fermée par le serveur (annulée par le lobby, ou terminée). */
export const ERR_CLOSED = 9;

/** Plus gros message possible : `INPUTS` complet à 8 joueurs (1 074 octets), `HELLO` avec ticket (1 062). */
export const MAX_MESSAGE_BYTES = 2048;
export const MAX_GAME_ID_LENGTH = 32;
/** Ticket d'authentification opaque (module accounts), transmis par HELLO ; vide en invité. */
export const MAX_TICKET_BYTES = 1024;
const MAX_ERROR_TEXT_BYTES = 200;
const GAME_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
/** Plus grand nombre de blocs d'inputs par message : un par joueur. */
const MAX_BLOCKS = MAX_PLAYERS;

/** Structure commune à tous les messages : seuls les champs du type courant ont un sens. */
export interface Message {
  type: number;
  // HELLO
  version: number;
  gameId: string;
  /** HELLO : ticket d'authentification, chaîne vide s'il n'y en a pas. Pas encore vérifié. */
  ticket: string;
  /** HELLO : joueurs attendus. WAITING : attendus. START, INPUT, DESYNC : joueurs de la partie. */
  players: number;
  localPlayers: number;
  // WAITING
  joined: number;
  // START
  seed: number;
  slotCount: number;
  readonly slots: Uint8Array;
  startAt: number;
  inputDelay: number;
  maxPrediction: number;
  lateTolerance: number;
  checksumInterval: number;
  // INPUT : frontière des inputs confirmés connue de l'émetteur, pour chacun des `players` joueurs.
  readonly acks: Uint32Array;
  // INPUT, INPUTS : blocs d'inputs consécutifs, un par joueur.
  blockCount: number;
  readonly blockPlayer: Uint8Array;
  readonly blockStart: Uint32Array;
  readonly blockLength: Uint8Array;
  /** Inputs du bloc b : `blockInputs[b * MAX_FRAMES_PER_MESSAGE + k]`. */
  readonly blockInputs: Uint32Array;
  // PING, PONG
  clientTime: number;
  serverTime: number;
  // CHECKSUM, DESYNC, LEFT
  frame: number;
  value: number;
  readonly checksums: Uint32Array;
  /** DESYNC : bit p à 1 si le joueur p a envoyé son empreinte. */
  reportedMask: number;
  slot: number;
  // ERROR
  code: number;
  text: string;
}

export function createMessage(): Message {
  return {
    type: 0,
    version: 0,
    gameId: '',
    ticket: '',
    players: 0,
    localPlayers: 0,
    joined: 0,
    seed: 0,
    slotCount: 0,
    slots: new Uint8Array(MAX_LOCAL_PLAYERS),
    startAt: 0,
    inputDelay: 0,
    maxPrediction: 0,
    lateTolerance: 0,
    checksumInterval: 0,
    acks: new Uint32Array(MAX_PLAYERS),
    blockCount: 0,
    blockPlayer: new Uint8Array(MAX_BLOCKS),
    blockStart: new Uint32Array(MAX_BLOCKS),
    blockLength: new Uint8Array(MAX_BLOCKS),
    blockInputs: new Uint32Array(MAX_BLOCKS * MAX_FRAMES_PER_MESSAGE),
    clientTime: 0,
    serverTime: 0,
    frame: 0,
    value: 0,
    checksums: new Uint32Array(MAX_PLAYERS),
    reportedMask: 0,
    slot: 0,
    code: 0,
    text: '',
  };
}

/** Vrai si `id` est un identifiant de partie acceptable. */
export function isValidGameId(id: string): boolean {
  return GAME_ID_PATTERN.test(id);
}

// ── Lecture et écriture d'octets, sans DataView (qui allouerait une vue par message) ─────────

const f64 = new Float64Array(1);
const f64Bytes = new Uint8Array(f64.buffer);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface Cursor {
  buf: Uint8Array;
  pos: number;
  /** Faux dès qu'une lecture dépasse la fin du message. */
  ok: boolean;
}
const reader: Cursor = { buf: new Uint8Array(0), pos: 0, ok: true };

function u8(r: Cursor): number {
  if (r.pos + 1 > r.buf.length) {
    r.ok = false;
    return 0;
  }
  return r.buf[r.pos++]!;
}

function u32(r: Cursor): number {
  if (r.pos + 4 > r.buf.length) {
    r.ok = false;
    return 0;
  }
  const b = r.buf;
  const p = r.pos;
  r.pos = p + 4;
  return (b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16) | (b[p + 3]! << 24)) >>> 0;
}

function float64(r: Cursor): number {
  if (r.pos + 8 > r.buf.length) {
    r.ok = false;
    return 0;
  }
  for (let k = 0; k < 8; k++) f64Bytes[k] = r.buf[r.pos + k]!;
  r.pos += 8;
  return f64[0]!;
}

function putU8(buf: Uint8Array, pos: number, v: number): number {
  buf[pos] = v;
  return pos + 1;
}

function putU32(buf: Uint8Array, pos: number, v: number): number {
  buf[pos] = v;
  buf[pos + 1] = v >>> 8;
  buf[pos + 2] = v >>> 16;
  buf[pos + 3] = v >>> 24;
  return pos + 4;
}

function putF64(buf: Uint8Array, pos: number, v: number): number {
  f64[0] = v;
  for (let k = 0; k < 8; k++) buf[pos + k] = f64Bytes[k]!;
  return pos + 8;
}

/** Écrit une chaîne précédée de sa longueur en octets (au plus `max`). */
function putString(buf: Uint8Array, pos: number, s: string, max: number): number {
  const room = buf.subarray(pos + 1, pos + 1 + max);
  const { written } = encoder.encodeInto(s, room);
  buf[pos] = written;
  return pos + 1 + written;
}

/** Écrit une chaîne précédée de sa longueur en octets sur 16 bits (au plus `max`). */
function putLongString(buf: Uint8Array, pos: number, s: string, max: number): number {
  const { written } = encoder.encodeInto(s, buf.subarray(pos + 2, pos + 2 + max));
  buf[pos] = written;
  buf[pos + 1] = written >>> 8;
  return pos + 2 + written;
}

// ── Encodage ─────────────────────────────────────────────────────────────────────────────────

/**
 * Encode `m` dans `buf` (au moins `MAX_MESSAGE_BYTES` octets) et renvoie la longueur écrite.
 * Les champs doivent être dans les bornes : l'encodeur ne les vérifie pas, le décodeur si.
 */
export function encode(m: Message, buf: Uint8Array): number {
  let p = putU8(buf, 0, m.type);
  switch (m.type) {
    case MSG_HELLO:
      p = putU8(buf, p, m.version);
      p = putU8(buf, p, m.players);
      p = putU8(buf, p, m.localPlayers);
      p = putString(buf, p, m.gameId, MAX_GAME_ID_LENGTH);
      return putLongString(buf, p, m.ticket, MAX_TICKET_BYTES);
    case MSG_WAITING:
      p = putU8(buf, p, m.joined);
      return putU8(buf, p, m.players);
    case MSG_START:
      p = putU32(buf, p, m.seed);
      p = putU8(buf, p, m.players);
      p = putU8(buf, p, m.slotCount);
      for (let i = 0; i < m.slotCount; i++) p = putU8(buf, p, m.slots[i]!);
      p = putF64(buf, p, m.startAt);
      p = putU8(buf, p, m.inputDelay);
      p = putU8(buf, p, m.maxPrediction);
      p = putU8(buf, p, m.lateTolerance);
      return putU8(buf, p, m.checksumInterval);
    case MSG_INPUT:
      p = putU8(buf, p, m.players);
      for (let i = 0; i < m.players; i++) p = putU32(buf, p, m.acks[i]!);
      return putBlocks(m, buf, p);
    case MSG_INPUTS:
      return putBlocks(m, buf, p);
    case MSG_PING:
      return putF64(buf, p, m.clientTime);
    case MSG_PONG:
      p = putF64(buf, p, m.clientTime);
      return putF64(buf, p, m.serverTime);
    case MSG_CHECKSUM:
      p = putU32(buf, p, m.frame);
      return putU32(buf, p, m.value);
    case MSG_DESYNC:
      p = putU32(buf, p, m.frame);
      p = putU8(buf, p, m.players);
      p = putU8(buf, p, m.reportedMask);
      for (let i = 0; i < m.players; i++) p = putU32(buf, p, m.checksums[i]!);
      return p;
    case MSG_LEFT:
      p = putU8(buf, p, m.slot);
      return putU32(buf, p, m.frame);
    case MSG_ERROR:
      p = putU8(buf, p, m.code);
      return putString(buf, p, m.text, MAX_ERROR_TEXT_BYTES);
    default:
      throw new Error(`Type de message inconnu : ${m.type}`);
  }
}

function putBlocks(m: Message, buf: Uint8Array, start: number): number {
  let p = putU8(buf, start, m.blockCount);
  for (let b = 0; b < m.blockCount; b++) {
    p = putU8(buf, p, m.blockPlayer[b]!);
    p = putU32(buf, p, m.blockStart[b]!);
    const n = m.blockLength[b]!;
    p = putU8(buf, p, n);
    const base = b * MAX_FRAMES_PER_MESSAGE;
    for (let k = 0; k < n; k++) p = putU32(buf, p, m.blockInputs[base + k]!);
  }
  return p;
}

// ── Décodage ─────────────────────────────────────────────────────────────────────────────────

/**
 * Décode `data` dans `out`. Renvoie `null` si le message est valide, sinon la raison du refus ;
 * `out` est alors dans un état quelconque. N'alloue rien hors des chaînes.
 */
export function decode(data: Uint8Array, out: Message): string | null {
  if (data.length === 0) return 'message vide';
  if (data.length > MAX_MESSAGE_BYTES) return `message trop long (${data.length} octets)`;
  const r = reader;
  r.buf = data;
  r.pos = 0;
  r.ok = true;
  const error = decodeBody(r, out);
  r.buf = EMPTY;
  if (error !== null) return error;
  if (!r.ok) return 'message tronqué';
  if (r.pos !== data.length) return `${data.length - r.pos} octets en trop`;
  return null;
}
const EMPTY = new Uint8Array(0);

function decodeBody(r: Cursor, m: Message): string | null {
  m.type = u8(r);
  switch (m.type) {
    case MSG_HELLO: {
      // La version est toujours le deuxième octet. Une autre version peut avoir un autre format :
      // le message est accepté tel quel, et le relais répond par une erreur de version.
      m.version = u8(r);
      if (r.ok && m.version !== PROTOCOL_VERSION) {
        r.pos = r.buf.length;
        return null;
      }
      m.players = u8(r);
      m.localPlayers = u8(r);
      const id = readString(r, MAX_GAME_ID_LENGTH);
      if (id === null) return 'identifiant de partie tronqué';
      const ticket = readLongString(r, MAX_TICKET_BYTES);
      if (ticket === null) return 'ticket tronqué';
      if (!isValidGameId(id)) return 'identifiant de partie invalide';
      if (m.players < MIN_PLAYERS || m.players > MAX_PLAYERS) return 'nombre de joueurs invalide';
      if (m.localPlayers < 1 || m.localPlayers > MAX_LOCAL_PLAYERS) {
        return 'nombre de joueurs locaux invalide';
      }
      if (m.localPlayers > m.players) return 'plus de joueurs locaux que de joueurs';
      m.gameId = id;
      m.ticket = ticket;
      return null;
    }
    case MSG_WAITING:
      m.joined = u8(r);
      m.players = u8(r);
      if (m.players < MIN_PLAYERS || m.players > MAX_PLAYERS) return 'nombre de joueurs invalide';
      if (m.joined > m.players) return 'plus de joueurs présents qu’attendus';
      return null;
    case MSG_START: {
      m.seed = u32(r);
      m.players = u8(r);
      m.slotCount = u8(r);
      if (m.players < MIN_PLAYERS || m.players > MAX_PLAYERS) return 'nombre de joueurs invalide';
      if (m.slotCount < 1 || m.slotCount > MAX_LOCAL_PLAYERS) return 'emplacements invalides';
      let seen = 0;
      for (let i = 0; i < m.slotCount; i++) {
        const slot = u8(r);
        if (slot >= m.players || (seen & (1 << slot)) !== 0) return 'emplacement invalide';
        seen |= 1 << slot;
        m.slots[i] = slot;
      }
      m.startAt = float64(r);
      m.inputDelay = u8(r);
      m.maxPrediction = u8(r);
      m.lateTolerance = u8(r);
      m.checksumInterval = u8(r);
      if (!Number.isFinite(m.startAt)) return 'instant de départ invalide';
      if (m.inputDelay > MAX_INPUT_DELAY) return 'délai d’input invalide';
      if (m.maxPrediction < 1 || m.maxPrediction > MAX_PREDICTION_LIMIT) {
        return 'fenêtre de prédiction invalide';
      }
      if (m.lateTolerance < 1) return 'tolérance invalide';
      if (m.checksumInterval < 1) return 'intervalle de checksum invalide';
      return null;
    }
    case MSG_INPUT:
      m.players = u8(r);
      if (m.players < MIN_PLAYERS || m.players > MAX_PLAYERS) return 'nombre de joueurs invalide';
      for (let i = 0; i < m.players; i++) m.acks[i] = u32(r);
      return readBlocks(r, m, MAX_LOCAL_PLAYERS);
    case MSG_INPUTS:
      return readBlocks(r, m, MAX_BLOCKS);
    case MSG_PING:
      m.clientTime = float64(r);
      return Number.isFinite(m.clientTime) ? null : 'heure invalide';
    case MSG_PONG:
      m.clientTime = float64(r);
      m.serverTime = float64(r);
      return Number.isFinite(m.clientTime) && Number.isFinite(m.serverTime)
        ? null
        : 'heure invalide';
    case MSG_CHECKSUM:
      m.frame = u32(r);
      m.value = u32(r);
      return null;
    case MSG_DESYNC:
      m.frame = u32(r);
      m.players = u8(r);
      m.reportedMask = u8(r);
      if (m.players < MIN_PLAYERS || m.players > MAX_PLAYERS) return 'nombre de joueurs invalide';
      for (let i = 0; i < m.players; i++) m.checksums[i] = u32(r);
      return null;
    case MSG_LEFT:
      m.slot = u8(r);
      m.frame = u32(r);
      return m.slot < MAX_PLAYERS ? null : 'emplacement invalide';
    case MSG_ERROR: {
      m.code = u8(r);
      const text = readString(r, MAX_ERROR_TEXT_BYTES);
      if (text === null) return 'texte d’erreur tronqué';
      m.text = text;
      return null;
    }
    default:
      return `type de message inconnu (${m.type})`;
  }
}

function readBlocks(r: Cursor, m: Message, maxBlocks: number): string | null {
  m.blockCount = u8(r);
  if (m.blockCount > maxBlocks) return 'trop de blocs d’inputs';
  let seen = 0;
  for (let b = 0; b < m.blockCount; b++) {
    const player = u8(r);
    const start = u32(r);
    const n = u8(r);
    if (!r.ok) return 'message tronqué';
    if (player >= MAX_PLAYERS || (seen & (1 << player)) !== 0) return 'joueur invalide';
    if (n > MAX_FRAMES_PER_MESSAGE) return 'bloc d’inputs trop long';
    seen |= 1 << player;
    m.blockPlayer[b] = player;
    m.blockStart[b] = start;
    m.blockLength[b] = n;
    const base = b * MAX_FRAMES_PER_MESSAGE;
    for (let k = 0; k < n; k++) m.blockInputs[base + k] = u32(r);
  }
  return null;
}

function readString(r: Cursor, max: number): string | null {
  const n = u8(r);
  if (!r.ok || n > max || r.pos + n > r.buf.length) return null;
  const s = decoder.decode(r.buf.subarray(r.pos, r.pos + n));
  r.pos += n;
  return s;
}

function readLongString(r: Cursor, max: number): string | null {
  const n = u8(r) | (u8(r) << 8);
  if (!r.ok || n > max || r.pos + n > r.buf.length) return null;
  const s = n === 0 ? '' : decoder.decode(r.buf.subarray(r.pos, r.pos + n));
  r.pos += n;
  return s;
}
