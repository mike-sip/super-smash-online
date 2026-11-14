import { describe, expect, it } from 'vitest';
import { MAX_FRAMES_PER_MESSAGE } from '../src/constants.ts';
import {
  ERR_FULL,
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
  isValidGameId,
  type Message,
} from '../src/protocol.ts';
import { Rng } from './helpers.ts';

const buf = new Uint8Array(MAX_MESSAGE_BYTES);

function bytes(m: Message): Uint8Array {
  return buf.slice(0, encode(m, buf));
}

function roundTrip(m: Message): Message {
  const out = createMessage();
  expect(decode(bytes(m), out)).toBeNull();
  return out;
}

function hello(gameId = 'partie-1', players = 2, localPlayers = 1): Message {
  const m = createMessage();
  m.type = MSG_HELLO;
  m.version = PROTOCOL_VERSION;
  m.gameId = gameId;
  m.players = players;
  m.localPlayers = localPlayers;
  return m;
}

/** Un INPUTS complet : 8 joueurs, 32 frames chacun. */
function fullInputs(): Message {
  const m = createMessage();
  m.type = MSG_INPUTS;
  m.blockCount = 8;
  for (let b = 0; b < 8; b++) {
    m.blockPlayer[b] = 7 - b;
    m.blockStart[b] = 0xffff_0000 + b;
    m.blockLength[b] = MAX_FRAMES_PER_MESSAGE;
    for (let k = 0; k < MAX_FRAMES_PER_MESSAGE; k++) {
      m.blockInputs[b * MAX_FRAMES_PER_MESSAGE + k] = (b * 1000 + k * 0x0101_0101) >>> 0;
    }
  }
  return m;
}

describe('protocole : aller-retour', () => {
  it('HELLO', () => {
    const out = roundTrip(hello('A-z_09-abcdefghijklmnopqrstuvwxy', 8, 4));
    expect(out.type).toBe(MSG_HELLO);
    expect(out.version).toBe(PROTOCOL_VERSION);
    expect(out.gameId).toBe('A-z_09-abcdefghijklmnopqrstuvwxy');
    expect(out.players).toBe(8);
    expect(out.localPlayers).toBe(4);
    expect(out.ticket).toBe('');
  });

  it('HELLO avec un ticket d’authentification', () => {
    const m = hello();
    m.ticket = 'v1.' + 'x'.repeat(1000);
    expect(roundTrip(m).ticket).toBe(m.ticket);
  });

  it('WAITING', () => {
    const m = createMessage();
    m.type = MSG_WAITING;
    m.joined = 3;
    m.players = 8;
    const out = roundTrip(m);
    expect([out.joined, out.players]).toEqual([3, 8]);
  });

  it('START', () => {
    const m = createMessage();
    m.type = MSG_START;
    m.seed = 0xdead_beef;
    m.players = 8;
    m.slotCount = 3;
    m.slots.set([5, 0, 7]);
    m.startAt = 123_456.789;
    m.inputDelay = 2;
    m.maxPrediction = 15;
    m.lateTolerance = 8;
    m.checksumInterval = 15;
    const out = roundTrip(m);
    expect(out.seed).toBe(0xdead_beef);
    expect(out.players).toBe(8);
    expect(Array.from(out.slots.subarray(0, out.slotCount))).toEqual([5, 0, 7]);
    expect(out.startAt).toBe(123_456.789);
    expect([out.inputDelay, out.maxPrediction, out.lateTolerance, out.checksumInterval]).toEqual([
      2, 15, 8, 15,
    ]);
  });

  it('INPUT, avec accusés et blocs', () => {
    const m = createMessage();
    m.type = MSG_INPUT;
    m.players = 4;
    m.acks.set([10, 0, 0xffff_ffff, 7]);
    m.blockCount = 2;
    m.blockPlayer.set([3, 1]);
    m.blockStart.set([42, 43]);
    m.blockLength.set([2, 0]);
    m.blockInputs[0] = 0xffff_ffff;
    m.blockInputs[1] = 1;
    const out = roundTrip(m);
    expect(Array.from(out.acks.subarray(0, 4))).toEqual([10, 0, 0xffff_ffff, 7]);
    expect(out.blockCount).toBe(2);
    expect([out.blockPlayer[0], out.blockStart[0], out.blockLength[0]]).toEqual([3, 42, 2]);
    expect([out.blockInputs[0], out.blockInputs[1]]).toEqual([0xffff_ffff, 1]);
    expect([out.blockPlayer[1], out.blockStart[1], out.blockLength[1]]).toEqual([1, 43, 0]);
  });

  it('INPUTS complet à 8 joueurs, dans la taille maximale', () => {
    const m = fullInputs();
    const data = bytes(m);
    expect(data.length).toBe(2 + 8 * (1 + 4 + 1 + 4 * MAX_FRAMES_PER_MESSAGE));
    expect(data.length).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    const out = roundTrip(m);
    expect(Array.from(out.blockInputs)).toEqual(Array.from(m.blockInputs));
    expect(Array.from(out.blockStart)).toEqual(Array.from(m.blockStart));
  });

  it('PING, PONG, CHECKSUM, DESYNC, LEFT, ERROR', () => {
    const m = createMessage();
    m.type = MSG_PING;
    m.clientTime = 1.5;
    expect(roundTrip(m).clientTime).toBe(1.5);

    m.type = MSG_PONG;
    m.serverTime = 99_999.25;
    const pong = roundTrip(m);
    expect([pong.clientTime, pong.serverTime]).toEqual([1.5, 99_999.25]);

    m.type = MSG_CHECKSUM;
    m.frame = 36_000;
    m.value = 0x8000_0001;
    const sum = roundTrip(m);
    expect([sum.frame, sum.value]).toEqual([36_000, 0x8000_0001]);

    m.type = MSG_DESYNC;
    m.players = 3;
    m.reportedMask = 0b101;
    m.checksums.set([1, 0, 3]);
    const desync = roundTrip(m);
    expect([desync.frame, desync.players, desync.reportedMask]).toEqual([36_000, 3, 0b101]);
    expect(Array.from(desync.checksums.subarray(0, 3))).toEqual([1, 0, 3]);

    m.type = MSG_LEFT;
    m.slot = 6;
    m.frame = 1234;
    const left = roundTrip(m);
    expect([left.slot, left.frame]).toEqual([6, 1234]);

    m.type = MSG_ERROR;
    m.code = ERR_FULL;
    m.text = 'Partie complète : déjà 8 joueurs.';
    const error = roundTrip(m);
    expect([error.code, error.text]).toEqual([ERR_FULL, 'Partie complète : déjà 8 joueurs.']);
  });
});

describe('protocole : validation', () => {
  function reject(data: Uint8Array | number[]): string {
    const error = decode(
      data instanceof Uint8Array ? data : Uint8Array.from(data),
      createMessage(),
    );
    expect(error).not.toBeNull();
    return error!;
  }

  it('identifiants de partie', () => {
    expect(isValidGameId('abc')).toBe(true);
    expect(isValidGameId('')).toBe(false);
    expect(isValidGameId('a'.repeat(33))).toBe(false);
    expect(isValidGameId('é')).toBe(false);
    expect(isValidGameId('a b')).toBe(false);
    reject(bytes(hello('a b')));
    reject(bytes(hello('ok', 9)));
    reject(bytes(hello('ok', 1)));
    reject(bytes(hello('ok', 2, 0)));
    reject(bytes(hello('ok', 2, 5)));
    reject(bytes(hello('ok', 2, 3)));
  });

  it('accepte un HELLO d’une autre version, quel que soit son format', () => {
    const out = createMessage();
    expect(decode(Uint8Array.from([MSG_HELLO, PROTOCOL_VERSION + 1, 1, 2, 3, 4, 5]), out)).toBe(
      null,
    );
    expect(out.version).toBe(PROTOCOL_VERSION + 1);
  });

  it('message vide, trop long, tronqué, type inconnu, octets en trop', () => {
    reject([]);
    reject(new Uint8Array(MAX_MESSAGE_BYTES + 1));
    reject([0]);
    reject([200]);
    const ping = createMessage();
    ping.type = MSG_PING;
    const data = bytes(ping);
    reject(data.subarray(0, data.length - 1));
    reject(Uint8Array.from([...data, 0]));
  });

  it('bornes de START', () => {
    const m = createMessage();
    m.type = MSG_START;
    m.players = 2;
    m.slotCount = 1;
    m.maxPrediction = 15;
    m.lateTolerance = 8;
    m.checksumInterval = 15;
    expect(decode(bytes(m), createMessage())).toBeNull();
    m.slots[0] = 2; // emplacement hors de la partie
    reject(bytes(m));
    m.slots[0] = 0;
    m.slotCount = 2; // deux fois le même emplacement
    reject(bytes(m));
    m.slotCount = 1;
    m.inputDelay = 9;
    reject(bytes(m));
    m.inputDelay = 2;
    m.maxPrediction = 0;
    reject(bytes(m));
    m.maxPrediction = 15;
    m.startAt = Number.NaN;
    reject(bytes(m));
  });

  it('bornes des blocs d’inputs', () => {
    const m = fullInputs();
    m.blockLength[3] = MAX_FRAMES_PER_MESSAGE + 1;
    reject(bytes(m));
    const twice = fullInputs();
    twice.blockPlayer[1] = twice.blockPlayer[0]!;
    reject(bytes(twice));
    const input = createMessage();
    input.type = MSG_INPUT;
    input.players = 2;
    input.blockCount = 5; // plus de blocs que de joueurs locaux possibles
    for (let b = 0; b < 5; b++) input.blockPlayer[b] = b;
    reject(bytes(input));
  });

  it('ne lève jamais d’exception sur 10 000 messages aléatoires ou tronqués', () => {
    const rng = new Rng(2026);
    const out = createMessage();
    const samples = [bytes(fullInputs()), bytes(hello())];
    let accepted = 0;
    for (let i = 0; i < 10_000; i++) {
      let data: Uint8Array;
      const kind = rng.range(3);
      if (kind === 0) {
        data = new Uint8Array(rng.range(64));
        for (let k = 0; k < data.length; k++) data[k] = rng.range(256);
        if (data.length > 0) data[0] = 1 + rng.range(11);
      } else {
        const source = samples[rng.range(samples.length)]!;
        data = source.slice(0, rng.range(source.length + 1));
        if (kind === 2 && data.length > 0) data[rng.range(data.length)] = rng.range(256);
      }
      const error = decode(data, out);
      if (error === null) accepted++;
      else expect(typeof error).toBe('string');
    }
    // Quelques messages aléatoires sont valides par hasard ; la plupart sont refusés.
    expect(accepted).toBeLessThan(5_000);
  });
});
