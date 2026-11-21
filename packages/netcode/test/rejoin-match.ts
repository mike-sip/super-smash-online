/**
 * Partie simulée sur un relais en mode réservé, avec des joueurs qui partent et reviennent en
 * pleine partie (SPEC-lobby.md, « Reconnexion en pleine partie »). Même principe que `match.ts` :
 * relais, réseau simulé et clients dans un même processus, à horloge virtuelle, puis comparaison
 * des empreintes de chacun à une rejoue hors ligne du journal du relais.
 */
import { createSim } from '@game/sim-core';
import { testConfig } from '@game/sim-core/testing';
import { createNetClient, type NetClient } from '../src/client.ts';
import { FRAME_MS } from '../src/constants.ts';
import { simGame, stepWithRespawn } from '../src/game.ts';
import { MSG_CHECKSUM, createMessage, decode } from '../src/protocol.ts';
import { createRelay, type RelayGameEvent } from '../src/server/relay.ts';
import {
  createScheduler,
  createVirtualNetwork,
  type LinkConditions,
} from '../src/testing/network.ts';
import type { Transport } from '../src/transport.ts';
import { HumanInputs, Rng } from './helpers.ts';
import { testAuthenticate } from './relay-fake.ts';

export interface Outage {
  readonly client: number;
  /** Coupure, en ms après le départ de la partie. */
  readonly from: number;
  /** Retour (nouvelle connexion, nouveau jeu), en ms après le départ ; absent : jamais. */
  readonly to?: number;
}

export interface RejoinSetup {
  readonly players: number;
  readonly frames: number;
  readonly seed: number;
  readonly link: LinkConditions;
  readonly outages: readonly Outage[];
}

export interface RejoinClientResult {
  /** Empreintes envoyées par toutes les connexions successives du joueur : frame → valeur. */
  readonly checksums: Map<number, number>;
  /** Empreintes contradictoires envoyées par le même joueur pour une même frame. */
  readonly conflicts: number;
  readonly frame: number;
  readonly status: string;
  readonly error: string | null;
  readonly desyncs: number;
  /** Pour chaque retour : temps (ms simulées) pour rattraper l'horloge de la partie. */
  readonly catchUpMs: number[];
  readonly rejoinedEvents: [slot: number, frame: number][];
  readonly stalls: number;
}

export interface RejoinResult {
  readonly clients: RejoinClientResult[];
  readonly reference: Map<number, number>;
  readonly events: RelayGameEvent[];
  readonly relayDesyncs: number;
  /** Octets de l'historique gardé par le relais à la fin de la partie. */
  readonly historyFrames: number;
}

const GAME_ID = 'reservee';

export function runRejoinMatch(setup: RejoinSetup): RejoinResult {
  const scheduler = createScheduler(10_000);
  let relayDesyncs = 0;
  const events: RelayGameEvent[] = [];
  const relay = createRelay({
    now: scheduler.now,
    record: true,
    seed: () => setup.seed,
    authenticate: testAuthenticate,
    onDesync: () => relayDesyncs++,
    onGameEvent: (e) => events.push(e),
  });
  const seats = Array.from({ length: setup.players }, (_, i) => `p${i}`);
  relay.reserve(GAME_ID, { seats, expiresInMs: 60_000 });
  const network = createVirtualNetwork({ scheduler, relay, seed: setup.seed, mode: 'ordered' });
  const rng = new Rng(setup.seed);
  let startAt = Number.NaN;
  const end = (): number => startAt + setup.frames * FRAME_MS;

  const relayTick = (): void => {
    relay.tick();
    scheduler.at(scheduler.now() + 4, relayTick);
  };
  scheduler.at(scheduler.now() + 4, relayTick);

  interface Player {
    readonly index: number;
    client: NetClient | null;
    link: ReturnType<typeof network.connect> | null;
    sim: ReturnType<typeof createSim> | null;
    human: HumanInputs;
    readonly checksums: Map<number, number>;
    conflicts: number;
    desyncs: number;
    catchUpMs: number[];
    rejoinedAt: number;
    rejoinedEvents: [number, number][];
    stalls: number;
  }

  function connect(player: Player): void {
    const link = network.connect(setup.link, setup.link);
    const spy = createMessage();
    const transport: Transport = {
      ...link,
      send(data) {
        if (data[0] === MSG_CHECKSUM && decode(data, spy) === null) {
          const previous = player.checksums.get(spy.frame);
          if (previous !== undefined && previous !== spy.value) player.conflicts++;
          player.checksums.set(spy.frame, spy.value);
        }
        link.send(data);
      },
    };
    const client = createNetClient({
      transport,
      gameId: GAME_ID,
      players: setup.players,
      localPlayers: 1,
      ticket: `ok:p${player.index}`,
      now: scheduler.now,
    });
    client.onDesync(() => player.desyncs++);
    client.onPlayerRejoined((slot, frame) => player.rejoinedEvents.push([slot, frame]));
    player.client = client;
    player.link = link;
    player.sim = null;
  }

  const players: Player[] = seats.map((_, index) => ({
    index,
    client: null,
    link: null,
    sim: null,
    human: new HumanInputs(setup.seed * 31 + index),
    checksums: new Map(),
    conflicts: 0,
    desyncs: 0,
    catchUpMs: [],
    rejoinedAt: Number.NaN,
    rejoinedEvents: [],
    stalls: 0,
  }));
  for (const p of players) connect(p);

  const outages = setup.outages.map((o) => ({ ...o, cut: false, back: false }));

  for (const player of players) {
    const tick = (): void => {
      const t = scheduler.now();
      const since = Number.isNaN(startAt) ? -Infinity : t - startAt;
      for (const o of outages) {
        if (o.client !== player.index) continue;
        if (!o.cut && since >= o.from) {
          o.cut = true;
          player.stalls += player.client!.stats().stalls;
          player.link!.disconnect();
        } else if (o.cut && !o.back && o.to !== undefined && since >= o.to) {
          o.back = true;
          // Page rechargée : nouvelle connexion, nouveau jeu, mêmes joueurs humains.
          connect(player);
          player.rejoinedAt = t;
        }
      }
      const client = player.client!;
      if (client.status === 'starting' && player.sim === null) {
        const match = client.match!;
        if (Number.isNaN(startAt)) startAt = match.startAt;
        player.sim = createSim(testConfig(match.players, match.seed));
        client.begin(simGame(player.sim, stepWithRespawn));
      }
      if (client.status !== 'closed') {
        client.update((out) => {
          out[0] = player.human.next();
        });
        if (!Number.isNaN(player.rejoinedAt) && client.status === 'running') {
          const s = client.stats();
          if (s.frame >= s.targetFrame - 1) {
            player.catchUpMs.push(t - player.rejoinedAt);
            player.rejoinedAt = Number.NaN;
          }
        }
      }
      if (Number.isNaN(startAt) || t < end() + 1000) {
        scheduler.at(t + FRAME_MS + (rng.float() * 2 - 1) * 2, tick);
      }
    };
    scheduler.at(scheduler.now() + rng.float() * FRAME_MS, tick);
  }

  let guard = 0;
  while (Number.isNaN(startAt) && guard++ < 1000) scheduler.runUntil(scheduler.now() + 100);
  if (Number.isNaN(startAt)) throw new Error('la partie n’a jamais démarré');
  scheduler.runUntil(end() + 1500);

  const history = relay.history(GAME_ID)!;
  const sim = createSim(testConfig(setup.players, setup.seed));
  const game = simGame(sim, stepWithRespawn);
  const reference = new Map<number, number>();
  for (let f = 0; f < history.length; f++) {
    game.step(history[f]!);
    if ((f + 1) % 15 === 0) reference.set(f + 1, game.checksum());
  }

  return {
    clients: players.map((p) => ({
      checksums: p.checksums,
      conflicts: p.conflicts,
      frame: p.client!.stats().frame,
      status: p.client!.status,
      error: p.client!.error,
      desyncs: p.desyncs,
      catchUpMs: p.catchUpMs,
      rejoinedEvents: p.rejoinedEvents,
      stalls: p.stalls + p.client!.stats().stalls,
    })),
    reference,
    events,
    relayDesyncs,
    historyFrames: history.length,
  };
}
