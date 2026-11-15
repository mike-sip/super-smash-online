/**
 * Reconnexion en pleine partie (SPEC-lobby.md, critère n° 5) : un joueur coupé revient, rattrape
 * la partie en rejouant l'historique du relais, et finit avec les mêmes empreintes que les autres
 * et que la rejoue hors ligne du journal du relais.
 */
import { describe, expect, it } from 'vitest';
import { FRAME_MS } from '../src/constants.ts';
import { runRejoinMatch, type RejoinResult } from './rejoin-match.ts';

const LINK = { latencyMs: 25, jitterMs: 10 };

function expectSynchronized(result: RejoinResult): void {
  expect(result.relayDesyncs).toBe(0);
  expect(result.reference.size).toBeGreaterThan(0);
  for (const [index, c] of result.clients.entries()) {
    expect(c.desyncs, `client ${index}`).toBe(0);
    expect(c.conflicts, `client ${index}`).toBe(0);
    let compared = 0;
    for (const [frame, value] of c.checksums) {
      const expected = result.reference.get(frame);
      if (expected === undefined) continue;
      expect(value, `client ${index}, frame ${frame}`).toBe(expected);
      compared++;
    }
    expect(compared, `client ${index}`).toBeGreaterThan(result.reference.size * 0.9);
  }
}

describe('reconnexion en pleine partie', () => {
  it('un joueur coupé à 1 min revient à 5 min, rattrape en moins de 20 s et reste synchronisé', () => {
    const frames = 6 * 60 * 60; // 6 minutes
    const result = runRejoinMatch({
      players: 4,
      frames,
      seed: 7,
      link: LINK,
      outages: [{ client: 2, from: 60_000, to: 300_000 }],
    });
    expectSynchronized(result);
    const back = result.clients[2]!;
    expect(back.status).toBe('running');
    expect(back.catchUpMs).toHaveLength(1);
    expect(back.catchUpMs[0]!).toBeLessThan(20_000);
    console.log(
      `rattrapage de ${(300_000 / 1000).toFixed(0)} s de jeu : ${(back.catchUpMs[0]! / 1000).toFixed(2)} s`,
    );
    // Tout le monde est prévenu, et le relais l'annonce au lobby.
    for (const c of result.clients) {
      expect(c.rejoinedEvents.map(([slot]) => slot)).toContain(2);
    }
    const left = result.events.find((e) => e.type === 'left');
    const rejoined = result.events.find((e) => e.type === 'rejoined');
    expect(left).toMatchObject({ slot: 2 });
    expect(rejoined).toMatchObject({ slot: 2 });
    // Ses inputs comptent de nouveau : le revenant finit à la frame des autres.
    const frameOf = result.clients.map((c) => c.frame);
    expect(Math.max(...frameOf) - frameOf[2]!).toBeLessThan(30);
    // Mémoire : l'historique complet de la partie est gardé.
    expect(result.historyFrames).toBeGreaterThanOrEqual(frames);
  }, 120_000);

  it('deux départs et retours successifs, et deux joueurs absents en même temps', () => {
    const result = runRejoinMatch({
      players: 3,
      frames: 90 * 60,
      seed: 11,
      link: LINK,
      outages: [
        { client: 0, from: 10_000, to: 20_000 },
        { client: 0, from: 40_000, to: 45_000 },
        { client: 1, from: 15_000, to: 50_000 },
      ],
    });
    expectSynchronized(result);
    expect(result.clients[0]!.catchUpMs).toHaveLength(2);
    expect(result.clients[1]!.catchUpMs).toHaveLength(1);
    expect(result.events.filter((e) => e.type === 'rejoined')).toHaveLength(3);
  }, 120_000);

  it('les autres n’attendent pas pendant le rattrapage du revenant', () => {
    const result = runRejoinMatch({
      players: 2,
      frames: 3 * 60 * 60,
      seed: 3,
      link: LINK,
      outages: [{ client: 1, from: 20_000, to: 150_000 }],
    });
    expectSynchronized(result);
    expect(result.clients[0]!.stalls).toBeLessThan((3 * 60 * 60) / 100);
    expect(FRAME_MS).toBeGreaterThan(16);
  }, 120_000);
});
