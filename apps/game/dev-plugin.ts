/**
 * Greffon Vite du jeu : en développement, le serveur de Vite héberge tout ce qu'il faut pour
 * jouer, sur un seul port, avec les mêmes routes qu'en production :
 *
 * - comptes et classement (`/api/accounts`, `/api/ranking`), en mémoire, dans ce processus ;
 * - lobby (`/lobby`) et relais réservé (`/net`) sur le serveur HTTP de Vite, avec le vrai contenu.
 *
 * Les résultats acceptés partent au classement par `submitMatch` (même processus). Les clés sont
 * celles, marquées « dev », des autres serveurs de développement : jamais en production.
 *
 * `GAME_QUICK=short` (tests seulement) : partie rapide en Temps 30 s, sans attente.
 */
import { request, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createMemoryStore } from '@game/accounts';
import { attachGameServer, reportFromRecord, type GameServerConfig } from '@game/lobby';
import {
  createGameServer as createAccountsAndRanking,
  createMemoryRankingStore,
} from '@game/ranking';
import type { Plugin } from 'vite';
import { CONTENT_IDS } from './src/content-ids.ts';

const DEV_TICKET_SECRET = 'dev-uniquement-cle-de-ticket-non-secrete-0000';
const DEV_REPORT_SECRET = 'dev-uniquement-cle-de-rapport-non-secrete-00';

/** Règles courtes de la partie rapide pour les tests automatiques. */
export const SHORT_QUICK: GameServerConfig['quick'] = {
  maxWaitMs: 500,
  countdownMs: 1_000,
  rules: {
    mode: 'time',
    stocks: 3,
    timeLimit: 30,
    stamina: 150,
    teams: false,
    teamAttack: false,
    ultimate: true,
    items: { enabled: false, frequency: 'normal' },
  },
};

/** Relaie une requête vers le serveur des comptes, en gardant l'en-tête Host (contrôle d'origine). */
function forward(port: number, req: IncomingMessage, res: ServerResponse): void {
  const upstream = request(
    { host: '127.0.0.1', port, method: req.method, path: req.url, headers: req.headers },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end('{"error":{"code":"internal","message":"Serveur des comptes injoignable."}}');
  });
  req.pipe(upstream);
}

export function gameDevPlugin(): Plugin {
  let backendPort = 0;

  async function attach(http: Server | null | undefined): Promise<void> {
    if (!http) return;
    const backend = createAccountsAndRanking(
      {
        host: '127.0.0.1',
        port: 0,
        store: createMemoryStore(),
        ticketSecrets: [DEV_TICKET_SECRET],
        allowedOrigins: [],
        secureCookies: false,
        trustProxy: false,
        hashing: { logN: 12, r: 8, p: 1 },
        log: () => {},
      },
      { store: createMemoryRankingStore(), reportSecrets: [DEV_REPORT_SECRET] },
    );
    backendPort = (await backend.listen()).port;
    const game = attachGameServer(http, {
      ticketSecrets: [DEV_TICKET_SECRET],
      content: { fighters: [...CONTENT_IDS.fighters], stages: [...CONTENT_IDS.stages] },
      ...(process.env.GAME_QUICK === 'short' ? { quick: SHORT_QUICK } : {}),
      log: (message) => console.log(message),
      onMatchResult: (record) => {
        if (record.status !== 'agreed') return;
        void backend.ranking
          .submitMatch(reportFromRecord(record, Date.now()))
          .catch((error: unknown) => console.error('[classement]', error));
      },
    });
    http.once('close', () => {
      void game.close();
      void backend.close();
    });
  }

  function middleware(req: IncomingMessage, res: ServerResponse, next: () => void): void {
    const url = req.url ?? '';
    if (
      backendPort === 0 ||
      !(url.startsWith('/api/accounts/') || url.startsWith('/api/ranking/'))
    ) {
      next();
      return;
    }
    forward(backendPort, req, res);
  }

  return {
    name: 'game-dev-servers',
    apply: 'serve',
    async configureServer(server) {
      server.middlewares.use(middleware);
      await attach(server.httpServer as Server | null);
    },
  };
}
