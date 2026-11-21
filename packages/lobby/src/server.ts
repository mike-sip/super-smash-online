/**
 * Serveur de jeu complet : HTTP, lobby sur `/lobby`, relais réservé sur `/net`, dans un même
 * processus (SPEC-lobby.md, « Architecture »). Assemblage seulement : c'est ici que l'horloge
 * réelle et l'aléa cryptographique sont branchés.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { attachRelay, createRelay, type Relay } from '@game/netcode/server';
import { lobbyTicketVerifier, relayAuthenticator } from './admission.ts';
import { attachLobby, pathOf } from './host.ts';
import type { MatchRecord } from './results.ts';
import type { LobbyContent } from './room.ts';
import { createLobby, type Lobby, type LobbyLimits, type QuickMatchSettings } from './service.ts';

export interface GameServerConfig {
  readonly host: string;
  /** 0 : choisi par le système (tests). */
  readonly port: number;
  /** Mêmes clés que `ACCOUNTS_TICKET_SECRETS` du serveur des comptes. */
  readonly ticketSecrets: readonly string[];
  readonly content: LobbyContent;
  readonly regions?: readonly string[];
  /** Lire `X-Forwarded-For` (un seul proxy inverse de confiance devant le serveur). */
  readonly trustProxy?: boolean;
  readonly limits?: Partial<LobbyLimits>;
  readonly quick?: Partial<QuickMatchSettings>;
  readonly onMatchResult?: (record: MatchRecord) => void;
  readonly log?: (message: string) => void;
  /** Parties simultanées au plus dans le relais (défaut du relais : 1 000). */
  readonly maxGames?: number;
  /** Compteurs ajoutés à la réponse de `/health` (ex. rapports en attente). */
  readonly health?: () => Readonly<Record<string, number>>;
}

export interface GameServer {
  readonly lobby: Lobby;
  readonly relay: Relay;
  /** Le serveur HTTP, pour y attacher autre chose (serveur de développement). */
  readonly http: Server;
  listen(): Promise<{ port: number }>;
  close(): Promise<void>;
}

/** Pas du lobby : délais, file, comptes à rebours. */
const LOBBY_TICK_MS = 100;

/** Lobby et relais réservé sur un serveur HTTP existant (le serveur de Vite en développement). */
export function attachGameServer(
  http: Server,
  config: Omit<GameServerConfig, 'host' | 'port'>,
): { lobby: Lobby; relay: Relay; close(): Promise<void> } {
  const keys = { secrets: config.ticketSecrets, now: () => Date.now() };
  const log = config.log ?? (() => {});
  let lobby: Lobby | null = null;
  const relay = createRelay({
    now: () => performance.now(),
    authenticate: relayAuthenticator(keys),
    onGameEvent: (event) => lobby?.relayEvent(event),
    onDesync: (gameId) => lobby?.relayDesync(gameId),
    log: (m) => log(`[relais] ${m}`),
    ...(config.maxGames === undefined ? {} : { maxGames: config.maxGames }),
  });
  const created = createLobby({
    now: () => Date.now(),
    relay,
    relayPath: '/net',
    verifyTicket: lobbyTicketVerifier(keys),
    content: config.content,
    regions: config.regions,
    limits: config.limits,
    quick: config.quick,
    random: (max) => randomInt(max),
    uuid: () => randomUUID(),
    onMatchResult: config.onMatchResult,
    log: (m) => log(`[lobby] ${m}`),
  });
  lobby = created;
  const relayHost = attachRelay(http, relay, '/net');
  const lobbyHost = attachLobby(http, created, { trustProxy: config.trustProxy });
  const tick = setInterval(() => created.tick(), LOBBY_TICK_MS);
  return {
    lobby: created,
    relay,
    async close() {
      clearInterval(tick);
      await lobbyHost.close();
      await relayHost.close();
    },
  };
}

export function createGameServer(config: GameServerConfig): GameServer {
  const http = createServer((req, res) => {
    if (req.method === 'GET' && pathOf(req.url) === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, ...attached.lobby.stats(), ...config.health?.() }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Serveur de jeu : WebSocket sur /lobby et /net\n');
  });
  // Demande WebSocket sur un autre chemin : personne ne la traitera.
  http.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
    const path = pathOf(req.url);
    if (path !== '/lobby' && path !== '/net') socket.destroy();
  });
  const attached = attachGameServer(http, config);
  return {
    lobby: attached.lobby,
    relay: attached.relay,
    http,
    listen() {
      return new Promise((resolve, reject) => {
        http.once('error', reject);
        http.listen(config.port, config.host, () => {
          const address = http.address();
          resolve({
            port: typeof address === 'object' && address !== null ? address.port : config.port,
          });
        });
      });
    },
    async close() {
      await attached.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
