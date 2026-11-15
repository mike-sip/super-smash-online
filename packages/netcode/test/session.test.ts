/**
 * Bout en bout simulé, critères de succès n° 1 et 2 de SPEC-netcode.md : des clients jouent dix
 * minutes sur un réseau avec latence, gigue, pertes et horloges qui dérivent ; tous finissent
 * avec les mêmes empreintes, égales à celles d'une rejoue hors ligne du journal du relais.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_INPUT_DELAY, FRAME_MS } from '../src/constants.ts';
import { Rng } from './helpers.ts';
import { runMatch, typicalLink, type ClientSetup, type MatchResult } from './match.ts';

const TEN_MINUTES = 36_000;

/** Clients du critère n° 1 : 40 à 120 ms d'aller-retour, 15 ms de gigue, horloges à ±0,1 %. */
function typicalClients(count: number, seed: number, loss: number): ClientSetup[] {
  const rng = new Rng(seed);
  return Array.from({ length: count }, (_, i) => {
    const [up, down] = typicalLink(rng, loss);
    return { up, down, clockRate: i % 2 === 0 ? 1.001 : 0.999, frameJitterMs: 2 };
  });
}

/** Vérifie l'absence de désync et renvoie un résumé chiffré par client, pour le compte rendu. */
function expectInSync(result: MatchResult, frames: number): string {
  expect(result.relayDesyncs).toBe(0);
  const lines: string[] = [];
  for (const [i, c] of result.clients.entries()) {
    expect(c.error).toBeNull();
    expect(c.desyncs).toEqual([]);
    expect(c.framesInOrder).toBe(true);
    // Toutes les empreintes envoyées sont celles de la rejoue hors ligne…
    let checked = 0;
    for (const [frame, value] of c.checksums) {
      expect(value, `client ${i}, frame ${frame}`).toBe(result.reference.get(frame));
      checked++;
    }
    // …et elles couvrent toute la partie.
    expect(checked).toBeGreaterThanOrEqual(Math.floor(frames / 15) - 2);
    const s = c.stats;
    lines.push(
      `client ${i} : ${s.frame} frames, ${checked} empreintes vérifiées, rtt ${s.rttMs.toFixed(0)} ms, ` +
        `${s.rollbacks} rollbacks (moyenne ${s.meanRollback.toFixed(2)}, max ${s.maxRollback}), ` +
        `${s.stalls} attentes sur ${c.updates} images, ${s.lateInputs} inputs remplacés`,
    );
  }
  return lines.join('\n');
}

/**
 * Critère n° 2. Attentes : sous `maxStalls` des images de chaque client. Profondeur des rollbacks :
 * elle dépend de la latence, car un input distant arrive après l'aller de son auteur, le retour
 * vers ce client, la gigue des deux trajets, l'attente de la prochaine image de l'auteur et de
 * celle du destinataire (une demi-frame chacune en moyenne) et le pas du relais (2 ms en
 * moyenne) ; le délai d'input en retranche `D`. Chaque client est borné par cette valeur
 * attendue plus une frame de marge. La moyenne globale est affichée : la spec visait moins de
 * 4 frames, ce que la physique ne permet pas pour des allers-retours de 40 à 120 ms (voir le
 * bilan de la spec).
 */
function expectResponsive(
  result: MatchResult,
  setups: readonly ClientSetup[],
  frames: number,
  maxStalls = 0.01,
): string {
  const oneWay = (c: ClientSetup, dir: 'up' | 'down'): number =>
    c[dir].latencyMs + (c[dir].jitterMs ?? 0) / 2;
  let rollbacks = 0;
  let depth = 0;
  for (const [i, c] of result.clients.entries()) {
    expect(c.stats.stalls, `attentes du client ${i}`).toBeLessThanOrEqual(c.updates * maxStalls);
    let others = 0;
    for (const [j, o] of setups.entries()) if (j !== i) others += oneWay(o, 'up');
    others /= setups.length - 1;
    const path = others + oneWay(setups[i]!, 'down') + FRAME_MS + 2;
    const expected = path / FRAME_MS - DEFAULT_INPUT_DELAY;
    expect(c.stats.meanRollback, `profondeur du client ${i}`).toBeLessThanOrEqual(expected + 1);
    rollbacks += c.stats.rollbacks;
    depth += c.stats.meanRollback * c.stats.rollbacks;
  }
  const mean = depth / rollbacks;
  const kb = result.network.bytes / 1024 / (frames / 60) / result.clients.length / 2;
  return (
    `profondeur moyenne de l'ensemble des rollbacks : ${mean.toFixed(2)} frames ; ` +
    `débit : ${kb.toFixed(1)} Ko/s par client et par sens`
  );
}

/**
 * Critère n° 7 : effets du rendu après rollback. Le rendu ne déclenche un effet que pour les
 * événements d'une frame nouvelle. Comparés à la rejoue hors ligne : un événement de la rejoue
 * absent chez le client est un effet manqué ; un événement vu par le client mais absent de la
 * rejoue est un effet joué à tort (prédiction fausse).
 */
function effectAccuracy(result: MatchResult): string {
  let reference = 0;
  let missed = 0;
  let wrong = 0;
  for (const c of result.clients) {
    const last = c.stats.frame;
    for (const key of result.referenceEvents) {
      if (Number.parseInt(key, 10) > last) continue;
      reference++;
      if (!c.events.has(key)) missed++;
    }
    for (const key of c.events.keys()) if (!result.referenceEvents.has(key)) wrong++;
  }
  const pct = (n: number): string => ((100 * n) / reference).toFixed(1);
  return (
    `effets : ${reference} attendus (tous clients), ${pct(missed)} % manqués, ` +
    `${pct(wrong)} % joués à tort`
  );
}

describe('bout en bout simulé', () => {
  it('2 clients, 10 minutes, datagrammes avec 5 % de pertes', () => {
    const clients = typicalClients(2, 1, 0.05);
    const result = runMatch({
      clients,
      frames: TEN_MINUTES,
      seed: 101,
      mode: 'datagram',
    });
    const sync = expectInSync(result, TEN_MINUTES);
    const responsive = expectResponsive(result, clients, TEN_MINUTES);
    const effects = effectAccuracy(result);
    console.log(`2 clients, datagrammes, 5 % de pertes\n${sync}\n${responsive}\n${effects}`);
  }, 120_000);

  it('8 clients, 10 minutes, datagrammes avec 5 % de pertes', () => {
    const clients = typicalClients(8, 2, 0.05);
    const result = runMatch({
      clients,
      frames: TEN_MINUTES,
      seed: 202,
      mode: 'datagram',
    });
    const sync = expectInSync(result, TEN_MINUTES);
    const responsive = expectResponsive(result, clients, TEN_MINUTES);
    const effects = effectAccuracy(result);
    console.log(`8 clients, datagrammes, 5 % de pertes\n${sync}\n${responsive}\n${effects}`);
  }, 300_000);

  it('8 clients, 10 minutes, ordre garanti (WebSocket) avec 0,5 % de retransmissions', () => {
    const clients = typicalClients(8, 3, 0.005);
    const result = runMatch({
      clients,
      frames: TEN_MINUTES,
      seed: 303,
      mode: 'ordered',
    });
    const sync = expectInSync(result, TEN_MINUTES);
    // Sur TCP, une perte bloque tous les messages suivants le temps de la retransmission : les
    // clients les plus lointains attendent davantage (voir « Écarts » dans la spec).
    const responsive = expectResponsive(result, clients, TEN_MINUTES, 0.05);
    console.log(`8 clients, WebSocket, 0,5 % de retransmissions\n${sync}\n${responsive}`);
  }, 300_000);

  it('plusieurs joueurs sur une même machine', () => {
    const rng = new Rng(4);
    const clients: ClientSetup[] = [2, 1, 3].map((localPlayers) => {
      const [up, down] = typicalLink(rng, 0.02);
      return { up, down, localPlayers };
    });
    const result = runMatch({ clients, frames: 3600, seed: 404, mode: 'datagram' });
    expect(result.players).toBe(6);
    expectInSync(result, 3600);
  }, 60_000);
});
