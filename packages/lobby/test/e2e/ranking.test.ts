/**
 * Bout en bout réel lobby → classement (SPEC-app-shell.md, « Intégration ») : vrai serveur des
 * comptes avec le classement, vrai serveur de jeu dont les résultats partent par l'expéditeur
 * HTTP signé, deux joueurs inscrits sur de vrais WebSocket.
 *
 * Entre le serveur de jeu et le classement, un relais HTTP qu'on peut couper simule une panne du
 * serveur des comptes.
 */
import { createServer, request, type Server } from 'node:http';
import { createMemoryStore } from '@game/accounts';
import { createAccountsClient, type AccountsClient } from '@game/accounts-client';
import { createMatchSimConfig, matchResult } from '@game/match-rules';
import {
  createGameServer as createAccountsAndRanking,
  createMemoryRankingStore,
  signReport,
  type GameServer as AccountsAndRanking,
} from '@game/ranking';
import { createNetClient, simGame, webSocketTransport, type NetClient } from '@game/netcode';
import { STICK_MAX, createSim, encodeInput, type Sim } from '@game/sim-core';
import { TEST_FIGHTER, TEST_STAGE } from '@game/sim-core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLobbyClient, type LobbyClient } from '../../src/client.ts';
import type { MatchStartInfo } from '../../src/protocol.ts';
import {
  createRankingReporter,
  reportFromRecord,
  type RankingReporter,
} from '../../src/ranking-report.ts';
import type { MatchRecord } from '../../src/results.ts';
import { createGameServer, type GameServer } from '../../src/server.ts';
import { SHORT_RULES } from '../harness.ts';

const TICKET_SECRET = 'cle-de-ticket-pour-le-bout-en-bout-classement';
const REPORT_SECRET = 'cle-de-rapport-pour-le-bout-en-bout-classement';
/** Durée du match de test (Temps, 30 s), en frames. */
const MATCH_FRAMES = SHORT_RULES.timeLimit * 60;

let backend: AccountsAndRanking;
let game: GameServer;
let gate: Server;
let reporter: RankingReporter;
let backendOrigin: string;
let wsOrigin: string;
/** Relais coupé : les connexions vers le classement échouent. */
let down = false;
const records: MatchRecord[] = [];

/** `fetch` qui garde le cookie de session, comme un navigateur. */
function browserFetch(): typeof fetch {
  let cookie: string | null = null;
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (cookie !== null) headers.set('cookie', cookie);
    const response = await fetch(backendOrigin + String(input), { ...init, headers });
    for (const line of response.headers.getSetCookie()) cookie = line.split(';')[0]!;
    return response;
  };
}

interface RealPlayer {
  readonly fetch: typeof fetch;
  readonly api: AccountsClient;
  readonly lobby: LobbyClient;
  net: NetClient | null;
  timer: ReturnType<typeof setInterval> | null;
}

async function registered(pseudo: string): Promise<RealPlayer> {
  const fetchWithCookie = browserFetch();
  const api = createAccountsClient({ fetch: fetchWithCookie });
  const created = await api.register(pseudo, `${pseudo}-Mot-De-Passe-Solide-2026`);
  expect(created.ok).toBe(true);
  const ticket = async (aud: 'lobby' | 'relay'): Promise<string | null> => {
    const t = await api.ticket(aud);
    return t.ok ? t.value.ticket : null;
  };
  const lobby = createLobbyClient({
    url: `${wsOrigin}/lobby`,
    getTicket: () => ticket('lobby'),
    now: () => performance.now(),
  });
  const player: RealPlayer = { fetch: fetchWithCookie, api, lobby, net: null, timer: null };
  lobby.onMatchStart((match: MatchStartInfo) => {
    void (async () => {
      // Le ticket d'abord : le transport doit être donné au client dès son ouverture.
      const relayTicket = (await ticket('relay')) ?? '';
      const net = createNetClient({
        transport: webSocketTransport(`${wsOrigin}${match.relayPath}`),
        gameId: match.gameId,
        players: match.players.length,
        localPlayers: 1,
        ticket: relayTicket,
        now: () => performance.now(),
      });
      player.net = net;
      let sim: Sim | null = null;
      let reported = false;
      let k = 0;
      if (player.timer !== null) clearInterval(player.timer);
      const timer = setInterval(() => {
        if (net.status === 'starting' && sim === null) {
          sim = createSim(
            createMatchSimConfig(match.config, {
              stage: TEST_STAGE,
              fighters: match.players.map(() => TEST_FIGHTER),
              seed: net.match!.seed,
            }),
          );
          net.begin(simGame(sim));
        }
        net.update((out) => {
          k++;
          // Les 12 dernières secondes, la place 1 court hors du stage et la place 0 attend :
          // le match ne finit pas à égalité (la mort subite sans limite ne s'arrêterait qu'au KO).
          if (net.stats().frame > MATCH_FRAMES - 12 * 60) {
            out[0] = match.slot === 1 ? encodeInput(-STICK_MAX, 0, 0) : 0;
          } else {
            out[0] = (k >> 4) % 3 === 0 ? 1 << (k % 8) : 0;
          }
        });
        if (sim !== null && !reported) {
          const result = matchResult(sim);
          if (result !== null && net.stats().confirmedFrame > result.endFrame) {
            reported = true;
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

interface Profile {
  rating: number | null;
  rankedMatches: number;
  matchesPlayed: number;
}

async function profile(p: RealPlayer): Promise<Profile> {
  const response = await p.fetch('/api/ranking/v1/me');
  expect(response.status).toBe(200);
  return ((await response.json()) as { profile: Profile }).profile;
}

async function history(p: RealPlayer): Promise<{ ranked: boolean; delta: number | null }[]> {
  const response = await p.fetch('/api/ranking/v1/me/matches');
  expect(response.status).toBe(200);
  return ((await response.json()) as { matches: { ranked: boolean; delta: number | null }[] })
    .matches;
}

beforeAll(async () => {
  backend = createAccountsAndRanking(
    {
      host: '127.0.0.1',
      port: 0,
      store: createMemoryStore(),
      ticketSecrets: [TICKET_SECRET],
      allowedOrigins: [],
      secureCookies: false,
      trustProxy: false,
      hashing: { logN: 10, r: 8, p: 1 },
      log: () => {},
    },
    { store: createMemoryRankingStore(), reportSecrets: [REPORT_SECRET] },
  );
  const backendPort = (await backend.listen()).port;
  backendOrigin = `http://127.0.0.1:${backendPort}`;

  // Relais coupable entre le serveur de jeu et le classement.
  gate = createServer((req, res) => {
    if (down) {
      req.socket.destroy();
      return;
    }
    const upstream = request(
      {
        host: '127.0.0.1',
        port: backendPort,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on('error', () => res.destroy());
    req.pipe(upstream);
  });
  await new Promise<void>((resolve) => gate.listen(0, '127.0.0.1', resolve));
  const gatePort = (gate.address() as { port: number }).port;

  reporter = createRankingReporter({
    url: `http://127.0.0.1:${gatePort}/api/ranking/v1/matches`,
    secret: REPORT_SECRET,
    now: () => Date.now(),
    fetch: (input, init) => fetch(input, init),
    setTimer: (fn, ms) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    },
  });
  game = createGameServer({
    host: '127.0.0.1',
    port: 0,
    ticketSecrets: [TICKET_SECRET],
    content: { fighters: ['mannequin'], stages: ['arene-test'] },
    quick: { rules: SHORT_RULES, maxWaitMs: 300, countdownMs: 300 },
    onMatchResult: (r) => {
      records.push(r);
      reporter.submit(r);
    },
    health: () => ({ reportsPending: reporter.pending() }),
  });
  wsOrigin = `ws://127.0.0.1:${(await game.listen()).port}`;
});

afterAll(async () => {
  await game?.close();
  await reporter?.close();
  await new Promise<void>((resolve) => (gate ? gate.close(() => resolve()) : resolve()));
  await backend?.close();
});

describe('bout en bout réel lobby → classement', () => {
  it('partie rapide entre inscrits classée, doublon sans effet, salon privé non classé, panne rattrapée', async () => {
    const [ana, ben] = await Promise.all([registered('Anaelle'), registered('Benoit')]);
    const both = [ana!, ben!];
    await until(() => both.every((p) => p.lobby.state.status === 'online'), 5_000, 'connexion');

    // 1. Partie rapide : classée.
    for (const p of both) p.lobby.queue('eu', 'mannequin');
    await until(
      () => both.every((p) => p.net?.status === 'running'),
      20_000,
      'partie rapide lancée',
    );
    await until(() => records.length === 1, 70_000, 'fin de la partie rapide');
    const quick = records[0]!;
    expect(quick).toMatchObject({ status: 'agreed', ranked: true, kind: 'quick' });
    await until(() => reporter.pending() === 0, 10_000, 'rapport accepté');

    const [pa, pb] = await Promise.all(both.map(profile));
    const ratings = [pa!.rating!, pb!.rating!].sort((a, b) => a - b);
    expect(ratings[0]! + ratings[1]!).toBe(2000);
    expect([
      [984, 1016],
      [1000, 1000],
    ]).toContainEqual(ratings);
    for (const p of [pa!, pb!]) expect(p).toMatchObject({ rankedMatches: 1, matchesPlayed: 1 });
    const firstHistory = await history(ana!);
    expect(firstHistory).toHaveLength(1);
    expect(firstHistory[0]!.ranked).toBe(true);

    // 2. Le même match renvoyé (date neuve) : « duplicate », rien ne change.
    const body = JSON.stringify(reportFromRecord(quick, Date.now()));
    const again = await fetch(`${backendOrigin}/api/ranking/v1/matches`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: signReport(body, REPORT_SECRET),
      },
      body,
    });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { status: string }).status).toBe('duplicate');
    expect((await profile(ana!)).rating).toBe(pa!.rating);

    // 3. Salon privé, avec le classement coupé pendant la fin du match.
    await until(
      () => both.every((p) => p.lobby.state.room?.phase === 'lobby'),
      10_000,
      'retour au salon',
    );
    for (const p of both) p.lobby.leaveRoom();
    await until(() => both.every((p) => p.lobby.state.room === null), 5_000, 'salon quitté');
    ana!.lobby.createRoom();
    await until(() => ana!.lobby.state.room !== null, 2_000, 'salon créé');
    ben!.lobby.joinRoom(ana!.lobby.state.room!.code!);
    await until(() => ana!.lobby.state.room!.members.length === 2, 2_000, 'arrivée');
    ana!.lobby.setRules({ rules: SHORT_RULES, stage: 'arene-test' });
    for (const p of both) p.lobby.setFighter('mannequin');
    await new Promise((r) => setTimeout(r, 200));
    ben!.lobby.setReady(true);
    await until(
      () =>
        ana!.lobby.state.room!.members.every((m) => m.ready || m.id === ana!.lobby.state.you!.id),
      2_000,
      'prêt',
    );
    down = true;
    ana!.lobby.start();
    await until(
      () => records.length === 2 || both.every((p) => p.net?.status === 'running'),
      20_000,
      'lancement du salon privé',
    ).catch((e) => {
      console.log(
        JSON.stringify(
          both.map((p) => ({
            room: p.lobby.state.room?.phase,
            err: p.lobby.state.error,
            net: p.net?.status,
            members: p.lobby.state.room?.members,
          })),
        ),
      );
      throw e;
    });
    await until(() => records.length === 2, 70_000, 'fin du salon privé').catch((e) => {
      console.log(
        JSON.stringify(
          both.map((p) => ({
            room: p.lobby.state.room?.phase,
            err: p.lobby.state.error,
            net: p.net?.status,
            frame: p.net?.stats().frame,
          })),
        ),
      );
      throw e;
    });
    expect(records[1]).toMatchObject({ status: 'agreed', ranked: false, kind: 'private' });
    await new Promise((r) => setTimeout(r, 1_500));
    expect(reporter.pending()).toBe(1);
    down = false;
    await until(() => reporter.pending() === 0, 15_000, 'rapport rattrapé après la panne');

    const after = await history(ana!);
    expect(after).toHaveLength(2);
    expect(after.filter((m) => m.ranked)).toHaveLength(1);
    const pa2 = await profile(ana!);
    expect(pa2.rating).toBe(pa!.rating);
    expect(pa2).toMatchObject({ rankedMatches: 1, matchesPlayed: 2 });

    for (const p of both) {
      if (p.timer !== null) clearInterval(p.timer);
      p.lobby.close();
    }
  }, 180_000);
});
