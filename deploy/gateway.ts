/**
 * Passerelle locale : reproduit le frontal de production (routes et en-têtes de `routes.ts`)
 * sans TLS ni Docker. Sert le client construit et relaie vers les deux serveurs, WebSocket
 * compris. Utilisée par les tests de bout en bout et par `serve:prod` ; en production, c'est
 * Caddy qui fait ce travail.
 *
 *   node deploy/gateway.ts <dossier du client> <port> <origine des comptes> <origine du jeu>
 */
import { createReadStream, statSync } from 'node:fs';
import {
  createServer,
  request,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { connect } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Duplex } from 'node:stream';
import { CACHE_ASSETS, CACHE_HTML, SECURITY_HEADERS, routeFor, type Upstream } from './routes.ts';

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export interface GatewayOptions {
  readonly root: string;
  readonly port: number;
  readonly upstreams: Readonly<Record<Upstream, URL>>;
  readonly log?: (line: string) => void;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { ...SECURITY_HEADERS, ...extra };
}

/** Chemin du fichier statique, jamais hors de `root` ; `index.html` pour toute autre adresse. */
function staticFile(root: string, pathname: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = '/';
  }
  const candidate = normalize(join(root, decoded));
  if (candidate.startsWith(root + sep) && !decoded.includes('\0')) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Absent : la page principale.
    }
  }
  return join(root, 'index.html');
}

function proxy(target: URL, req: IncomingMessage, res: ServerResponse): void {
  const upstream = request(
    {
      host: target.hostname,
      port: target.port,
      method: req.method,
      path: req.url,
      // L'en-tête Host est gardé : les comptes comparent l'origine à l'hôte demandé.
      headers: { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress ?? '' },
    },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, { ...answer.headers, ...headers() });
      answer.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, headers({ 'content-type': 'application/json' }));
    res.end('{"error":{"code":"internal","message":"Service indisponible."}}');
  });
  req.pipe(upstream);
}

/** Relaie une demande de WebSocket telle quelle (octets bruts dans les deux sens). */
function proxyUpgrade(target: URL, req: IncomingMessage, socket: Duplex, head: Buffer): void {
  const upstream = connect(Number(target.port), target.hostname, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    lines.push(`X-Forwarded-For: ${req.socket.remoteAddress ?? ''}`);
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const close = (): void => {
    upstream.destroy();
    socket.destroy();
  };
  upstream.on('error', close);
  socket.on('error', close);
}

export function createGateway(options: GatewayOptions): Server {
  const root = resolve(options.root);
  const log = options.log ?? (() => {});
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://x').pathname;
    const route = routeFor(pathname);
    if (route !== null) {
      if (route.to === 'block') {
        res.writeHead(404, headers({ 'content-type': 'text/plain; charset=utf-8' }));
        res.end('Introuvable.\n');
        log(`404 ${pathname.slice(0, 40)}`);
        return;
      }
      proxy(options.upstreams[route.to], req, res);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, headers({ allow: 'GET, HEAD' }));
      res.end();
      return;
    }
    const file = staticFile(root, pathname);
    const html = file.endsWith('.html');
    res.writeHead(
      200,
      headers({
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': html ? CACHE_HTML : CACHE_ASSETS,
      }),
    );
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  });
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const route = routeFor(new URL(req.url ?? '/', 'http://x').pathname);
    if (route === null || route.to === 'block' || route.websocket !== true) {
      socket.destroy();
      return;
    }
    proxyUpgrade(options.upstreams[route.to], req, socket, head);
  });
  return server;
}

// Lancement direct : node deploy/gateway.ts <client> <port> <comptes> <jeu>
if (import.meta.main) {
  const [root, port, accounts, game] = process.argv.slice(2);
  if (root === undefined || port === undefined || accounts === undefined || game === undefined) {
    console.error(
      'Usage : node deploy/gateway.ts <dossier du client> <port> <origine des comptes> <origine du jeu>',
    );
    process.exit(1);
  }
  const server = createGateway({
    root,
    port: Number(port),
    upstreams: { accounts: new URL(accounts), game: new URL(game) },
    log: (line) => console.log(`${new Date().toISOString()} [passerelle] ${line}`),
  });
  server.listen(Number(port), '127.0.0.1', () =>
    console.log(`Passerelle : http://127.0.0.1:${port}/`),
  );
}
