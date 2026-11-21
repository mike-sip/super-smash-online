/**
 * Bout en bout simulé (T11) : tickets signés par la vraie fonction de `accounts`, lobby, relais
 * réservé et joueurs complets (client du lobby, client `netcode`, simulation `match-rules` avec le
 * contenu de test de `sim-core`) dans un même processus, à horloge virtuelle. Le relais passe par
 * le réseau simulé de `netcode` ; le lobby par des WebSocket simulés à la même horloge.
 *
 * Les tickets sont obtenus par des promesses, comme dans le navigateur : la boucle laisse donc
 * tourner les micro-tâches entre deux pas de l'horloge virtuelle (`run` est asynchrone).
 */
import { signTicket } from '@game/accounts/ticket';
import { createMatchSimConfig, matchResult, type MatchResult } from '@game/match-rules';
import { createNetClient, simGame, type NetClient } from '@game/netcode';
import { createRelay, type Relay } from '@game/netcode/server';
import {
  createScheduler,
  createVirtualNetwork,
  type LinkConditions,
  type Scheduler,
  type VirtualLink,
} from '@game/netcode/testing';
import { createSim, type Sim } from '@game/sim-core';
import { TEST_FIGHTER, TEST_STAGE } from '@game/sim-core/testing';
import { HumanInputs } from '../../netcode/test/helpers.ts';
import { lobbyTicketVerifier, relayAuthenticator } from '../src/admission.ts';
import { createLobbyClient, type LobbyClient, type SocketLike } from '../src/client.ts';
import type { MatchStartInfo, RoomRules } from '../src/protocol.ts';
import type { MatchRecord } from '../src/results.ts';
import { createLobby, type Lobby, type LobbyLimits, type LobbyPeer } from '../src/service.ts';

export const SECRET = 'cle-de-test-de-trente-deux-caracteres-au-moins';
const FRAME_MS = 1000 / 60;
export const CONTENT = { fighters: ['mannequin'], stages: ['arene-test'] };

/** Les règles d'un match court : mode Temps, 30 s (le minimum de `match-rules`). */
export const SHORT_RULES: RoomRules = {
  mode: 'time',
  stocks: 3,
  timeLimit: 30,
  stamina: 150,
  teams: false,
  teamAttack: false,
  ultimate: true,
  items: { enabled: false, frequency: 'normal' },
};

export interface World {
  readonly scheduler: Scheduler;
  readonly lobby: Lobby;
  readonly relay: Relay;
  readonly records: MatchRecord[];
  player(id: string): Player;
  /** Fait avancer l'horloge virtuelle de `ms`, en laissant tourner les promesses. */
  run(ms: number): Promise<void>;
  /** Avance jusqu'à ce que `predicate` soit vrai ; lève après `maxMs`. */
  until(predicate: () => boolean, maxMs: number, what: string): Promise<void>;
}

export interface Player {
  readonly id: string;
  readonly lobby: LobbyClient;
  /** Partie en cours de ce joueur : simulation et client netcode. */
  readonly game: { match: MatchStartInfo; net: NetClient; sim: Sim | null } | null;
  /** Résultats calculés par ce joueur (un par match), dans l'ordre. */
  readonly results: MatchResult[];
  /** Page rechargée : nouvelle connexion au lobby, partie reprise de zéro. */
  reload(): void;
  /** Coupure du lobby seul (le client se reconnecte seul). */
  dropLobby(): void;
  /** Quitte la partie (relais) sans revenir ; reste dans le lobby. */
  quitMatch(): void;
  /** Ne rejoint pas le relais au prochain lancement. */
  skipNextMatch: boolean;
}

export function createWorld(options: {
  seed: number;
  link?: LinkConditions;
  limits?: Partial<LobbyLimits>;
  quickRules?: RoomRules;
}): World {
  const scheduler = createScheduler(1_700_000_000_000);
  const link = options.link ?? { latencyMs: 20, jitterMs: 8 };
  const keys = { secrets: [SECRET], now: scheduler.now };
  let lobbyRef: Lobby | null = null;
  const relay = createRelay({
    now: scheduler.now,
    record: true,
    authenticate: relayAuthenticator(keys),
    onGameEvent: (e) => lobbyRef?.relayEvent(e),
    onDesync: (gameId) => lobbyRef?.relayDesync(gameId),
  });
  let rng = options.seed >>> 0 || 1;
  const random = (max: number): number => {
    rng ^= rng << 13;
    rng ^= rng >>> 17;
    rng ^= rng << 5;
    return (rng >>> 0) % max;
  };
  let uuids = 0;
  const records: MatchRecord[] = [];
  const lobby = createLobby({
    now: scheduler.now,
    relay,
    relayPath: '/net',
    verifyTicket: lobbyTicketVerifier(keys),
    content: CONTENT,
    random,
    uuid: () => `00000000-0000-4000-8000-${String(uuids++).padStart(12, '0')}`,
    onMatchResult: (r) => records.push(r),
    limits: options.limits,
    quick: options.quickRules === undefined ? undefined : { rules: options.quickRules },
  });
  lobbyRef = lobby;
  const network = createVirtualNetwork({ scheduler, relay, seed: options.seed, mode: 'ordered' });

  const relayTick = (): void => {
    relay.tick();
    scheduler.at(scheduler.now() + 4, relayTick);
  };
  scheduler.at(scheduler.now() + 4, relayTick);
  const lobbyTick = (): void => {
    lobby.tick();
    scheduler.at(scheduler.now() + 100, lobbyTick);
  };
  scheduler.at(scheduler.now() + 100, lobbyTick);

  const timers = {
    setTimeout(fn: () => void, ms: number): unknown {
      const handle = { cancelled: false };
      scheduler.at(scheduler.now() + ms, () => {
        if (!handle.cancelled) fn();
      });
      return handle;
    },
    clearTimeout(handle: unknown): void {
      (handle as { cancelled: boolean }).cancelled = true;
    },
  };

  /** WebSocket simulé vers le lobby, à la latence de `link`, sur l'horloge virtuelle. */
  function lobbySockets(address: string) {
    const live = new Set<VirtualSocket>();
    const delay = (): number => link.latencyMs + (random(1000) / 1000) * (link.jitterMs ?? 0);
    class VirtualSocket implements SocketLike {
      readyState = 0;
      onopen: ((e: unknown) => void) | null = null;
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onclose: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      private peer: LobbyPeer | null = null;
      private lastUp = 0;
      private lastDown = 0;
      constructor() {
        scheduler.at(scheduler.now() + 2 * link.latencyMs, () => {
          if (this.readyState !== 0) return;
          live.add(this);
          this.peer = lobby.connect(
            {
              send: (text) => {
                // Ordre conservé, comme sur TCP.
                this.lastDown = Math.max(this.lastDown, scheduler.now() + delay());
                scheduler.at(this.lastDown, () => {
                  if (this.readyState === 1) this.onmessage?.({ data: text });
                });
              },
              close: () => scheduler.at(scheduler.now() + link.latencyMs, () => this.finish()),
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
        this.lastUp = Math.max(this.lastUp, scheduler.now() + delay());
        scheduler.at(this.lastUp, () => peer.receive(data));
      }
      close(): void {
        scheduler.at(scheduler.now() + link.latencyMs, () => this.finish());
      }
      finish(): void {
        if (this.readyState === 3) return;
        this.readyState = 3;
        live.delete(this);
        this.peer?.closed();
        this.onclose?.({});
      }
    }
    return { WebSocket: VirtualSocket, dropAll: () => [...live].forEach((s) => s.finish()) };
  }

  let addressCounter = 0;

  function player(id: string): Player {
    const sockets = lobbySockets(`10.0.${addressCounter >> 8}.${addressCounter++ & 255}`);
    const ticket = (aud: 'lobby' | 'relay'): string =>
      signTicket(
        { sub: id, name: id.toUpperCase(), guest: id.startsWith('g'), aud },
        { secret: SECRET, now: scheduler.now() },
      ).ticket;
    const human = new HumanInputs(options.seed * 131 + id.length * 7 + id.charCodeAt(0));
    const results: MatchResult[] = [];
    let game: {
      match: MatchStartInfo;
      net: NetClient;
      sim: Sim | null;
      link: VirtualLink;
      reported: boolean;
    } | null = null;
    let lobbyClient: LobbyClient;
    let frameScheduled = false;

    function startGame(match: MatchStartInfo): void {
      if (game !== null && game.match.gameId === match.gameId && game.net.status !== 'closed')
        return;
      if (self.skipNextMatch) {
        self.skipNextMatch = false;
        return;
      }
      const l = network.connect(link, link);
      const net = createNetClient({
        transport: l,
        gameId: match.gameId,
        players: match.players.length,
        localPlayers: 1,
        ticket: ticket('relay'),
        now: scheduler.now,
      });
      game = { match, net, sim: null, link: l, reported: false };
      if (!frameScheduled) {
        frameScheduled = true;
        scheduler.at(scheduler.now() + FRAME_MS, frame);
      }
    }

    function frame(): void {
      const g = game;
      if (g !== null && g.net.status !== 'closed') {
        if (g.net.status === 'starting' && g.sim === null) {
          const info = g.net.match!;
          g.sim = createSim(
            createMatchSimConfig(g.match.config, {
              stage: TEST_STAGE,
              fighters: g.match.players.map(() => TEST_FIGHTER),
              seed: info.seed,
            }),
          );
          g.net.begin(simGame(g.sim));
        }
        g.net.update((out) => {
          out[0] = human.next();
        });
        // Fin du match, sur un état confirmé : les inputs de toutes les frames jusqu'à la fin sont
        // définitifs (après la fin, le crochet de règles ne change plus rien).
        if (g.sim !== null && !g.reported) {
          const result = matchResult(g.sim);
          if (result !== null && g.net.stats().confirmedFrame > result.endFrame) {
            {
              g.reported = true;
              results.push(result);
              lobbyClient.reportResult(g.match.gameId, result);
            }
          }
        }
      }
      scheduler.at(scheduler.now() + FRAME_MS, frame);
    }

    function connectLobby(): LobbyClient {
      const c = createLobbyClient({
        url: 'ws://simule/lobby',
        getTicket: async () => ticket('lobby'),
        now: scheduler.now,
        WebSocket: sockets.WebSocket,
        timers,
      });
      c.onMatchStart(startGame);
      return c;
    }
    lobbyClient = connectLobby();

    const self: Player = {
      id,
      get lobby() {
        return lobbyClient;
      },
      get game() {
        return game;
      },
      results,
      skipNextMatch: false,
      reload() {
        lobbyClient.close();
        sockets.dropAll();
        if (game !== null) {
          game.link.disconnect();
          game = null;
        }
        lobbyClient = connectLobby();
      },
      dropLobby() {
        sockets.dropAll();
      },
      quitMatch() {
        if (game !== null) {
          game.link.disconnect();
          game.reported = true;
        }
      },
    };
    return self;
  }

  async function run(ms: number): Promise<void> {
    const end = scheduler.now() + ms;
    while (scheduler.now() < end) {
      scheduler.runUntil(Math.min(end, scheduler.now() + 20));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  return {
    scheduler,
    lobby,
    relay,
    records,
    player,
    run,
    async until(predicate, maxMs, what) {
      const end = scheduler.now() + maxMs;
      while (!predicate()) {
        if (scheduler.now() >= end) throw new Error(`délai dépassé : ${what}`);
        await run(20);
      }
    },
  };
}

/** Rejoue hors ligne le journal du relais et renvoie le résultat du match. */
export function replayResult(
  relay: Relay,
  start: MatchStartInfo,
  seed: number,
): MatchResult | null {
  const history = relay.history(start.gameId);
  if (history === null) return null;
  const sim = createSim(
    createMatchSimConfig(start.config, {
      stage: TEST_STAGE,
      fighters: start.players.map(() => TEST_FIGHTER),
      seed,
    }),
  );
  const game = simGame(sim);
  for (const inputs of history) {
    game.step(inputs);
    const r = matchResult(sim);
    if (r !== null) return r;
  }
  return null;
}
