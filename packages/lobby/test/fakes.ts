/**
 * Outils des tests du service : connexions factices, horloge virtuelle, vrai relais en mode
 * réservé (sans réseau) branché sur le lobby comme le fera `server.ts`.
 */
import { createRelay, type Relay } from '@game/netcode/server';
import type { ClientMessage, ServerMessage } from '../src/protocol.ts';
import type { MatchRecord } from '../src/results.ts';
import {
  createLobby,
  type Lobby,
  type LobbyLimits,
  type LobbyPeer,
  type QuickMatchSettings,
  type TicketIdentity,
} from '../src/service.ts';

export const CONTENT = { fighters: ['vif', 'lourd'], stages: ['arene', 'falaise'] };

/** Ticket de test : « id|pseudo|invité|jti ». */
export function ticketFor(id: string, jti = `${id}-${Math.random()}`, guest = false): string {
  return `${id}|${id.toUpperCase()}|${guest ? 1 : 0}|${jti}`;
}

export function verifyTestTicket(ticket: string): TicketIdentity | null {
  const parts = ticket.split('|');
  if (parts.length !== 4 || parts[0] === '') return null;
  return { id: parts[0]!, name: parts[1]!, guest: parts[2] === '1', jti: parts[3]! };
}

export class FakeClient {
  readonly received: ServerMessage[] = [];
  closedWith: string | null = null;
  readonly peer: LobbyPeer;

  constructor(lobby: Lobby, address = '10.0.0.1') {
    this.peer = lobby.connect(
      {
        send: (text) => this.received.push(JSON.parse(text) as ServerMessage),
        close: (reason) => {
          this.closedWith = reason;
        },
      },
      address,
    );
  }

  send(m: ClientMessage | Record<string, unknown>): void {
    this.peer.receive(JSON.stringify(m));
  }

  raw(text: string): void {
    this.peer.receive(text);
  }

  hello(id: string, jti?: string): this {
    this.send({ t: 'hello', version: 1, ticket: ticketFor(id, jti) });
    return this;
  }

  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    for (let i = this.received.length - 1; i >= 0; i--) {
      if (this.received[i]!.t === t) return this.received[i] as Extract<ServerMessage, { t: T }>;
    }
    return undefined;
  }

  all<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }>[] {
    return this.received.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[];
  }

  room() {
    return this.last('room')?.room;
  }

  lastError() {
    return this.last('error');
  }

  disconnect(): void {
    this.peer.closed();
  }
}

export function setup(
  options: { limits?: Partial<LobbyLimits>; quick?: Partial<QuickMatchSettings> } = {},
) {
  let t = 1_000_000;
  let lobby: Lobby | null = null;
  const records: MatchRecord[] = [];
  const relay: Relay = createRelay({
    now: () => t,
    seed: () => 7,
    authenticate: (ticket) => (ticket.startsWith('relay:') ? { id: ticket.slice(6) } : null),
    onGameEvent: (e) => lobby?.relayEvent(e),
    onDesync: (gameId) => lobby?.relayDesync(gameId),
  });
  let n = 0;
  let r = 0;
  lobby = createLobby({
    now: () => t,
    relay,
    relayPath: '/net',
    verifyTicket: verifyTestTicket,
    content: CONTENT,
    random: (max) => (r++ * 7919) % max,
    uuid: () => `00000000-0000-4000-8000-${String(n++).padStart(12, '0')}`,
    onMatchResult: (record) => records.push(record),
    // Les clients factices ne pinguent pas : le silence est réglé haut, sauf dans son propre test.
    limits: { silenceMs: 3_600_000, ...options.limits },
    quick: options.quick,
  });
  const l = lobby;
  return {
    lobby: l,
    relay,
    records,
    now: () => t,
    advance(ms: number) {
      // Pas de 100 ms, comme l'hôte ; le relais à chaque pas aussi.
      const end = t + ms;
      while (t < end) {
        t = Math.min(end, t + 100);
        relay.tick();
        l.tick();
      }
    },
    client(id: string, address?: string) {
      return new FakeClient(l, address).hello(id);
    },
  };
}
