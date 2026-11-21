/**
 * Partie complète simulée : relais, réseau simulé et clients dans un même processus, à horloge
 * virtuelle. Chaque client a sa propre horloge (décalée, qui dérive), ses images à intervalles
 * irréguliers, ses joueurs humains simulés. À la fin, ses empreintes sont comparées à celles
 * d'une rejoue hors ligne du journal des inputs confirmés par le relais.
 */
import { createSim, events, frame, fx, spawnEntity } from '@game/sim-core';
import { E_BALL, testConfig } from '@game/sim-core/testing';
import { createNetClient, type NetClient, type NetStats } from '../src/client.ts';
import { FRAME_MS } from '../src/constants.ts';
import { simGame, stepWithRespawn, type Advance, type RollbackGame } from '../src/game.ts';
import { MSG_CHECKSUM, createMessage, decode } from '../src/protocol.ts';
import { createRelay, type RelayOptions } from '../src/server/relay.ts';
import {
  createScheduler,
  createVirtualNetwork,
  type LinkConditions,
  type NetworkMode,
  type VirtualLink,
} from '../src/testing/network.ts';
import type { Transport } from '../src/transport.ts';
import { HumanInputs, Rng } from './helpers.ts';

export interface ClientSetup {
  readonly up: LinkConditions;
  readonly down: LinkConditions;
  readonly localPlayers?: number;
  /** Vitesse de l'horloge locale par rapport au temps réel (1,001 = +0,1 %). */
  readonly clockRate?: number;
  /** Écart d'une image à l'autre : intervalle de 16,7 ms ± cette valeur. */
  readonly frameJitterMs?: number;
  /** Onglet masqué : aucun appel à `update` entre ces deux instants (ms après le départ). */
  readonly hidden?: readonly [from: number, to: number];
  /** Coupure brutale à cet instant (ms après le départ). */
  readonly disconnectAt?: number;
  /** Jeu volontairement différent (test témoin de détection de désync). */
  readonly corrupt?: boolean;
}

export interface MatchSetup {
  readonly clients: readonly ClientSetup[];
  readonly frames: number;
  readonly seed: number;
  readonly mode?: NetworkMode;
  readonly relay?: Partial<RelayOptions>;
}

export interface ClientResult {
  readonly stats: NetStats;
  /** Empreintes envoyées au relais : frame → valeur. */
  readonly checksums: Map<number, number>;
  /** Images (appels à `update`) pendant la partie. */
  readonly updates: number;
  /** Frames nouvelles signalées par `onFrame`, et dans l'ordre. */
  readonly newFrames: number;
  readonly framesInOrder: boolean;
  /** Événements de la simulation vus aux frames nouvelles : type → nombre. */
  readonly events: Map<string, number>;
  readonly desyncs: number[];
  readonly error: string | null;
  readonly status: string;
}

export interface MatchResult {
  readonly clients: ClientResult[];
  /** Empreintes de la rejoue hors ligne du journal du relais, aux mêmes frames. */
  readonly reference: Map<number, number>;
  /** Événements de la rejoue hors ligne, par frame : `frame:type:a:b`. */
  readonly referenceEvents: Set<string>;
  readonly relayDesyncs: number;
  readonly network: { sent: number; lost: number; bytes: number };
  readonly seed: number;
  readonly players: number;
}

const GAME_ID = 'simulee';

export function runMatch(setup: MatchSetup): MatchResult {
  const scheduler = createScheduler(10_000);
  let relayDesyncs = 0;
  const relay = createRelay({
    now: scheduler.now,
    record: true,
    seed: () => setup.seed,
    onDesync: () => relayDesyncs++,
    ...setup.relay,
  });
  const network = createVirtualNetwork({
    scheduler,
    relay,
    seed: setup.seed,
    mode: setup.mode ?? 'ordered',
  });
  const players = setup.clients.reduce((n, c) => n + (c.localPlayers ?? 1), 0);
  const rng = new Rng(setup.seed);
  let startAt = Number.NaN;

  // Le relais travaille toutes les 4 ms.
  const relayTick = (): void => {
    relay.tick();
    scheduler.at(scheduler.now() + 4, relayTick);
  };
  scheduler.at(scheduler.now() + 4, relayTick);

  interface Live {
    readonly setup: ClientSetup;
    readonly client: NetClient;
    readonly link: VirtualLink;
    readonly checksums: Map<number, number>;
    readonly events: Map<string, number>;
    readonly desyncs: number[];
    game: { game: RollbackGame; sim: ReturnType<typeof createSim> } | null;
    updates: number;
    newFrames: number;
    lastFrame: number;
    inOrder: boolean;
  }

  const lives: Live[] = setup.clients.map((c, index) => {
    const link = network.connect(c.up, c.down);
    const checksums = new Map<number, number>();
    // Les empreintes envoyées sont lues au passage, sans toucher au client.
    const spy = createMessage();
    const transport: Transport = {
      ...link,
      send(data) {
        if (data[0] === MSG_CHECKSUM && decode(data, spy) === null) {
          checksums.set(spy.frame, spy.value);
        }
        link.send(data);
      },
    };
    const rate = c.clockRate ?? 1;
    const offset = 1_000_000 * (index + 1);
    const t0 = scheduler.now();
    const client = createNetClient({
      transport,
      gameId: GAME_ID,
      players,
      localPlayers: c.localPlayers ?? 1,
      now: () => offset + t0 + (scheduler.now() - t0) * rate,
    });
    const live: Live = {
      setup: c,
      client,
      link,
      checksums,
      events: new Map(),
      desyncs: [],
      game: null,
      updates: 0,
      newFrames: 0,
      lastFrame: 0,
      inOrder: true,
    };
    client.onDesync((frame) => live.desyncs.push(frame));
    return live;
  });

  const end = (): number => startAt + setup.frames * FRAME_MS;
  const humans = new Map<string, HumanInputs>();

  for (const [index, live] of lives.entries()) {
    const c = live.setup;
    const jitter = c.frameJitterMs ?? 0;
    const tick = (): void => {
      const t = scheduler.now();
      const client = live.client;
      if (client.status === 'starting' && live.game === null) {
        const match = client.match!;
        if (Number.isNaN(startAt)) startAt = match.startAt;
        const sim = createSim(testConfig(match.players, match.seed));
        // Désync volontaire : à la frame 300, une balle apparaît, sur ce client
        // seulement. La règle ne dépend que de l'état : une re-simulation la reproduit.
        const advance: Advance = c.corrupt
          ? (s, inputs) => {
              if (frame(s) === 300) spawnEntity(s, E_BALL, -1, 0, fx(30), 0, 0);
              stepWithRespawn(s, inputs);
            }
          : stepWithRespawn;
        const game = simGame(sim, advance);
        live.game = { game, sim };
        client.begin(game);
        for (let i = 0; i < match.localSlots.length; i++) {
          humans.set(`${index}:${i}`, new HumanInputs(setup.seed * 31 + match.localSlots[i]!));
        }
      }
      const since = Number.isNaN(startAt) ? -Infinity : t - startAt;
      const hidden = c.hidden !== undefined && since >= c.hidden[0] && since < c.hidden[1];
      if (c.disconnectAt !== undefined && since >= c.disconnectAt && client.status !== 'closed') {
        live.link.disconnect();
      }
      if (!hidden && client.status !== 'closed') {
        if (client.status === 'running') live.updates++;
        client.update(
          (out) => {
            for (let i = 0; i < out.length; i++) out[i] = humans.get(`${index}:${i}`)!.next();
          },
          () => {
            const sim = live.game!.sim;
            const f = live.client.stats().frame;
            if (f !== live.lastFrame + 1) live.inOrder = false;
            live.lastFrame = f;
            live.newFrames++;
            const q = events(sim);
            for (let e = 0; e < q.count; e++) {
              const key = `${f}:${q.type[e]}:${q.a[e]}:${q.b[e]}`;
              live.events.set(key, (live.events.get(key) ?? 0) + 1);
            }
          },
        );
      }
      if (Number.isNaN(startAt) || t < end() + 1000) {
        scheduler.at(t + FRAME_MS / (c.clockRate ?? 1) + (rng.float() * 2 - 1) * jitter, tick);
      }
    };
    scheduler.at(scheduler.now() + rng.float() * FRAME_MS, tick);
  }

  // Jusqu'au départ, puis jusqu'à la fin, plus le temps que tout soit confirmé.
  let guard = 0;
  while (Number.isNaN(startAt) && guard++ < 1000) scheduler.runUntil(scheduler.now() + 100);
  if (Number.isNaN(startAt)) throw new Error('la partie n’a jamais démarré');
  scheduler.runUntil(end() + 1500);

  // Rejoue hors ligne du journal du relais.
  const history = relay.history(GAME_ID)!;
  const sim = createSim(testConfig(players, setup.seed));
  const reference = new Map<number, number>();
  const referenceEvents = new Set<string>();
  const game = simGame(sim, stepWithRespawn);
  const interval = 15;
  for (let f = 0; f < history.length; f++) {
    game.step(history[f]!);
    const q = events(sim);
    for (let e = 0; e < q.count; e++)
      referenceEvents.add(`${f + 1}:${q.type[e]}:${q.a[e]}:${q.b[e]}`);
    if ((f + 1) % interval === 0) reference.set(f + 1, game.checksum());
  }

  return {
    clients: lives.map((live) => ({
      stats: live.client.stats(),
      checksums: live.checksums,
      updates: live.updates,
      newFrames: live.newFrames,
      framesInOrder: live.inOrder,
      events: live.events,
      desyncs: live.desyncs,
      error: live.client.error,
      status: live.client.status,
    })),
    reference,
    referenceEvents,
    relayDesyncs,
    network: network.stats,
    seed: setup.seed,
    players,
  };
}

/** Conditions du critère n° 1 : 40 à 120 ms d'aller-retour, 15 ms de gigue, pertes données. */
export function typicalLink(rng: Rng, loss: number): [up: LinkConditions, down: LinkConditions] {
  const rtt = 40 + rng.float() * 80;
  return [
    { latencyMs: rtt / 2, jitterMs: 15, loss },
    { latencyMs: rtt / 2, jitterMs: 15, loss },
  ];
}
