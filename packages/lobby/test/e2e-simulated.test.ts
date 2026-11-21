/**
 * Bout en bout simulé (SPEC-lobby.md, critères n° 4 et 5) : des joueurs complets passent par le
 * salon, jouent un match réel jusqu'à sa fin sur le relais, reçoivent le même résultat et
 * reviennent au salon ; avec coupures, rechargement en pleine partie, hôte parti, absent.
 */
import { describe, expect, it } from 'vitest';
import { declaredResult } from '../src/client.ts';
import { SHORT_RULES, createWorld, replayResult, type Player, type World } from './harness.ts';

const MATCH_MS = 30_000 + 2_000 + 3_000;

async function privateRoom(world: World, ids: string[]): Promise<Player[]> {
  const players = ids.map((id) => world.player(id));
  await world.until(
    () => players.every((p) => p.lobby.state.status === 'online'),
    2_000,
    'connexion',
  );
  const [host, ...others] = players;
  host!.lobby.createRoom();
  await world.until(() => host!.lobby.state.room !== null, 1_000, 'salon créé');
  const code = host!.lobby.state.room!.code!;
  for (const p of others) p.lobby.joinRoom(code);
  await world.until(() => host!.lobby.state.room!.members.length === ids.length, 2_000, 'arrivées');
  host!.lobby.setRules({ rules: SHORT_RULES, stage: 'arene-test' });
  for (const p of players) p.lobby.setFighter('random');
  await world.run(200);
  for (const p of others) p.lobby.setReady(true);
  await world.until(
    () => host!.lobby.state.room!.members.every((m) => m.id === host!.id || m.ready),
    2_000,
    'tous prêts',
  );
  return players;
}

async function launchAndPlay(world: World, players: Player[], matches: number): Promise<void> {
  players[0]!.lobby.start();
  await world.until(
    () => world.records.length >= matches,
    MATCH_MS + 30_000,
    `fin du match ${matches}`,
  );
  await world.until(
    () =>
      players.every((p) => p.lobby.state.room?.phase === 'lobby' && p.lobby.state.match === null),
    5_000,
    'retour au salon',
  );
}

async function expectAgreed(world: World, players: Player[], index: number): Promise<void> {
  const record = world.records[index]!;
  // L'enregistrement part avant que `matchEnd` atteigne les clients (latence) : on l'attend.
  await world.until(
    () => players.every((p) => p.lobby.state.lastEnd?.gameId === record.gameId),
    2_000,
    'fin reçue par tous',
  );
  expect(record.status).toBe('agreed');
  const results = players
    .filter((p) => p.results[index] !== undefined)
    .map((p) => JSON.stringify(declaredResult(p.results[index]!)));
  expect(new Set(results).size).toBe(1);
  for (const p of players) {
    expect(p.lobby.state.lastEnd?.status).toBe('agreed');
    expect(JSON.stringify(p.lobby.state.lastEnd?.result)).toBe(results[0]);
  }
}

describe('bout en bout simulé', () => {
  it('salon privé à 8 : match jusqu’à la fin, même résultat, retour au salon, revanche', async () => {
    const world = createWorld({ seed: 1 });
    const ids = ['alice', 'bob', 'carol', 'dave', 'erin', 'fred', 'gina', 'hugo'];
    const players = await privateRoom(world, ids);
    let start = null as null | Parameters<typeof replayResult>[1];
    players[1]!.lobby.onMatchStart((m) => (start ??= m));
    await launchAndPlay(world, players, 1);
    await expectAgreed(world, players, 0);
    const record = world.records[0]!;
    expect(record.players.map((p) => p.accountId)).toEqual(start!.players.map((p) => p.id));
    expect(new Set(record.players.map((p) => p.accountId))).toEqual(new Set(ids));
    expect(record.ranked).toBe(false);
    expect(record.config).toMatchObject({ mode: 'time', timeLimit: 30 });
    // Le résultat accepté est celui de la rejoue hors ligne du journal du relais.
    const seed = players[1]!.game!.net.match!.seed;
    const replayed = replayResult(world.relay, start!, seed)!;
    expect(record.winners).toEqual(replayed.winners);
    expect(record.players.map((p) => p.result)).toEqual(declaredResult(replayed).players);
    // Revanche dans le même salon.
    for (const p of players.slice(1)) p.lobby.setReady(true);
    await world.run(300);
    await launchAndPlay(world, players, 2);
    await expectAgreed(world, players, 1);
    expect(world.records[1]!.gameId).not.toBe(record.gameId);
    expect(world.relay.gameCount()).toBe(0);
  }, 120_000);

  it('partie rapide à 4 : file, salon rapide, match classé', async () => {
    const world = createWorld({ seed: 2, quickRules: SHORT_RULES });
    const players = ['q1', 'q2', 'q3', 'q4'].map((id) => world.player(id));
    await world.until(
      () => players.every((p) => p.lobby.state.status === 'online'),
      2_000,
      'connexion',
    );
    for (const p of players) p.lobby.queue('eu', 'random');
    await world.until(() => world.records.length === 1, MATCH_MS + 30_000, 'fin du match');
    expect(world.records[0]).toMatchObject({ ranked: true, kind: 'quick', region: 'eu' });
    await expectAgreed(world, players, 0);
    expect(players[0]!.lobby.state.room).toMatchObject({ kind: 'quick', code: null });
  }, 120_000);

  it('page rechargée en pleine partie : le joueur revient, rattrape, et le résultat concorde', async () => {
    const world = createWorld({ seed: 3 });
    const players = await privateRoom(world, ['alice', 'bob', 'carol']);
    players[0]!.lobby.start();
    await world.until(() => players[2]!.game?.net.status === 'running', 10_000, 'partie lancée');
    await world.run(12_000);
    players[2]!.reload();
    await world.run(1_000);
    await world.until(
      () => players[2]!.game?.net.status === 'running',
      10_000,
      'retour dans la partie',
    );
    await world.until(() => world.records.length === 1, MATCH_MS + 30_000, 'fin du match');
    await expectAgreed(world, players, 0);
    expect(world.records[0]!.players.find((p) => p.accountId === 'carol')!.leftAtFrame).toBeNull();
    expect(players[2]!.results).toHaveLength(1);
  }, 120_000);

  it('membre coupé 10 s dans le salon : il revient seul ; l’hôte qui part est remplacé', async () => {
    const world = createWorld({ seed: 4 });
    const players = await privateRoom(world, ['alice', 'bob', 'carol']);
    players[1]!.dropLobby();
    await world.run(300);
    expect(players[0]!.lobby.state.room!.members.find((m) => m.id === 'bob')!.connected).toBe(
      false,
    );
    await world.until(
      () => players[0]!.lobby.state.room!.members.find((m) => m.id === 'bob')!.connected,
      10_000,
      'retour',
    );
    players[0]!.lobby.leaveRoom();
    // L'hôte passe au plus ancien membre restant (ordre d'arrivée).
    await world.until(
      () => {
        const room = players[1]!.lobby.state.room;
        return room !== null && room.host !== 'alice' && room.host === room.members[0]!.id;
      },
      2_000,
      'nouvel hôte',
    );
    expect(players[0]!.lobby.state.room).toBeNull();
  }, 60_000);

  it('un joueur qui ne rejoint jamais le relais annule le lancement', async () => {
    const world = createWorld({ seed: 5 });
    const players = await privateRoom(world, ['alice', 'bob']);
    players[1]!.skipNextMatch = true;
    players[0]!.lobby.start();
    await world.until(() => players[0]!.lobby.state.lastEnd !== null, 30_000, 'annulation');
    expect(players[0]!.lobby.state.lastEnd!.status).toBe('cancelled');
    expect(players[0]!.lobby.state.room!.phase).toBe('lobby');
    expect(world.records).toEqual([]);
  }, 60_000);

  it('tout le monde quitte la partie : match abandonné et signalé', async () => {
    const world = createWorld({ seed: 6 });
    const players = await privateRoom(world, ['alice', 'bob']);
    players[0]!.lobby.start();
    await world.until(
      () => players.every((p) => p.game?.net.status === 'running'),
      10_000,
      'partie lancée',
    );
    for (const p of players) p.quitMatch();
    await world.until(() => players[0]!.lobby.state.lastEnd !== null, 40_000, 'abandon');
    expect(world.records[0]!.status).toBe('abandoned');
    expect(players[0]!.lobby.state.lastEnd!.status).toBe('abandoned');
  }, 60_000);

  it('un joueur parti en cours de match : les autres finissent, son départ est transmis', async () => {
    const world = createWorld({ seed: 7 });
    const players = await privateRoom(world, ['alice', 'bob', 'carol']);
    players[0]!.lobby.start();
    await world.until(
      () => players.every((p) => p.game?.net.status === 'running'),
      10_000,
      'partie lancée',
    );
    await world.run(5_000);
    players[1]!.quitMatch();
    await world.until(() => world.records.length === 1, MATCH_MS + 30_000, 'fin du match');
    expect(world.records[0]!.status).toBe('agreed');
    expect(
      world.records[0]!.players.find((p) => p.accountId === 'bob')!.leftAtFrame,
    ).toBeGreaterThan(0);
  }, 120_000);
});
