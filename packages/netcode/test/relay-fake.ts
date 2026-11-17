/**
 * Client factice du relais pour les tests du mode réservé et de la reconnexion : envoie des
 * messages au relais et garde ceux qu'il reçoit, décodés. (Le même principe que dans
 * `relay.test.ts`, avec le ticket en plus.)
 */
import { MAX_FRAMES_PER_MESSAGE } from '../src/constants.ts';
import {
  MAX_MESSAGE_BYTES,
  MSG_HELLO,
  MSG_INPUT,
  MSG_INPUTS,
  PROTOCOL_VERSION,
  createMessage,
  decode,
  encode,
  type Message,
} from '../src/protocol.ts';
import { createRelay, type Relay, type RelayOptions, type RelayPeer } from '../src/server/relay.ts';

export class FakeClient {
  readonly received: Message[] = [];
  closedWith: string | null = null;
  readonly peer: RelayPeer;
  private readonly buf = new Uint8Array(MAX_MESSAGE_BYTES);
  private readonly relay: Relay;

  constructor(relay: Relay) {
    this.relay = relay;
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
    this.relay.tick();
  }

  hello(gameId: string, players: number, ticket = '', localPlayers = 1): void {
    this.send((m) => {
      m.type = MSG_HELLO;
      m.version = PROTOCOL_VERSION;
      m.gameId = gameId;
      m.players = players;
      m.localPlayers = localPlayers;
      m.ticket = ticket;
    });
  }

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

  /** Simule la coupure de la connexion côté client. */
  disconnect(): void {
    this.peer.closed();
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

/** Tickets de test : « ok:<id> » est accepté, tout le reste refusé. */
export function testAuthenticate(ticket: string): { id: string } | null {
  return ticket.startsWith('ok:') && ticket.length > 3 ? { id: ticket.slice(3) } : null;
}

export function reservedSetup(options: Partial<RelayOptions> = {}) {
  let t = 1000;
  const events: unknown[] = [];
  const relay = createRelay({
    now: () => t,
    seed: () => 42,
    record: true,
    authenticate: testAuthenticate,
    onGameEvent: (e) => events.push(e),
    ...options,
  });
  return {
    relay,
    events,
    advance(ms: number) {
      t += ms;
      relay.tick();
    },
    now: () => t,
  };
}
