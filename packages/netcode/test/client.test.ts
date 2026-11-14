import { describe, expect, it } from 'vitest';
import { createNetClient, type NetClient, type NetStatus } from '../src/client.ts';
import { FRAME_MS } from '../src/constants.ts';
import { MSG_ERROR, createMessage, encode, MAX_MESSAGE_BYTES } from '../src/protocol.ts';
import { createRelay } from '../src/server/relay.ts';
import { createScheduler, createVirtualNetwork, type VirtualLink } from '../src/testing/network.ts';
import type { Transport } from '../src/transport.ts';
import { testGame } from './helpers.ts';

const LINK = { latencyMs: 10 };

function setup(players = 2) {
  const scheduler = createScheduler(0);
  const relay = createRelay({ now: scheduler.now, seed: () => 9 });
  const network = createVirtualNetwork({ scheduler, relay, seed: 1, mode: 'ordered' });
  const tick = (): void => {
    relay.tick();
    scheduler.at(scheduler.now() + 4, tick);
  };
  scheduler.at(4, tick);
  function join(localPlayers = 1, gameId = 'test'): { client: NetClient; link: VirtualLink } {
    const link = network.connect(LINK, LINK);
    const client = createNetClient({
      transport: link,
      gameId,
      players,
      localPlayers,
      now: scheduler.now,
    });
    return { client, link };
  }
  /** Avance le temps virtuel en appelant `update` de chaque client à chaque frame. */
  function run(
    ms: number,
    clients: NetClient[],
    sample: (out: Uint32Array) => void = (out) => out.fill(0),
  ) {
    const end = scheduler.now() + ms;
    while (scheduler.now() < end) {
      scheduler.runUntil(scheduler.now() + FRAME_MS);
      for (const c of clients) {
        if (c.status === 'starting' && !begun.has(c)) {
          begun.add(c);
          c.begin(testGame(c.match!.players, c.match!.seed).game);
        }
        c.update(sample);
      }
    }
  }
  const begun = new Set<NetClient>();
  return { scheduler, relay, join, run };
}

describe('session client', () => {
  it('passe par connexion, attente, départ et partie', () => {
    const env = setup();
    const a = env.join();
    const seen: NetStatus[] = [];
    a.client.onStatus((s) => seen.push(s));
    expect(a.client.status).toBe('connecting');
    env.run(100, [a.client]);
    expect(a.client.status).toBe('waiting');
    expect(a.client.joined).toBe(1);
    expect(a.client.match).toBeNull();

    const b = env.join();
    env.run(100, [a.client, b.client]);
    expect(a.client.status).toBe('starting');
    expect(a.client.match).toMatchObject({
      seed: 9,
      players: 2,
      localSlots: [0],
      inputDelay: 2,
      maxPrediction: 15,
      checksumInterval: 15,
    });
    expect(b.client.match!.localSlots).toEqual([1]);

    env.run(2500, [a.client, b.client]);
    expect(a.client.status).toBe('running');
    expect(seen).toEqual(['waiting', 'starting', 'running']);
    const stats = a.client.stats();
    expect(stats.frame).toBeGreaterThan(20);
    expect(stats.rttMs).toBeCloseTo(20, 6);
    expect(stats.stalls).toBe(0);
  });

  it('n’échantillonne rien et renvoie 0 avant le départ', () => {
    const env = setup();
    const a = env.join();
    let samples = 0;
    env.run(200, [a.client], () => samples++);
    expect(samples).toBe(0);
    expect(a.client.update(() => samples++)).toBe(0);
  });

  it('échantillonne une fois par frame nouvelle et signale chacune une fois', () => {
    const env = setup();
    const a = env.join();
    const b = env.join();
    env.run(2300, [a.client, b.client]);
    let samples = 0;
    let frames = 0;
    const before = a.client.stats().frame;
    for (let k = 0; k < 60; k++) {
      env.scheduler.runUntil(env.scheduler.now() + FRAME_MS);
      a.client.update(
        () => samples++,
        () => frames++,
      );
      b.client.update(() => {});
    }
    const advanced = a.client.stats().frame - before;
    expect(advanced).toBeGreaterThan(50);
    expect(samples).toBe(advanced);
    expect(frames).toBe(advanced);
  });

  it('refuse begin avant la partie, deux fois, ou avec un jeu au mauvais nombre de joueurs', () => {
    const env = setup();
    const a = env.join();
    env.join();
    expect(() => a.client.begin(testGame(2).game)).toThrow();
    // Sans update : la partie devient connue à la réception de START.
    env.scheduler.runUntil(env.scheduler.now() + 100);
    expect(a.client.status).toBe('starting');
    expect(() => a.client.begin(testGame(3).game)).toThrow();
    a.client.begin(testGame(2).game);
    expect(() => a.client.begin(testGame(2).game)).toThrow();
  });

  it('se ferme sur une erreur du serveur, avec son texte', () => {
    const env = setup(2);
    const a = env.join(1);
    const b = env.join(2); // deux joueurs locaux dans une partie à deux dont une place est prise
    env.run(100, [a.client, b.client]);
    expect(b.client.status).toBe('closed');
    expect(b.client.error).toMatch(/place/);
    expect(a.client.status).toBe('waiting');
  });

  it('ignore un message invalide du serveur, et se ferme sur une erreur bien formée', () => {
    let deliver: (data: Uint8Array) => void = () => {};
    let open: () => void = () => {};
    const transport: Transport = {
      send: () => {},
      close: () => {},
      onOpen: (l) => (open = l),
      onMessage: (l) => (deliver = l),
      onClose: () => {},
    };
    const client = createNetClient({
      transport,
      gameId: 'x',
      players: 2,
      localPlayers: 1,
      now: () => 0,
    });
    open();
    expect(client.status).toBe('waiting');
    deliver(Uint8Array.from([250, 1, 2, 3]));
    deliver(new Uint8Array(0));
    expect(client.status).toBe('waiting');
    const m = createMessage();
    m.type = MSG_ERROR;
    m.code = 1;
    m.text = 'Version incompatible.';
    const buf = new Uint8Array(MAX_MESSAGE_BYTES);
    deliver(buf.slice(0, encode(m, buf)));
    expect(client.status).toBe('closed');
    expect(client.error).toBe('Version incompatible.');
  });

  it('se ferme quand la connexion tombe', () => {
    const env = setup();
    const a = env.join();
    env.run(100, [a.client]);
    a.link.disconnect();
    expect(a.client.status).toBe('closed');
    expect(a.client.error).toBe('connexion perdue');
  });
});
