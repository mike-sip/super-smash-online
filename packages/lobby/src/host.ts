/**
 * Hôte WebSocket du lobby : branche le service sur un serveur HTTP de Node.js (bibliothèque `ws`).
 * Seul fichier du lobby qui touche aux sockets.
 */
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { MAX_RESULT_CHARS } from './protocol.ts';
import type { Lobby } from './service.ts';

export interface LobbyHost {
  close(): Promise<void>;
}

/** Une raison de fermeture WebSocket tient en 123 octets. */
const MAX_REASON = 100;

export function pathOf(url: string | undefined): string {
  if (url === undefined) return '';
  const q = url.indexOf('?');
  return q < 0 ? url : url.slice(0, q);
}

/**
 * Adresse du client, pour les limites par adresse. Derrière un proxy inverse de confiance
 * (`trustProxy`), la dernière adresse de `X-Forwarded-For`, comme dans `accounts`.
 */
export function clientAddress(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const header = req.headers['x-forwarded-for'];
    const value = Array.isArray(header) ? header[header.length - 1] : header;
    const last = value?.split(',').pop()?.trim();
    if (last !== undefined && last !== '') return last;
  }
  return req.socket.remoteAddress ?? '?';
}

/** Branche le lobby sur `server` pour les demandes WebSocket adressées à `path`. */
export function attachLobby(
  server: Server,
  lobby: Lobby,
  options: { path?: string; trustProxy?: boolean } = {},
): LobbyHost {
  const path = options.path ?? '/lobby';
  // Un caractère UTF-16 pèse au plus 3 octets en UTF-8 ; `ws` coupe au-delà.
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_RESULT_CHARS * 3 });

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (pathOf(req.url) !== path) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  };
  server.on('upgrade', onUpgrade);

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const peer = lobby.connect(
      {
        send(text) {
          if (ws.readyState === WebSocket.OPEN) ws.send(text);
        },
        close(reason) {
          ws.close(4000, reason.slice(0, MAX_REASON));
        },
      },
      clientAddress(req, options.trustProxy ?? false),
    );
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      // Le protocole est du texte : un message binaire est refusé comme invalide.
      peer.receive(isBinary ? '' : data.toString('utf8'));
    });
    ws.on('close', () => peer.closed());
    ws.on('error', () => ws.terminate());
  });

  return {
    close() {
      server.off('upgrade', onUpgrade);
      for (const ws of wss.clients) ws.terminate();
      return new Promise((resolve) => wss.close(() => resolve()));
    },
  };
}
