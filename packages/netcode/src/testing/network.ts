/**
 * Réseau simulé à horloge virtuelle, pour les tests de bout en bout : le relais et les clients
 * tournent dans le même processus, les messages arrivent après une latence, avec gigue, pertes
 * et désordre, le tout reproductible à partir d'une graine.
 *
 * Deux modes :
 * - « ordered » imite WebSocket (TCP) : rien ne se perd ni ne se double, l'ordre est garanti ;
 *   un paquet « perdu » est retransmis plus tard et retarde tous ceux qui le suivent ;
 * - « datagram » imite WebTransport : les messages de partie (inputs, pings) sont des datagrammes,
 *   qu'une perte efface pour de bon et que la gigue peut désordonner ; les messages de contrôle
 *   (arrivée, départ, erreurs, empreintes) passent par un flux fiable, comme le ferait un vrai
 *   client WebTransport.
 *
 * En mode « ordered », une perte coûte une retransmission rapide (trois accusés dupliqués) :
 * deux trajets et 50 ms de plus, et tous les messages suivants attendent derrière.
 */
import { MSG_INPUT, MSG_INPUTS, MSG_PING, MSG_PONG } from '../protocol.ts';
import type { Connection, Relay, RelayPeer } from '../server/relay.ts';
import type { Transport } from '../transport.ts';

// ── Ordonnanceur à horloge virtuelle ────────────────────────────────────────────────────────

export interface Scheduler {
  /** Heure virtuelle, en millisecondes. */
  now(): number;
  /** Programme `fn` à l'heure `time` (au plus tôt maintenant). */
  at(time: number, fn: () => void): void;
  /** Exécute dans l'ordre tout ce qui est programmé jusqu'à `time` compris, puis s'y arrête. */
  runUntil(time: number): void;
}

interface Task {
  time: number;
  seq: number;
  fn: () => void;
}

export function createScheduler(start = 0): Scheduler {
  let t = start;
  let seq = 0;
  const heap: Task[] = [];
  const before = (a: Task, b: Task): boolean =>
    a.time < b.time || (a.time === b.time && a.seq < b.seq);

  function push(task: Task): void {
    heap.push(task);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(heap[i]!, heap[parent]!)) break;
      [heap[i], heap[parent]] = [heap[parent]!, heap[i]!];
      i = parent;
    }
  }

  function pop(): Task {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && before(heap[l]!, heap[m]!)) m = l;
        if (r < heap.length && before(heap[r]!, heap[m]!)) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m]!, heap[i]!];
        i = m;
      }
    }
    return top;
  }

  return {
    now: () => t,
    at(time, fn) {
      push({ time: time < t ? t : time, seq: seq++, fn });
    },
    runUntil(time) {
      while (heap.length > 0 && heap[0]!.time <= time) {
        const task = pop();
        t = task.time;
        task.fn();
      }
      if (time > t) t = time;
    },
  };
}

// ── Réseau ──────────────────────────────────────────────────────────────────────────────────

export interface LinkConditions {
  /** Latence d'un trajet, en millisecondes. */
  readonly latencyMs: number;
  /** Gigue : retard supplémentaire tiré uniformément entre 0 et cette valeur. */
  readonly jitterMs?: number;
  /** Probabilité qu'un message soit perdu (retransmis en mode « ordered »). */
  readonly loss?: number;
}

export type NetworkMode = 'ordered' | 'datagram';

export interface VirtualNetworkOptions {
  readonly scheduler: Scheduler;
  readonly relay: Relay;
  readonly seed: number;
  readonly mode: NetworkMode;
}

/** Côté client d'une liaison simulée. */
export interface VirtualLink extends Transport {
  /** Coupure brutale (câble arraché) : chaque côté l'apprend sans message d'adieu. */
  disconnect(): void;
  /** Change les conditions des deux sens à partir de maintenant. */
  setConditions(up: LinkConditions, down: LinkConditions): void;
}

export interface VirtualNetwork {
  connect(up: LinkConditions, down: LinkConditions): VirtualLink;
  /** Messages envoyés, et perdus (ou retransmis en mode « ordered »), tous sens confondus. */
  readonly stats: { sent: number; lost: number; bytes: number };
}

/** Messages de partie, envoyés en datagrammes en mode « datagram ». */
function isDatagram(data: Uint8Array): boolean {
  const type = data[0];
  return type === MSG_INPUT || type === MSG_INPUTS || type === MSG_PING || type === MSG_PONG;
}

export function createVirtualNetwork(options: VirtualNetworkOptions): VirtualNetwork {
  const { scheduler, relay, mode } = options;
  let x = options.seed | 0 || 1;
  const random = (): number => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x1_0000_0000;
  };
  const stats = { sent: 0, lost: 0, bytes: 0 };

  /** Un sens de liaison : calcule l'heure d'arrivée de chaque message. */
  function direction(initial: LinkConditions) {
    let conditions = initial;
    let lastArrival = 0;
    return {
      set(c: LinkConditions) {
        conditions = c;
      },
      latency: () => conditions.latencyMs,
      /** Heure d'arrivée, ou -1 si le message est perdu pour de bon. */
      arrival(data: Uint8Array): number {
        stats.sent++;
        if (mode === 'datagram' && !isDatagram(data)) return this.reliable();
        let delay = conditions.latencyMs + random() * (conditions.jitterMs ?? 0);
        if (random() < (conditions.loss ?? 0)) {
          stats.lost++;
          if (mode === 'datagram') return -1;
          // Retransmission rapide : deux trajets et trois messages (50 ms) de plus.
          delay += 2 * conditions.latencyMs + 50;
        }
        let at = scheduler.now() + delay;
        if (mode === 'ordered' && at < lastArrival) at = lastArrival;
        lastArrival = at;
        return at;
      },
      /** Heure d'arrivée garantie (ouverture, fermeture), après les messages en cours. */
      reliable(): number {
        const at = Math.max(scheduler.now() + conditions.latencyMs, lastArrival);
        lastArrival = at;
        return at;
      },
    };
  }

  return {
    stats,
    connect(upConditions, downConditions) {
      const up = direction(upConditions);
      const down = direction(downConditions);
      const opened: (() => void)[] = [];
      const messages: ((data: Uint8Array) => void)[] = [];
      const closed: ((reason: string) => void)[] = [];
      let peer: RelayPeer | null = null;
      /** Le client a vu la fermeture : plus rien ne lui parvient. */
      let clientEnded = false;
      /** Le relais a vu la fermeture : plus rien ne lui parvient. */
      let serverEnded = false;

      const endClient = (reason: string): void => {
        if (clientEnded) return;
        clientEnded = true;
        for (const l of closed) l(reason);
      };
      const endServer = (): void => {
        if (serverEnded) return;
        serverEnded = true;
        peer?.closed();
      };

      const conn: Connection = {
        send(data) {
          if (serverEnded) return;
          stats.bytes += data.length;
          const copy = data.slice();
          const at = down.arrival(copy);
          if (at >= 0) {
            scheduler.at(at, () => {
              if (!clientEnded) for (const l of messages) l(copy);
            });
          }
        },
        close(reason) {
          serverEnded = true;
          scheduler.at(down.reliable(), () => endClient(reason));
        },
      };

      // Ouverture : un trajet aller pour le relais, un retour pour le client.
      scheduler.at(up.reliable(), () => {
        if (clientEnded) return;
        peer = relay.connect(conn);
        scheduler.at(down.reliable(), () => {
          if (!clientEnded) for (const l of opened) l();
        });
      });

      return {
        send(data) {
          if (clientEnded) return;
          stats.bytes += data.length;
          const copy = data.slice();
          const at = up.arrival(copy);
          if (at >= 0) {
            scheduler.at(at, () => {
              if (!serverEnded) peer?.receive(copy);
            });
          }
        },
        close() {
          endClient('fermée par le client');
          scheduler.at(up.reliable(), endServer);
        },
        disconnect() {
          endClient('connexion perdue');
          endServer();
        },
        setConditions(u, d) {
          up.set(u);
          down.set(d);
        },
        onOpen: (l) => opened.push(l),
        onMessage: (l) => messages.push(l),
        onClose: (l) => closed.push(l),
      };
    },
  };
}
