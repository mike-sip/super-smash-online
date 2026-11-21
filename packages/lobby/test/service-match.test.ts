/** Service du lobby : lancement, partie, fin, partie rapide (T9), avec un vrai relais réservé. */
import { describe, expect, it } from 'vitest';
import { FakeClient as RelayClient } from '../../netcode/test/relay-fake.ts';
import type { DeclaredResult, MatchStartInfo } from '../src/protocol.ts';
import { setup, type FakeClient } from './fakes.ts';

function resultFor(players: number, winner = 0): DeclaredResult {
  return {
    endFrame: 2000,
    reason: 'last-standing',
    winners: [winner],
    winningTeam: null,
    players: Array.from({ length: players }, (_, i) => ({
      team: i % 2,
      placement: i === winner ? 1 : 2,
      kos: 0,
      falls: 0,
      selfDestructs: 0,
      score: 0,
      damageDealt: 0,
      damageTaken: 0,
      stocksLeft: 0,
      ultimatesUsed: 0,
      eliminatedAt: -1,
    })),
  };
}

/** Salon privé de `n` joueurs prêts, lancé, compte à rebours écoulé. */
function launched(n = 3) {
  const env = setup();
  const ids = ['alice', 'bob', 'carol', 'dave', 'erin', 'fred', 'gina', 'hugo'].slice(0, n);
  const clients = ids.map((id) => env.client(id));
  clients[0]!.send({ t: 'createRoom' });
  const code = clients[0]!.room()!.code!;
  for (const c of clients.slice(1)) c.send({ t: 'joinRoom', code });
  for (const c of clients) c.send({ t: 'setFighter', fighter: 'vif' });
  for (const c of clients.slice(1)) c.send({ t: 'setReady', ready: true });
  clients[0]!.send({ t: 'start' });
  env.advance(3_100);
  const start = clients[0]!.last('matchStart')!.match;
  return { env, ids, clients, code, start };
}

/** Chaque joueur rejoint le relais avec son ticket « relay ». */
function joinRelay(
  env: ReturnType<typeof setup>,
  start: MatchStartInfo,
  ids: string[],
): RelayClient[] {
  return ids.map((id) => {
    const c = new RelayClient(env.relay);
    c.hello(start.gameId, start.players.length, `relay:${id}`);
    return c;
  });
}

describe('service : lancement', () => {
  it('envoie à chacun sa place et la configuration complète ; réserve la partie au relais', () => {
    const { env, ids, clients, start } = launched(3);
    clients.forEach((c, slot) => {
      const info = c.last('matchStart')!.match;
      expect(info.slot).toBe(slot);
      expect(info.gameId).toBe(start.gameId);
      expect(info.relayPath).toBe('/net');
      expect(info.config.players).toHaveLength(3);
      expect(info.players.map((p) => p.id)).toEqual(ids);
      expect(c.room()!.phase).toBe('playing');
    });
    expect(['arene', 'falaise']).toContain(start.stage);
    expect(env.relay.gameCount()).toBe(1);
    expect(env.lobby.stats().playing).toBe(1);
    // Chacun est admis à sa place par le relais.
    const relayClients = joinRelay(env, start, ids);
    relayClients.forEach((rc, slot) => {
      const s = rc.received.find((m) => m.type === 3)!;
      expect(Array.from(s.slots.subarray(0, s.slotCount))).toEqual([slot]);
    });
  });

  it('annule proprement si quelqu’un ne rejoint pas le relais à temps', () => {
    const { env, ids, clients, start } = launched(2);
    joinRelay(env, start, ids.slice(0, 1));
    env.advance(20_500);
    expect(clients[0]!.last('matchEnd')?.end).toMatchObject({ status: 'cancelled' });
    expect(clients[1]!.room()!.phase).toBe('lobby');
    expect(env.records).toEqual([]);
    expect(env.relay.gameCount()).toBe(0);
  });

  it('un membre reconnecté au lobby pendant la partie reçoit de nouveau matchStart', () => {
    const { env, ids, clients, start } = launched(2);
    joinRelay(env, start, ids);
    clients[1]!.disconnect();
    env.advance(60_000);
    const back = env.client('bob');
    expect(back.last('matchStart')?.match).toMatchObject({ gameId: start.gameId, slot: 1 });
    expect(back.room()!.phase).toBe('playing');
  });
});

describe('service : fin du match', () => {
  function play(n = 3) {
    const l = launched(n);
    const relayClients = joinRelay(l.env, l.start, l.ids);
    l.env.advance(2_500);
    return { ...l, relayClients };
  }

  function declareAll(clients: FakeClient[], gameId: string, result: DeclaredResult): void {
    for (const c of clients) c.send({ t: 'result', gameId, result });
  }

  it('résultats identiques : accepté, salon rendu, relais fermé, classement prévenu', () => {
    const { env, clients, start, relayClients } = play(3);
    declareAll(clients, start.gameId, resultFor(3, 1));
    for (const c of clients) {
      expect(c.last('matchEnd')!.end).toMatchObject({ status: 'agreed', gameId: start.gameId });
      const room = c.room()!;
      expect(room.phase).toBe('lobby');
      expect(room.gameId).toBeNull();
      expect(room.lastEnd?.result?.winners).toEqual([1]);
      expect(room.members.every((m) => !m.ready)).toBe(true);
    }
    expect(env.relay.gameCount()).toBe(0);
    expect(relayClients.every((rc) => rc.closedWith !== null)).toBe(true);
    expect(env.records).toHaveLength(1);
    expect(env.records[0]).toMatchObject({
      status: 'agreed',
      ranked: false,
      kind: 'private',
      gameId: start.gameId,
      winners: [1],
      endFrame: 2000,
    });
    expect(env.records[0]!.players.map((p) => p.accountId)).toEqual(['alice', 'bob', 'carol']);
  });

  it('revanche : le même salon relance une partie', () => {
    const { env, clients, start } = play(2);
    declareAll(clients, start.gameId, resultFor(2));
    clients[1]!.send({ t: 'setReady', ready: true });
    clients[0]!.send({ t: 'start' });
    env.advance(3_100);
    const second = clients[1]!.last('matchStart')!.match;
    expect(second.gameId).not.toBe(start.gameId);
  });

  it('désaccord : contesté, aucun résultat transmis', () => {
    const { env, clients, start } = play(2);
    clients[0]!.send({ t: 'result', gameId: start.gameId, result: resultFor(2, 0) });
    clients[1]!.send({ t: 'result', gameId: start.gameId, result: resultFor(2, 1) });
    expect(clients[0]!.last('matchEnd')!.end.status).toBe('contested');
    expect(env.records[0]).toMatchObject({ status: 'contested', winners: [] });
  });

  it('désynchronisation signalée par le relais : contesté', () => {
    const { env, clients, start } = play(2);
    env.lobby.relayDesync(start.gameId);
    declareAll(clients, start.gameId, resultFor(2));
    expect(env.records[0]!.status).toBe('contested');
  });

  it('un joueur parti du relais n’est pas attendu ; son départ est transmis', () => {
    const { env, clients, start, relayClients } = play(3);
    relayClients[2]!.disconnect();
    declareAll(clients.slice(0, 2), start.gameId, resultFor(3));
    expect(env.records[0]!.status).toBe('agreed');
    expect(env.records[0]!.players[2]!.leftAtFrame).not.toBeNull();
    expect(env.records[0]!.players[0]!.leftAtFrame).toBeNull();
  });

  it('un joueur revenu au relais redevient attendu', () => {
    const { env, clients, start, relayClients, ids } = play(2);
    relayClients[1]!.disconnect();
    joinRelay(env, start, ids.slice(1));
    clients[0]!.send({ t: 'result', gameId: start.gameId, result: resultFor(2) });
    expect(env.records).toHaveLength(0);
    clients[1]!.send({ t: 'result', gameId: start.gameId, result: resultFor(2) });
    expect(env.records[0]!.players[1]!.leftAtFrame).toBeNull();
  });

  it('déclarations manquantes après 15 s : contesté', () => {
    const { env, clients, start } = play(2);
    clients[0]!.send({ t: 'result', gameId: start.gameId, result: resultFor(2) });
    env.advance(15_100);
    expect(env.records[0]!.status).toBe('contested');
  });

  it('déclaration d’un intrus, en double, mal formée ou pour un autre match : refusée', () => {
    const { env, clients, start } = play(2);
    const eve = env.client('eve');
    eve.send({ t: 'result', gameId: start.gameId, result: resultFor(2) });
    expect(eve.lastError()?.code).toBe('not_in_match');
    clients[0]!.send({ t: 'result', gameId: start.gameId, result: resultFor(3) });
    expect(clients[0]!.lastError()?.code).toBe('bad_request');
    clients[0]!.send({ t: 'result', gameId: 'autre', result: resultFor(2) });
    expect(clients[0]!.lastError()?.code).toBe('not_in_match');
    clients[0]!.send({ t: 'result', gameId: start.gameId, result: resultFor(2) });
    clients[0]!.send({ t: 'result', gameId: start.gameId, result: resultFor(2, 1) });
    expect(clients[0]!.lastError()?.code).toBe('bad_request');
    expect(env.records).toHaveLength(0);
  });

  it('tout le monde quitte la partie sans résultat : abandonné', () => {
    const { env, clients, relayClients } = play(2);
    for (const rc of relayClients) rc.disconnect();
    env.advance(31_000);
    expect(clients[0]!.last('matchEnd')!.end.status).toBe('abandoned');
    expect(env.records[0]!.status).toBe('abandoned');
  });

  it('un match qui dépasse sa durée maximale est abandonné', () => {
    const { env, clients } = play(2);
    // Stock 7 min par défaut : 20 s d'arrivée + 7 min + 5 min de marge.
    env.advance(20_000 + 7 * 60_000 + 5 * 60_000 + 1_000);
    expect(clients[0]!.last('matchEnd')!.end.status).toBe('abandoned');
  });

  it('quitter le salon pendant la partie ne l’arrête pas ; le salon vide disparaît à la fin', () => {
    const { env, clients, start } = play(2);
    for (const c of clients) c.send({ t: 'leaveRoom' });
    expect(env.lobby.stats().rooms).toBe(1);
    declareAll(clients, start.gameId, resultFor(2));
    expect(env.records[0]!.status).toBe('agreed');
    expect(env.lobby.stats().rooms).toBe(0);
  });

  it('un membre resté déconnecté pendant le match retrouve un délai de grâce entier', () => {
    const { env, clients, start } = play(3);
    clients[2]!.disconnect();
    env.advance(60_000);
    declareAll(clients.slice(0, 2), start.gameId, resultFor(3));
    env.advance(15_100);
    expect(clients[0]!.last('matchEnd')).toBeDefined();
    env.advance(20_000);
    expect(clients[0]!.room()!.members.map((m) => m.id)).toContain('carol');
    env.advance(11_000);
    expect(clients[0]!.room()!.members.map((m) => m.id)).not.toContain('carol');
  });
});

describe('service : partie rapide', () => {
  it('4 joueurs dans la file : salon rapide, lancement automatique, partie classée', () => {
    const env = setup();
    const clients = ['a', 'b', 'c', 'd'].map((id) => env.client(id));
    for (const c of clients) c.send({ t: 'queue', region: 'eu', fighter: 'random' });
    expect(clients[0]!.last('queued')).toMatchObject({ region: 'eu', waiting: 1 });
    env.advance(100);
    const room = clients[3]!.room()!;
    expect(room).toMatchObject({ kind: 'quick', code: null, host: null, phase: 'countdown' });
    expect(clients[0]!.last('countdown')?.seconds).toBe(5);
    env.advance(5_100);
    const start = clients[0]!.last('matchStart')!.match;
    expect(start.config).toMatchObject({ mode: 'stock', stocks: 3, timeLimit: 420, teams: false });
    expect(start.players.every((p) => p.fighter === 'vif' || p.fighter === 'lourd')).toBe(true);
    joinRelay(env, start, ['a', 'b', 'c', 'd']);
    for (const c of clients) c.send({ t: 'result', gameId: start.gameId, result: resultFor(4) });
    expect(env.records[0]).toMatchObject({
      ranked: true,
      kind: 'quick',
      region: 'eu',
      status: 'agreed',
    });
    // Revanche quand tous sont prêts, sans hôte.
    for (const c of clients) c.send({ t: 'setReady', ready: true });
    expect(clients[0]!.room()!.phase).toBe('countdown');
  });

  it('2 joueurs : partent ensemble après 20 s d’attente', () => {
    const env = setup();
    const a = env.client('a');
    const b = env.client('b');
    a.send({ t: 'queue', region: 'eu', fighter: 'vif' });
    b.send({ t: 'queue', region: 'eu', fighter: 'lourd' });
    env.advance(19_000);
    expect(a.room()).toBeUndefined();
    env.advance(1_100);
    expect(a.room()?.members.map((m) => m.fighter)).toEqual(['vif', 'lourd']);
  });

  it('refus : région inconnue, aller-retour trop long, déjà dans un salon, personnage inconnu', () => {
    const env = setup();
    const a = env.client('a');
    a.send({ t: 'queue', region: 'na', fighter: 'vif' });
    expect(a.lastError()?.code).toBe('invalid_region');
    a.send({ t: 'ping', time: 0, rtt: 300 });
    a.send({ t: 'queue', region: 'eu', fighter: 'vif' });
    expect(a.lastError()?.code).toBe('high_latency');
    a.send({ t: 'queue', region: 'eu', fighter: 'inconnu' });
    expect(a.lastError()?.code).toBe('invalid_fighter');
    const b = env.client('b');
    b.send({ t: 'createRoom' });
    b.send({ t: 'queue', region: 'eu', fighter: 'vif' });
    expect(b.lastError()?.code).toBe('already_in_room');
  });

  it('quitter la file, ou se déconnecter, en fait sortir', () => {
    const env = setup();
    const a = env.client('a');
    const b = env.client('b');
    a.send({ t: 'queue', region: 'eu', fighter: 'vif' });
    a.send({ t: 'leaveQueue' });
    expect(a.last('unqueued')).toBeDefined();
    b.send({ t: 'queue', region: 'eu', fighter: 'vif' });
    b.disconnect();
    expect(env.lobby.stats().queued).toBe(0);
  });
});
