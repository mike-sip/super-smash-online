/**
 * WebSocket en mémoire pour tester le client du lobby contre le vrai service, sans réseau :
 * chaque message est livré de façon asynchrone (micro-tâche), comme un vrai socket.
 */
import type { SocketLike } from '../src/client.ts';
import type { Lobby, LobbyPeer } from '../src/service.ts';

export interface MemoryNetwork {
  readonly WebSocket: new (url: string) => SocketLike;
  /** Coupe toutes les connexions ouvertes (panne réseau). */
  dropAll(): void;
  /** Refuse les prochaines connexions (serveur éteint). */
  setDown(down: boolean): void;
  readonly opened: number;
}

export function memoryNetwork(lobby: Lobby, address = '10.0.0.1'): MemoryNetwork {
  const live = new Set<MemorySocket>();
  let down = false;
  let opened = 0;

  class MemorySocket implements SocketLike {
    readyState = 0;
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onclose: ((event: unknown) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    private peer: LobbyPeer | null = null;

    constructor() {
      queueMicrotask(() => {
        if (down) {
          this.finish();
          return;
        }
        opened++;
        live.add(this);
        this.peer = lobby.connect(
          {
            send: (text) =>
              queueMicrotask(() => {
                if (this.readyState === 1) this.onmessage?.({ data: text });
              }),
            close: () => queueMicrotask(() => this.finish()),
          },
          address,
        );
        this.readyState = 1;
        this.onopen?.({});
      });
    }

    send(data: string): void {
      if (this.readyState !== 1) return;
      const peer = this.peer!;
      queueMicrotask(() => peer.receive(data));
    }

    close(): void {
      queueMicrotask(() => this.finish());
    }

    finish(): void {
      if (this.readyState === 3) return;
      this.readyState = 3;
      live.delete(this);
      this.peer?.closed();
      this.onclose?.({});
    }
  }

  return {
    WebSocket: MemorySocket,
    dropAll() {
      for (const s of [...live]) s.finish();
    },
    setDown(value) {
      down = value;
    },
    get opened() {
      return opened;
    },
  };
}
