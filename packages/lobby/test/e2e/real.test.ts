/**
 * Bout en bout réel (SPEC-lobby.md, critère n° 7) : vrai serveur des comptes, vrai serveur de jeu
 * (lobby + relais réservé) sur des ports libres, trois clients Node sur de vrais WebSocket. Ils
 * prennent une session invité, créent et rejoignent un salon, choisissent, lancent un match en
 * mode Temps de 30 s, le finissent et reviennent au salon.
 */
import { createAccountsServer, createMemoryStore, type AccountsServer } from '@game/accounts';
import { createAccountsClient, type AccountsClient } from '@game/accounts-client';
import { createMatchSimConfig, matchResult } from '@game/match-rules';
import { createNetClient, simGame, webSocketTransport, type NetClient } from '@game/netcode';
import { createSim, type Sim } from '@game/sim-core';
import { TEST_FIGHTER, TEST_STAGE } from '@game/sim-core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLobbyClient, type LobbyClient } from '../../src/client.ts';
import type { MatchStartInfo } from '../../src/protocol.ts';
import type { MatchRecord } from '../../src/results.ts';
import { createGameServer, type GameServer } from '../../src/server.ts';
import { SHORT_RULES } from '../harness.ts';

const SECRET = 'cle-de-ticket-pour-le-bout-en-bout-du-lobby';

let accounts: AccountsServer;
let game: GameServer;
let accountsOrigin: string;
let wsOrigin: string;
let httpOrigin: string;
const records: MatchRecord[] = [];

/** `fetch` qui garde le cookie de session, comme un navigateur. */
function browserFetch(): typeof fetch {
  let cookie: string | null = null;
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (cookie !== null) headers.set('cookie', cookie);
    const response = await fetch(accountsOrigin + String(input), { ...init, headers });
    for (const line of response.headers.getSetCookie()) cookie = line.split(';')[0]!;
    return response;
  };
}

interface RealPlayer {
  readonly api: AccountsClient;
  readonly lobby: LobbyClient;
  net: NetClient | null;
  sim: Sim | null;
  reported: boolean;
  timer: ReturnType<typeof setInterval> | null;
}

async function realPlayer(pseudo: string): Promise<RealPlayer> {
  const api = createAccountsClient({ fetch: browserFetch() });
  const guest = await api.guest(pseudo);
  expect(guest.ok).toBe(true);
  const ticket = async (aud: 'lobby' | 'relay'): Promise<string | null> => {
    const t = await api.ticket(aud);
    return t.ok ? t.value.ticket : null;
  };
  const lobby = createLobbyClient({
    url: `${wsOrigin}/lobby`,
    getTicket: () => ticket('lobby'),
    now: () => performance.now(),
  });
  const player: RealPlayer = { api, lobby, net: null, sim: null, reported: false, timer: null };
  lobby.onMatchStart((match: MatchStartInfo) => {
    void (async () => {
      const relayTicket = await ticket('relay');
      const net = createNetClient({
        transport: webSocketTransport(`${wsOrigin}${match.relayPath}`),
        gameId: match.gameId,
        players: match.players.length,
        localPlayers: 1,
        ticket: relayTicket ?? '',
        now: () => performance.now(),
      });
      player.net = net;
      player.sim = null;
      player.reported = false;
      let k = 0;
      const timer = setInterval(() => {
        if (net.status === 'starting' && player.sim === null) {
          player.sim = createSim(
            createMatchSimConfig(match.config, {
              stage: TEST_STAGE,
              fighters: match.players.map(() => TEST_FIGHTER),
              seed: net.match!.seed,
            }),
          );
          net.begin(simGame(player.sim));
        }
        net.update((out) => {
          k++;
          out[0] = (k >> 4) % 3 === 0 ? 1 << (k % 8) : 0;
        });
        const sim = player.sim;
        if (sim !== null && !player.reported) {
          const result = matchResult(sim);
          if (result !== null && net.stats().confirmedFrame > result.endFrame) {
            player.reported = true;
            lobby.reportResult(match.gameId, result);
          }
        }
        if (net.status === 'closed') clearInterval(timer);
      }, 16);
      player.timer = timer;
    })();
  });
  return player;
}

async function until(predicate: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) throw new Error(`délai dépassé : ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeAll(async () => {
  accounts = createAccountsServer({
    host: '127.0.0.1',
    port: 0,
    store: createMemoryStore(),
    ticketSecrets: [SECRET],
    allowedOrigins: [],
    secureCookies: false,
    trustProxy: false,
    hashing: { logN: 10, r: 8, p: 1 },
    log: () => {},
  });
  accountsOrigin = `http://127.0.0.1:${(await accounts.listen()).port}`;
  game = createGameServer({
    host: '127.0.0.1',
    port: 0,
    ticketSecrets: [SECRET],
    content: { fighters: ['mannequin'], stages: ['arene-test'] },
    onMatchResult: (r) => records.push(r),
  });
  const port = (await game.listen()).port;
  wsOrigin = `ws://127.0.0.1:${port}`;
  httpOrigin = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await game?.close();
  await accounts?.close();
});

describe('bout en bout réel', () => {
  it('trois invités : salon, choix, match de 30 s jusqu’au bout, retour au salon', async () => {
    const players = await Promise.all(['Ana', 'Ben', 'Cyd'].map((p) => realPlayer(p)));
    await until(() => players.every((p) => p.lobby.state.status === 'online'), 5_000, 'connexion');
    expect(players[0]!.lobby.state.you).toMatchObject({ name: 'Ana', guest: true });
    const [host, ...others] = players;
    host!.lobby.createRoom();
    await until(() => host!.lobby.state.room !== null, 2_000, 'salon');
    const code = host!.lobby.state.room!.code!;
    for (const p of others) p.lobby.joinRoom(code);
    await until(() => host!.lobby.state.room!.members.length === 3, 2_000, 'arrivées');
    host!.lobby.setRules({ rules: SHORT_RULES, stage: 'arene-test' });
    for (const p of players) p.lobby.setFighter('mannequin');
    await new Promise((r) => setTimeout(r, 200));
    for (const p of others) p.lobby.setReady(true);
    const hostId = host!.lobby.state.you!.id;
    await until(
      () => host!.lobby.state.room!.members.every((m) => m.ready || m.id === hostId),
      2_000,
      'prêts',
    );
    host!.lobby.start();
    await until(() => players.every((p) => p.net?.status === 'running'), 15_000, 'partie lancée');
    await until(() => records.length === 1, 60_000, 'fin du match');
    expect(records[0]!.status).toBe('agreed');
    expect(records[0]!.players.map((p) => p.guest)).toEqual([true, true, true]);
    await until(
      () =>
        players.every(
          (p) =>
            p.lobby.state.room?.phase === 'lobby' && p.lobby.state.lastEnd?.status === 'agreed',
        ),
      5_000,
      'retour au salon',
    );
    for (const p of players) {
      if (p.timer !== null) clearInterval(p.timer);
      p.lobby.close();
    }
  }, 90_000);

  it('refuse un ticket d’une autre audience au lobby comme au relais', async () => {
    const api = createAccountsClient({ fetch: browserFetch() });
    await api.guest('Dee');
    const relayTicket = await api.ticket('relay');
    const messages: string[] = [];
    const ws = new WebSocket(`${wsOrigin}/lobby`);
    await new Promise<void>((resolve) => {
      ws.onopen = () =>
        ws.send(
          JSON.stringify({
            t: 'hello',
            version: 1,
            ticket: relayTicket.ok ? relayTicket.value.ticket : '',
          }),
        );
      ws.onmessage = (e) => messages.push(String(e.data));
      ws.onclose = () => resolve();
    });
    expect(messages.some((m) => m.includes('"ticket"'))).toBe(true);
    const lobbyTicket = await api.ticket('lobby');
    const net = createNetClient({
      transport: webSocketTransport(`${wsOrigin}/net`),
      gameId: 'nimporte',
      players: 2,
      localPlayers: 1,
      ticket: lobbyTicket.ok ? lobbyTicket.value.ticket : '',
      now: () => performance.now(),
    });
    await until(() => net.status === 'closed', 5_000, 'refus du relais');
    expect(net.error).toMatch(/Ticket/);
  });

  it('message trop gros, binaire ou invalide sur un vrai WebSocket : connexion fermée', async () => {
    const big = new WebSocket(`${wsOrigin}/lobby`);
    const code = await new Promise<number>((resolve) => {
      big.onopen = () => big.send('x'.repeat(100_000));
      big.onclose = (e) => resolve(e.code);
    });
    expect(code).not.toBe(1000);
    const bad = new WebSocket(`${wsOrigin}/lobby`);
    const got: string[] = [];
    await new Promise<void>((resolve) => {
      bad.onopen = () => {
        bad.send(new Uint8Array([1, 2, 3]));
        bad.send('{');
        bad.send('[]');
      };
      bad.onmessage = (e) => got.push(String(e.data));
      bad.onclose = () => resolve();
    });
    expect(got.some((m) => m.includes('"bye"') && m.includes('invalid'))).toBe(true);
    // Le serveur répond toujours.
    expect((await fetch(`${httpOrigin}/health`)).status).toBe(200);
  });
});
