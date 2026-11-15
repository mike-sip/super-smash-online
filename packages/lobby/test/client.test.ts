/** Client du lobby contre le vrai service, sur des WebSocket en mémoire (T10). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLobbyClient, type LobbyClient } from '../src/client.ts';
import type { MatchStartInfo } from '../src/protocol.ts';
import { setup, ticketFor } from './fakes.ts';
import { memoryNetwork } from './memory-socket.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const flush = () => vi.advanceTimersByTimeAsync(0);

function newClient(env: ReturnType<typeof setup>, id: string, net = memoryNetwork(env.lobby)) {
  let tickets = 0;
  const client = createLobbyClient({
    url: 'ws://test/lobby',
    getTicket: async () => {
      tickets++;
      return ticketFor(id);
    },
    now: () => env.now(),
    WebSocket: net.WebSocket,
  });
  return { client, net, tickets: () => tickets };
}

describe('client du lobby', () => {
  it('se présente, puis suit le salon ; les commandes passent', async () => {
    const env = setup();
    const { client: a } = newClient(env, 'alice');
    const { client: b } = newClient(env, 'bob');
    await flush();
    expect(a.state.status).toBe('online');
    expect(a.state.you?.id).toBe('alice');
    expect(a.state.content.fighters).toEqual(['vif', 'lourd']);
    a.createRoom(4);
    await flush();
    const code = a.state.room!.code!;
    b.joinRoom(code.toLowerCase());
    await flush();
    expect(a.state.room!.members.map((m) => m.id)).toEqual(['alice', 'bob']);
    b.setFighter('vif');
    a.setFighter('lourd');
    b.setReady(true);
    a.setRules({ locked: true });
    await flush();
    expect(b.state.room).toMatchObject({ locked: true, capacity: 4 });
    const starts: MatchStartInfo[] = [];
    b.onMatchStart((m) => starts.push(m));
    a.start();
    await flush();
    expect(b.state.countdown).toBe(3);
    env.advance(3_100);
    await flush();
    expect(starts).toHaveLength(1);
    expect(b.state.match?.slot).toBe(1);
    expect(b.state.room?.phase).toBe('playing');
  });

  it('affiche les refus du serveur dans l’état, sans exception', async () => {
    const env = setup();
    const { client } = newClient(env, 'alice');
    await flush();
    client.joinRoom('ZZZZZZ');
    await flush();
    expect(client.state.error?.code).toBe('not_found');
  });

  it('se reconnecte après une coupure, avec un nouveau ticket, et retrouve son salon', async () => {
    const env = setup();
    const { client, net, tickets } = newClient(env, 'alice');
    await flush();
    client.createRoom();
    await flush();
    const code = client.state.room!.code;
    net.dropAll();
    await flush();
    expect(client.state.status).toBe('offline');
    await vi.advanceTimersByTimeAsync(600);
    expect(client.state.status).toBe('online');
    expect(tickets()).toBe(2);
    expect(client.state.room?.code).toBe(code);
  });

  it('attend de plus en plus longtemps quand le serveur est éteint', async () => {
    const env = setup();
    const net = memoryNetwork(env.lobby);
    net.setDown(true);
    const { client } = newClient(env, 'alice', net);
    await flush();
    expect(client.state.status).toBe('offline');
    await vi.advanceTimersByTimeAsync(500 + 1000 + 2000);
    expect(net.opened).toBe(0);
    net.setDown(false);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(client.state.status).toBe('online');
  });

  it('pendant une partie, la reconnexion renvoie matchStart', async () => {
    const env = setup();
    const { client: a } = newClient(env, 'alice');
    const { client: b, net } = newClient(env, 'bob');
    await flush();
    a.createRoom();
    await flush();
    b.joinRoom(a.state.room!.code!);
    a.setFighter('vif');
    b.setFighter('vif');
    b.setReady(true);
    a.start();
    await flush();
    env.advance(3_100);
    await flush();
    const seen: string[] = [];
    b.onMatchStart((m) => seen.push(m.gameId));
    net.dropAll();
    await vi.advanceTimersByTimeAsync(600);
    expect(seen).toEqual([a.state.match!.gameId]);
  });

  it('une connexion ouverte ailleurs ferme celle-ci sans reconnexion', async () => {
    const env = setup();
    const { client: first } = newClient(env, 'alice');
    await flush();
    const { client: second } = newClient(env, 'alice');
    await flush();
    expect(first.state.status).toBe('closed');
    expect(first.state.error?.code).toBe('replaced');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(second.state.status).toBe('online');
    expect(first.state.status).toBe('closed');
  });

  it('envoie un ping toutes les 5 s avec l’aller-retour mesuré ; close() arrête tout', async () => {
    const env = setup();
    const { client } = newClient(env, 'alice');
    await flush();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(client.state.rttMs).not.toBeNull();
    client.close();
    await flush();
    expect(client.state.status).toBe('closed');
    const closed: LobbyClient = client;
    closed.createRoom();
    expect(closed.state.error?.code).toBe('network');
  });
});
