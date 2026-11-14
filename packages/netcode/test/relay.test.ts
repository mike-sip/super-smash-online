import { describe, expect, it } from 'vitest';
import { FRAME_MS, MAX_FRAMES_PER_MESSAGE } from '../src/constants.ts';
import {
  ERR_FULL,
  ERR_INVALID,
  ERR_MISMATCH,
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
} from '../src/protocol.ts';
import { createRelay, type Relay, type RelayOptions, type RelayPeer } from '../src/server/relay.ts';

/** Client factice : envoie des messages au relais et garde ceux qu'il reçoit, décodés. */
class FakeClient {
  readonly received: Message[] = [];
  closedWith: string | null = null;
  readonly peer: RelayPeer;
  private readonly buf = new Uint8Array(MAX_MESSAGE_BYTES);

  constructor(relay: Relay) {
    this.peer = relay.connect({
      send: (data) => {
        const m = createMessage();
        const error = decode(data, m);
        if (error !== null) throw new Error(`le relais a envoyé un message invalide : ${error}`);
        this.received.push(m);
      },
      close: (reason) => {
        this.closedWith = reason;
      },
    });
  }

  send(fill: (m: Message) => void): void {
    const m = createMessage();
    fill(m);
    this.peer.receive(this.buf.slice(0, encode(m, this.buf)));
  }

  hello(gameId: string, players: number, localPlayers = 1, version = PROTOCOL_VERSION): void {
    this.send((m) => {
      m.type = MSG_HELLO;
      m.version = version;
      m.gameId = gameId;
      m.players = players;
      m.localPlayers = localPlayers;
    });
  }

  /** Envoie des inputs pour un emplacement, avec des accusés. */
  input(players: number, slot: number, start: number, inputs: number[], acks?: number[]): void {
    this.send((m) => {
      m.type = MSG_INPUT;
      m.players = players;
      for (let p = 0; p < players; p++) m.acks[p] = acks?.[p] ?? 0;
      m.blockCount = 1;
      m.blockPlayer[0] = slot;
      m.blockStart[0] = start;
      m.blockLength[0] = inputs.length;
      for (let k = 0; k < inputs.length; k++) m.blockInputs[k] = inputs[k]!;
    });
  }

  checksum(frame: number, value: number): void {
    this.send((m) => {
      m.type = MSG_CHECKSUM;
      m.frame = frame;
      m.value = value;
    });
  }

  last(type: number): Message | undefined {
    for (let i = this.received.length - 1; i >= 0; i--) {
      if (this.received[i]!.type === type) return this.received[i];
    }
    return undefined;
  }

  all(type: number): Message[] {
    return this.received.filter((m) => m.type === type);
  }

  /** Inputs confirmés reçus pour un joueur, par frame. */
  inputsOf(player: number): Map<number, number> {
    const out = new Map<number, number>();
    for (const m of this.all(MSG_INPUTS)) {
      for (let b = 0; b < m.blockCount; b++) {
        if (m.blockPlayer[b] !== player) continue;
        for (let k = 0; k < m.blockLength[b]!; k++) {
          out.set(m.blockStart[b]! + k, m.blockInputs[b * MAX_FRAMES_PER_MESSAGE + k]!);
        }
      }
    }
    return out;
  }
}

function setup(options: Partial<RelayOptions> = {}) {
  let t = 1000;
  const relay = createRelay({ now: () => t, seed: () => 42, record: true, ...options });
  return {
    relay,
    advance(ms: number) {
      t += ms;
      relay.tick();
    },
    now: () => t,
  };
}

/** Deux clients dans une partie commencée, à la frame 0 de l'horloge du serveur. */
function started(options: Partial<RelayOptions> = {}) {
  const env = setup(options);
  const a = new FakeClient(env.relay);
  const b = new FakeClient(env.relay);
  a.hello('duel', 2);
  b.hello('duel', 2);
  const startAt = a.last(MSG_START)!.startAt;
  env.advance(startAt - env.now());
  return { ...env, a, b };
}

describe('relais : arrivée dans une partie', () => {
  it('fait attendre, puis démarre 2 s après le dernier arrivé avec les emplacements', () => {
    const { relay, now } = setup();
    const a = new FakeClient(relay);
    a.hello('salon', 3);
    expect(a.last(MSG_WAITING)).toMatchObject({ joined: 1, players: 3 });
    const b = new FakeClient(relay);
    b.hello('salon', 3, 2);
    const startA = a.last(MSG_START)!;
    const startB = b.last(MSG_START)!;
    expect(startA.seed).toBe(42);
    expect(startA.players).toBe(3);
    expect(Array.from(startA.slots.subarray(0, startA.slotCount))).toEqual([0]);
    expect(Array.from(startB.slots.subarray(0, startB.slotCount))).toEqual([1, 2]);
    expect(startA.startAt).toBe(now() + 2000);
    expect([
      startA.inputDelay,
      startA.maxPrediction,
      startA.lateTolerance,
      startA.checksumInterval,
    ]).toEqual([2, 15, 8, 15]);
    expect(relay.gameCount()).toBe(1);
  });

  it('refuse une autre version, une partie pleine, commencée ou au nombre de joueurs différent', () => {
    const { relay } = setup();
    const old = new FakeClient(relay);
    old.hello('x', 2, 1, PROTOCOL_VERSION + 1);
    expect(old.last(MSG_ERROR)!.code).toBe(ERR_VERSION);
    expect(old.closedWith).not.toBeNull();

    const a = new FakeClient(relay);
    a.hello('x', 3);
    const wrong = new FakeClient(relay);
    wrong.hello('x', 4);
    expect(wrong.last(MSG_ERROR)!.code).toBe(ERR_MISMATCH);
    const greedy = new FakeClient(relay);
    greedy.hello('x', 3, 3);
    expect(greedy.last(MSG_ERROR)!.code).toBe(ERR_FULL);
    const b = new FakeClient(relay);
    b.hello('x', 3, 2);
    expect(b.last(MSG_START)).toBeDefined();
    const late = new FakeClient(relay);
    late.hello('x', 3);
    expect(late.last(MSG_ERROR)!.code).toBe(ERR_STARTED);
  });

  it('répond aux pings avec l’heure du serveur, avant comme après HELLO', () => {
    const { relay, now } = setup();
    const a = new FakeClient(relay);
    a.send((m) => {
      m.type = MSG_PING;
      m.clientTime = 12.5;
    });
    expect(a.last(MSG_PONG)).toMatchObject({ clientTime: 12.5, serverTime: now() });
  });

  it('libère l’emplacement d’un joueur parti avant le départ et annule le départ programmé', () => {
    const { relay } = setup();
    const a = new FakeClient(relay);
    const b = new FakeClient(relay);
    a.hello('p', 2);
    b.hello('p', 2);
    expect(a.last(MSG_START)).toBeDefined();
    b.peer.closed();
    expect(a.received.at(-1)).toMatchObject({ type: MSG_WAITING, joined: 1 });
    const c = new FakeClient(relay);
    c.hello('p', 2);
    expect(c.last(MSG_START)!.slots[0]).toBe(1);
    a.peer.closed();
    c.peer.closed();
    expect(relay.gameCount()).toBe(0);
  });

  it('supprime une partie qui attend depuis trop longtemps', () => {
    const env = setup({ waitingTimeoutMs: 5000 });
    const a = new FakeClient(env.relay);
    a.hello('seul', 2);
    env.advance(5001);
    expect(a.last(MSG_ERROR)!.code).toBe(ERR_TIMEOUT);
    expect(env.relay.gameCount()).toBe(0);
  });

  it('ferme la connexion sur un message invalide ou inattendu', () => {
    const { relay } = setup();
    const a = new FakeClient(relay);
    a.peer.receive(Uint8Array.from([MSG_INPUT, 1, 2]));
    expect(a.last(MSG_ERROR)!.code).toBe(ERR_INVALID);
    expect(a.closedWith).not.toBeNull();
    const b = new FakeClient(relay);
    b.checksum(15, 1); // avant HELLO
    expect(b.last(MSG_ERROR)!.code).toBe(ERR_INVALID);
  });
});

describe('relais : inputs', () => {
  it('relaie aussitôt les inputs confirmés à tous, auteur compris', () => {
    const { a, b } = started();
    a.input(2, 0, 2, [7, 8, 9]);
    for (const c of [a, b]) {
      const got = c.inputsOf(0);
      expect([got.get(2), got.get(3), got.get(4)]).toEqual([7, 8, 9]);
    }
  });

  it('ignore les inputs d’un emplacement qui n’est pas celui du client, et les trous', () => {
    const { a, b } = started();
    a.input(2, 1, 2, [5]);
    a.input(2, 0, 4, [5]);
    expect(b.inputsOf(1).size).toBe(0);
    expect(b.inputsOf(0).size).toBe(0);
  });

  it('applique la partie nouvelle d’un envoi redondant', () => {
    const { relay, a } = started();
    a.input(2, 0, 2, [1, 2]);
    a.input(2, 0, 2, [99, 99, 3]);
    expect(
      relay
        .history('duel')!
        .slice(2, 5)
        .map((row) => row[0]),
    ).toEqual([1, 2, 3]);
  });

  it('renvoie ce qui n’est pas accusé, et plus ce qui l’est', () => {
    const env = started();
    const { a, b } = env;
    a.input(2, 0, 2, [1, 2, 3]);
    const sends = b.all(MSG_INPUTS).length;
    env.advance(110); // délai de renvoi dépassé, toujours pas d'accusé
    const resent = b.all(MSG_INPUTS).slice(sends);
    expect(resent.some((m) => m.blockPlayer[0] === 0 && m.blockStart[0] === 2)).toBe(true);
    // B accuse jusqu'à la frame 5 pour le joueur 0 : plus rien d'antérieur ne lui est renvoyé.
    b.input(2, 1, 2, [0], [5, 2]);
    const count = b.all(MSG_INPUTS).length;
    env.advance(110);
    for (const m of b.all(MSG_INPUTS).slice(count)) {
      for (let k = 0; k < m.blockCount; k++) {
        if (m.blockPlayer[k] === 0) expect(m.blockStart[k]).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it('remplace un input en retard de G frames par le précédent', () => {
    const env = started();
    const { a, b } = env;
    a.input(2, 0, 2, [5, 6]); // frames 2 et 3
    b.input(2, 1, 2, [9]); // frame 2, puis plus rien
    // Le serveur atteint la frame 3 + 8 : l'input de B pour la frame 3 est remplacé par 9.
    env.advance(FRAME_MS * 11.5);
    expect(a.inputsOf(1).get(3)).toBe(9);
    expect(a.inputsOf(0).has(4)).toBe(false);
    // Frame 12 : l'input de A pour la frame 4 est remplacé par 6.
    env.advance(FRAME_MS);
    expect(b.inputsOf(0).get(4)).toBe(6);
    // Un input arrivé après son remplacement est ignoré.
    b.input(2, 1, 3, [77]);
    expect(env.relay.history('duel')![3]![1]).toBe(9);
  });

  it('refuse des inputs trop en avance sur l’horloge du serveur', () => {
    const { a, relay } = started();
    const many = Array.from({ length: MAX_FRAMES_PER_MESSAGE }, () => 1);
    for (let start = 2; start < 200; start += MAX_FRAMES_PER_MESSAGE) a.input(2, 0, start, many);
    const confirmed = relay.history('duel')!.filter((row) => row[0] === 1).length;
    expect(confirmed).toBeGreaterThan(30);
    expect(confirmed).toBeLessThanOrEqual(61);
  });

  it('annonce un joueur parti et confirme pour lui des inputs neutres d’avance', () => {
    const env = started();
    const { a, b, relay } = env;
    b.input(2, 1, 2, [3, 3]);
    b.peer.closed();
    const left = a.last(MSG_LEFT)!;
    expect([left.slot, left.frame]).toEqual([1, 4]);
    const history = relay.history('duel')!;
    // Au moins D + P frames d'avance, toutes neutres.
    expect(history.length).toBeGreaterThanOrEqual(2 + 15);
    for (let f = 4; f < history.length; f++) expect(history[f]![1]).toBe(0);
    a.peer.closed();
    expect(relay.gameCount()).toBe(0);
    // L'historique reste lisible après la fin de la partie.
    expect(relay.history('duel')).toBe(history);
  });
});

describe('relais : désynchronisations', () => {
  function confirmUpTo(env: ReturnType<typeof started>, frame: number): void {
    env.advance(FRAME_MS * frame);
    const zeros = (n: number) => Array.from({ length: n }, () => 0);
    for (let start = 2; start < frame + 1; start += MAX_FRAMES_PER_MESSAGE) {
      const n = Math.min(MAX_FRAMES_PER_MESSAGE, frame + 1 - start);
      env.a.input(2, 0, start, zeros(n));
      env.b.input(2, 1, start, zeros(n));
    }
  }

  it('ne dit rien quand les empreintes concordent', () => {
    const env = started();
    confirmUpTo(env, 20);
    env.a.checksum(15, 0xabc);
    env.b.checksum(15, 0xabc);
    expect(env.a.all(MSG_DESYNC)).toEqual([]);
  });

  it('signale à tous le premier écart, une seule fois', () => {
    const desyncs: [string, number, readonly number[]][] = [];
    const env = started({ onDesync: (id, frame, sums) => desyncs.push([id, frame, sums]) });
    confirmUpTo(env, 40);
    env.a.checksum(15, 1);
    env.b.checksum(15, 2);
    env.a.checksum(30, 1);
    env.b.checksum(30, 2);
    for (const c of [env.a, env.b]) {
      const all = c.all(MSG_DESYNC);
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ frame: 15, players: 2, reportedMask: 0b11 });
      expect(Array.from(all[0]!.checksums.subarray(0, 2))).toEqual([1, 2]);
    }
    expect(desyncs).toEqual([['duel', 15, [1, 2]]]);
  });

  it('ignore une empreinte d’un état pas encore confirmé ou hors intervalle', () => {
    const env = started();
    confirmUpTo(env, 20);
    env.a.checksum(30, 1);
    env.b.checksum(30, 2);
    env.a.checksum(16, 1);
    env.b.checksum(16, 2);
    expect(env.a.all(MSG_DESYNC)).toEqual([]);
  });

  it('compare sans attendre un client parti', () => {
    const env = started();
    confirmUpTo(env, 20);
    env.a.checksum(15, 1);
    env.b.peer.closed();
    expect(env.a.all(MSG_DESYNC)).toEqual([]);
  });
});
