/**
 * Greffon Vite de la démo en ligne : le serveur de développement héberge tout ce qu'il faut pour
 * jouer, sur un seul port.
 *
 * - le lobby (`/lobby`) et le relais réservé (`/net`), par `attachGameServer` de `@game/lobby` ;
 * - le serveur des comptes, sous `/api/accounts` : démarré en mémoire dans ce processus, ou relayé
 *   vers `ACCOUNTS_URL` si cette variable est donnée (par exemple `pnpm --filter @game/accounts dev`).
 *
 * La clé de ticket est celle, marquée « dev », de `pnpm --filter @game/accounts dev` : jamais
 * ailleurs qu'en développement.
 */
import { request, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createAccountsServer, createMemoryStore, type AccountsServer } from '@game/accounts';
import { attachGameServer } from '@game/lobby';
import type { Plugin } from 'vite';
import { CONTENT_IDS } from './content-ids.ts';

const DEV_SECRET = 'dev-uniquement-cle-de-ticket-non-secrete-0000';

/** Relaie une requête vers le serveur des comptes, en gardant l'en-tête Host (contrôle d'origine). */
function forward(target: URL, req: IncomingMessage, res: ServerResponse): void {
  const upstream = request(
    {
      host: target.hostname,
      port: target.port,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
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

export function onlineDevPlugin(): Plugin {
  let accounts: AccountsServer | null = null;
  let accountsUrl: URL | null = process.env.ACCOUNTS_URL ? new URL(process.env.ACCOUNTS_URL) : null;

  async function attach(http: Server | null | undefined): Promise<void> {
    if (!http) return;
    if (accountsUrl === null) {
      accounts = createAccountsServer({
        host: '127.0.0.1',
        port: 0,
        store: createMemoryStore(),
        ticketSecrets: [DEV_SECRET],
        allowedOrigins: [],
        secureCookies: false,
        trustProxy: false,
        log: () => {},
      });
      accountsUrl = new URL(`http://127.0.0.1:${(await accounts.listen()).port}`);
    }
    const game = attachGameServer(http, {
      ticketSecrets: [DEV_SECRET],
      content: CONTENT_IDS,
      log: (message) => console.log(message),
      onMatchResult: (r) => console.log(`[lobby] match ${r.matchId} : ${r.status}`),
    });
    http.once('close', () => {
      void game.close();
      void accounts?.close();
    });
  }

  function middleware(req: IncomingMessage, res: ServerResponse, next: () => void): void {
    if (accountsUrl === null || !(req.url ?? '').startsWith('/api/accounts/')) {
      next();
      return;
    }
    forward(accountsUrl, req, res);
  }

  return {
    name: 'online-dev-servers',
    async configureServer(server) {
      server.middlewares.use(middleware);
      await attach(server.httpServer as Server | null);
    },
    async configurePreviewServer(server) {
      server.middlewares.use(middleware);
      await attach(server.httpServer as Server);
    },
  };
}
