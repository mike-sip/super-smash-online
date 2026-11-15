/**
 * Bout en bout simulé, critère de succès n° 3 de SPEC-netcode.md : un joueur lent, déconnecté ou
 * dont l'onglet est masqué ne fait pas attendre les autres, et les empreintes restent identiques.
 * Plus un test témoin : une désync volontaire est bien détectée.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from './helpers.ts';
import { runMatch, typicalLink, type ClientSetup, type MatchResult } from './match.ts';

const FRAMES = 3600 * 2; // deux minutes

/**
 * Liaisons ordinaires. Sans perte par défaut : les effets des pertes sur TCP sont mesurés dans
 * session.test.ts, ici on isole la panne étudiée.
 */
function normalClients(count: number, seed: number, loss = 0): ClientSetup[] {
  const rng = new Rng(seed);
  return Array.from({ length: count }, () => {
    const [up, down] = typicalLink(rng, loss);
    return { up, down, frameJitterMs: 2 };
  });
}

/** Les empreintes de tous les clients cités sont celles de la rejoue hors ligne. */
function expectSameChecksums(result: MatchResult, clients: readonly number[]): void {
  expect(result.relayDesyncs).toBe(0);
  for (const i of clients) {
    const c = result.clients[i]!;
    expect(c.desyncs).toEqual([]);
    expect(c.checksums.size).toBeGreaterThan(0);
    for (const [frame, value] of c.checksums) {
      expect(value, `client ${i}, frame ${frame}`).toBe(result.reference.get(frame));
    }
  }
}

/** Aucun des clients cités n'attend plus de 1 % de ses images. */
function expectNoWaiting(result: MatchResult, clients: readonly number[]): void {
  for (const i of clients) {
    const c = result.clients[i]!;
    expect(c.stats.stalls, `attentes du client ${i}`).toBeLessThanOrEqual(c.updates * 0.01);
  }
}

describe('pannes', () => {
  it('un joueur à 400 ms d’aller-retour ne fait attendre personne', () => {
    const clients = normalClients(4, 1, 0.05);
    clients[2] = { up: { latencyMs: 200, jitterMs: 15 }, down: { latencyMs: 200, jitterMs: 15 } };
    const result = runMatch({ clients, frames: FRAMES, seed: 11, mode: 'datagram' });
    expectSameChecksums(result, [0, 1, 2, 3]);
    expectNoWaiting(result, [0, 1, 3]);
    // Lui voit ses inputs remplacés par le serveur : c'est lui qui paie sa latence.
    expect(result.clients[2]!.stats.lateInputs).toBeGreaterThan(0);
    console.log(
      `joueur lent : ${result.clients[2]!.stats.lateInputs} inputs remplacés, ` +
        `${result.clients[2]!.stats.stalls} attentes ; les autres : ` +
        [0, 1, 3].map((i) => result.clients[i]!.stats.stalls).join(', ') +
        ' attentes',
    );
  }, 60_000);

  it('un joueur déconnecté en pleine partie : les autres continuent, sans désync', () => {
    const clients = normalClients(4, 2);
    clients[1] = { ...clients[1]!, disconnectAt: 30_000 };
    const result = runMatch({ clients, frames: FRAMES, seed: 22, mode: 'ordered' });
    expectSameChecksums(result, [0, 2, 3]);
    expectNoWaiting(result, [0, 2, 3]);
    expect(result.clients[1]!.status).toBe('closed');
    // Les autres ont continué jusqu'au bout.
    for (const i of [0, 2, 3])
      expect(result.clients[i]!.stats.frame).toBeGreaterThanOrEqual(FRAMES);
  }, 60_000);

  it('un onglet masqué 10 s : les autres n’attendent pas, lui rattrape la partie', () => {
    const clients = normalClients(4, 3);
    clients[3] = { ...clients[3]!, hidden: [20_000, 30_000] };
    const result = runMatch({ clients, frames: FRAMES, seed: 33, mode: 'ordered' });
    expectSameChecksums(result, [0, 1, 2, 3]);
    expectNoWaiting(result, [0, 1, 2]);
    const hidden = result.clients[3]!;
    expect(hidden.error).toBeNull();
    expect(hidden.stats.frame).toBeGreaterThanOrEqual(FRAMES);
    expect(hidden.framesInOrder).toBe(true);
    console.log(
      `onglet masqué : ${hidden.stats.lateInputs} inputs remplacés, ${hidden.updates} images ` +
        `pour ${hidden.stats.frame} frames (rattrapage)`,
    );
  }, 60_000);

  it('témoin : une désync volontaire est détectée par le serveur et signalée à tous', () => {
    const clients = normalClients(3, 4);
    clients[1] = { ...clients[1]!, corrupt: true };
    const result = runMatch({ clients, frames: 1200, seed: 44, mode: 'ordered' });
    expect(result.relayDesyncs).toBe(1);
    for (const c of result.clients) {
      expect(c.desyncs).toHaveLength(1);
      // Première frame de contrôle après la frame 300 où le client 1 diverge.
      expect(c.desyncs[0]).toBe(315);
    }
  }, 60_000);
});
