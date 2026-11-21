/**
 * Hôte WebSocket du relais : branche la logique pure de `relay.ts` sur un serveur HTTP de Node.js,
 * avec la bibliothèque `ws`. Seul fichier du module qui touche aux sockets côté serveur.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { MAX_MESSAGE_BYTES } from '../protocol.ts';
import { createRelay, type Relay, type RelayOptions } from './relay.ts';

export interface RelayHost {
  readonly relay: Relay;
  /** Port d'écoute (serveur autonome), ou celui du serveur hôte. */
  readonly port: number;
  /** Ferme les connexions du relais et arrête son pas ; le serveur autonome est aussi arrêté. */
  close(): Promise<void>;
}

/** Pas du relais : retards, départs, envois groupés. */
const TICK_MS = 4;
/** Une connexion muette plus longtemps est coupée (les clients parlent au moins toutes les secondes). */
const SILENCE_MS = 15_000;
/** Une raison de fermeture WebSocket tient en 123 octets. */
const MAX_REASON_BYTES = 123;

function pathOf(url: string | undefined): string {
  if (url === undefined) return '';
  const q = url.indexOf('?');
  return q < 0 ? url : url.slice(0, q);
}

function shortReason(reason: string): string {
  const bytes = Buffer.from(reason);
  if (bytes.length <= MAX_REASON_BYTES) return reason;
  return (
    bytes
      .subarray(0, MAX_REASON_BYTES - 3)
      .toString()
      .replace(/�+$/, '') + '…'
  );
}

/**
 * Branche le relais sur un serveur HTTP existant (serveur de développement Vite, ou serveur
 * autonome), pour les demandes WebSocket adressées à `path`. Les autres demandes WebSocket (le
 * rechargement à chaud de Vite, par exemple) ne sont pas touchées.
 */
export function attachRelay(server: Server, relay: Relay, path = '/net'): RelayHost {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const lastHeard = new Map<WebSocket, number>();

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (pathOf(req.url) !== path) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  };
  server.on('upgrade', onUpgrade);

  wss.on('connection', (ws: WebSocket) => {
    lastHeard.set(ws, Date.now());
    const peer = relay.connect({
      send(data) {
        // `ws` peut garder le tampon en file d'attente : on lui en donne une copie.
        if (ws.readyState === WebSocket.OPEN) ws.send(Buffer.from(data));
      },
      close(reason) {
        ws.close(4000, shortReason(reason));
      },
    });
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      lastHeard.set(ws, Date.now());
      // Un message texte n'est pas du protocole : le relais le refusera comme vide.
      peer.receive(
        isBinary
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(0),
      );
    });
    ws.on('close', () => {
      lastHeard.delete(ws);
      peer.closed();
    });
    // Erreur de socket ou message trop gros : `ws` ferme la connexion, `close` suivra.
    ws.on('error', () => ws.terminate());
  });

  const tick = setInterval(() => relay.tick(), TICK_MS);
  const watchdog = setInterval(() => {
    const now = Date.now();
    for (const [ws, heard] of lastHeard) if (now - heard > SILENCE_MS) ws.terminate();
  }, SILENCE_MS / 3);

  const address = server.address();
  return {
    relay,
    port: typeof address === 'object' && address !== null ? address.port : 0,
    close() {
      clearInterval(tick);
      clearInterval(watchdog);
      server.off('upgrade', onUpgrade);
      for (const ws of wss.clients) ws.terminate();
      return new Promise((resolve) => wss.close(() => resolve()));
    },
  };
}

/** Serveur relais autonome : HTTP minimal et relais sur `/net`. `port` 0 : choisi par le système. */
export async function startRelayServer(
  port: number,
  options: Partial<RelayOptions> = {},
  host = '0.0.0.0',
): Promise<RelayHost> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Relais netcode : connexion WebSocket sur /net\n');
  });
  // Demande WebSocket sur un autre chemin : personne d'autre ne la traitera.
  server.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
    if (pathOf(req.url) !== '/net') socket.destroy();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const relay = createRelay({ now: () => performance.now(), ...options });
  const attached = attachRelay(server, relay, '/net');
  const address = server.address();
  return {
    relay,
    port: typeof address === 'object' && address !== null ? address.port : port,
    async close() {
      await attached.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
