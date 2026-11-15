/**
 * Bout en bout réel (critère n° 5) : serveur relais et clients Node.js sur de vrais WebSocket,
 * en local, avec une latence artificielle à l'envoi et à la réception. Temps réel : quelques
 * secondes de jeu par test.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createSim, events } from '@game/sim-core';
import { testConfig } from '@game/sim-core/testing';
import { createNetClient, type NetClient } from '../../src/client.ts';
import { simGame, stepWithRespawn } from '../../src/game.ts';
import { MSG_CHECKSUM, createMessage, decode } from '../../src/protocol.ts';
import { startRelayServer, type RelayHost } from '../../src/server/host.ts';
import { webSocketTransport, type Transport } from '../../src/transport.ts';
import { HumanInputs } from '../helpers.ts';

/** Retarde chaque message de `ms` dans chaque sens (latence artificielle). */
function delayed(inner: Transport, ms: number): Transport {
  return {
    send(data) {
      const copy = data.slice();
      setTimeout(() => inner.send(copy), ms);
    },
    close: () => inner.close(),
    onOpen: (l) => inner.onOpen(l),
    onMessage: (l) => inner.onMessage((data) => setTimeout(() => l(data), ms)),
    onClose: (l) => inner.onClose(l),
  };
}

interface Player {
  readonly client: NetClient;
  readonly checksums: Map<number, number>;
  begun: boolean;
}

let host: RelayHost | null = null;
afterEach(async () => {
  await host?.close();
  host = null;
});

async function play(count: number, latencies: (i: number) => number, seconds: number) {
  host = await startRelayServer(0, { record: true, seed: () => 77 }, '127.0.0.1');
  const url = `ws://127.0.0.1:${host.port}/net`;
  const players: Player[] = [];
  for (let i = 0; i < count; i++) {
    const checksums = new Map<number, number>();
    const spy = createMessage();
    const inner = delayed(webSocketTransport(url), latencies(i));
    const transport: Transport = {
      ...inner,
      send(data) {
        if (data[0] === MSG_CHECKSUM && decode(data, spy) === null) {
          checksums.set(spy.frame, spy.value);
        }
        inner.send(data);
      },
    };
    const client = createNetClient({
      transport,
      gameId: 'reel',
      players: count,
      localPlayers: 1,
      now: () => performance.now(),
    });
    players.push({ client, checksums, begun: false });
  }
  const humans = players.map((_, i) => new HumanInputs(1000 + i));
  let startAt = Number.NaN;
  await new Promise<void>((resolve, reject) => {
    const loop = setInterval(() => {
      for (const [i, p] of players.entries()) {
        if (p.client.status === 'starting' && !p.begun) {
          p.begun = true;
          const m = p.client.match!;
          startAt = m.startAt;
          p.client.begin(simGame(createSim(testConfig(m.players, m.seed)), stepWithRespawn));
        }
        if (p.client.status === 'closed') {
          clearInterval(loop);
          reject(new Error(`client ${i} fermé : ${p.client.error}`));
          return;
        }
        p.client.update((out) => (out[0] = humans[i]!.next()));
      }
      if (players.every((p) => p.client.stats().frame >= seconds * 60)) {
        clearInterval(loop);
        resolve();
      }
    }, 1000 / 60);
  });
  // Laisse arriver les dernières confirmations et empreintes.
  await new Promise((r) => setTimeout(r, 500));
  for (const p of players) p.client.update(() => {});
  expect(Number.isNaN(startAt)).toBe(false);

  // Rejoue hors ligne du journal du relais.
  const history = host.relay.history('reel')!;
  const sim = createSim(testConfig(count, 77));
  const game = simGame(sim, stepWithRespawn);
  const reference = new Map<number, number>();
  for (let f = 0; f < history.length; f++) {
    game.step(history[f]!);
    events(sim);
    if ((f + 1) % 15 === 0) reference.set(f + 1, game.checksum());
  }
  return { players, reference };
}

describe('vrais WebSocket', () => {
  it('2 clients, latence artificielle de 20 et 40 ms : empreintes identiques', async () => {
    const { players, reference } = await play(2, (i) => (i === 0 ? 10 : 20), 4);
    for (const [i, p] of players.entries()) {
      expect(p.checksums.size).toBeGreaterThan(10);
      for (const [frame, value] of p.checksums) {
        expect(value, `client ${i}, frame ${frame}`).toBe(reference.get(frame));
      }
      expect(p.client.status).toBe('running');
    }
  }, 30_000);

  it('8 clients, latences de 10 à 45 ms : empreintes identiques', async () => {
    const { players, reference } = await play(8, (i) => 5 + i * 3, 4);
    for (const [i, p] of players.entries()) {
      expect(p.checksums.size).toBeGreaterThan(10);
      for (const [frame, value] of p.checksums) {
        expect(value, `client ${i}, frame ${frame}`).toBe(reference.get(frame));
      }
    }
    const s = players.map((p) => p.client.stats());
    console.log(
      `8 clients réels : rollbacks moyens ${s.map((x) => x.meanRollback.toFixed(1)).join(' ')} ; ` +
        `attentes ${s.map((x) => x.stalls).join(' ')}`,
    );
  }, 30_000);

  it('un client qui envoie n’importe quoi est déconnecté sans gêner les autres', async () => {
    host = await startRelayServer(0, {}, '127.0.0.1');
    const url = `ws://127.0.0.1:${host.port}/net`;
    const good = createNetClient({
      transport: webSocketTransport(url),
      gameId: 'x',
      players: 2,
      localPlayers: 1,
      now: () => performance.now(),
    });
    const bad = new WebSocket(url);
    const closed = new Promise<number>((resolve) => {
      bad.addEventListener('close', (e) => resolve(e.code));
    });
    await new Promise((r) => bad.addEventListener('open', r));
    bad.send(new Uint8Array([200, 1, 2, 3]));
    expect(await closed).toBe(4000);
    // Texte, puis message trop gros, sur deux autres connexions.
    const text = new WebSocket(url);
    await new Promise((r) => text.addEventListener('open', r));
    const textClosed = new Promise((r) => text.addEventListener('close', r));
    text.send('bonjour');
    await textClosed;
    const big = new WebSocket(url);
    await new Promise((r) => big.addEventListener('open', r));
    const bigClosed = new Promise((r) => big.addEventListener('close', r));
    big.send(new Uint8Array(100_000));
    await bigClosed;
    // Le bon client attend toujours, serveur debout.
    await new Promise((r) => setTimeout(r, 300));
    good.update(() => {});
    expect(good.status).toBe('waiting');
    good.close();
  }, 30_000);
});
