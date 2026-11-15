/**
 * Canal de messages entre un client et le serveur relais. Le client ne connaît que cette
 * interface : WebSocket dans le navigateur et dans Node, réseau simulé dans les tests.
 */

export interface Transport {
  /** Envoie un message. `data` peut être réutilisé par l'appelant dès le retour. */
  send(data: Uint8Array): void;
  close(): void;
  onOpen(listener: () => void): void;
  onMessage(listener: (data: Uint8Array) => void): void;
  onClose(listener: (reason: string) => void): void;
}

/**
 * Transport WebSocket : `WebSocket` natif du navigateur, ou global de Node.js (≥ 22).
 * Les messages sont binaires ; chaque envoi est copié, l'appelant pouvant réutiliser son tampon.
 */
export function webSocketTransport(url: string): Transport {
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  const opened: (() => void)[] = [];
  const messages: ((data: Uint8Array) => void)[] = [];
  const closed: ((reason: string) => void)[] = [];
  let ended = false;
  const end = (reason: string): void => {
    if (ended) return;
    ended = true;
    for (const l of closed) l(reason);
  };
  socket.addEventListener('open', () => {
    for (const l of opened) l();
  });
  socket.addEventListener('message', (event: MessageEvent) => {
    if (!(event.data instanceof ArrayBuffer)) return;
    const data = new Uint8Array(event.data);
    for (const l of messages) l(data);
  });
  socket.addEventListener('close', (event: CloseEvent) => {
    end(event.reason || `connexion fermée (code ${event.code})`);
  });
  socket.addEventListener('error', () => end('connexion impossible ou interrompue'));
  return {
    send(data) {
      if (socket.readyState === WebSocket.OPEN) socket.send(data.slice());
    },
    close() {
      socket.close(1000, 'fin de partie');
      end('fermée par le client');
    },
    onOpen: (l) => opened.push(l),
    onMessage: (l) => messages.push(l),
    onClose: (l) => closed.push(l),
  };
}
