/**
 * Greffon Vite : attache le serveur relais au serveur de développement, sur le chemin `/net`.
 * Un seul port pour la page et le jeu en ligne : il suffit d'ouvrir l'adresse affichée par Vite
 * dans plusieurs onglets, ou sur plusieurs machines du réseau local (`vite --host`).
 */
import type { Server } from 'node:http';
import type { Plugin } from 'vite';
import { attachRelay, createRelay } from '../../../packages/netcode/src/server/index.ts';

function attach(httpServer: Server | null | undefined): void {
  if (!httpServer) return;
  const relay = createRelay({
    now: () => performance.now(),
    log: (message) => console.log(`[relais] ${message}`),
  });
  const host = attachRelay(httpServer, relay, '/net');
  httpServer.once('close', () => void host.close());
}

export function relayPlugin(): Plugin {
  return {
    name: 'netcode-relay',
    configureServer(server) {
      attach(server.httpServer as Server | null);
    },
    configurePreviewServer(server) {
      attach(server.httpServer as Server);
    },
  };
}
