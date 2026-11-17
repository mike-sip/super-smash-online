import { defaultMatchConfig } from '@game/match-rules';
import { describe, expect, it } from 'vitest';
import { rulesOf } from '../src/protocol.ts';
import {
  buildLaunch,
  canStart,
  createRoom,
  join,
  kick,
  leave,
  roomView,
  setConnected,
  setFighter,
  setReady,
  setRules,
  setTeam,
  type Room,
} from '../src/room.ts';

const CONTENT = { fighters: ['vif', 'lourd'], stages: ['arene', 'falaise'] };
const STOCK = rulesOf(defaultMatchConfig('stock', 2));

function who(id: string) {
  return { id, name: id.toUpperCase(), guest: id.startsWith('g') };
}

function privateRoom(...ids: string[]): Room {
  const room = createRoom({
    code: 'ABCDEF',
    kind: 'private',
    region: 'eu',
    capacity: 8,
    rules: STOCK,
    stage: 'arene',
  });
  for (const id of ids) expect(join(room, who(id))).toEqual({ ok: true });
  return room;
}

/** Salon prêt à lancer : chacun a un personnage, les non-hôtes sont prêts. */
function readyRoom(...ids: string[]): Room {
  const room = privateRoom(...ids);
  for (const id of ids) {
    setFighter(room, id, 'vif', CONTENT);
    if (id !== room.host) setReady(room, id, true);
  }
  return room;
}

describe('salon : arrivée et départ', () => {
  it('le créateur est l’hôte ; l’ordre d’arrivée est gardé', () => {
    const room = privateRoom('alice', 'bob', 'carol');
    expect(room.host).toBe('alice');
    expect([...room.members.keys()]).toEqual(['alice', 'bob', 'carol']);
  });

  it('refuse au-delà de la capacité, salon verrouillé, expulsé, déjà membre, en partie', () => {
    const room = privateRoom('alice', 'bob');
    room.capacity = 2;
    expect(join(room, who('carol'))).toMatchObject({ ok: false, code: 'full' });
    room.capacity = 8;
    room.locked = true;
    expect(join(room, who('carol'))).toMatchObject({ ok: false, code: 'locked' });
    room.locked = false;
    kick(room, 'alice', 'bob');
    expect(join(room, who('bob'))).toMatchObject({ ok: false, code: 'banned' });
    expect(join(room, who('alice'))).toMatchObject({ ok: false, code: 'already_in_room' });
    room.phase = 'playing';
    expect(join(room, who('dave'))).toMatchObject({ ok: false, code: 'wrong_phase' });
  });

  it('place chaque arrivant dans l’équipe la moins remplie', () => {
    const room = privateRoom('a', 'b', 'c', 'd', 'e');
    expect([...room.members.values()].map((m) => m.team)).toEqual([0, 1, 2, 3, 0]);
  });

  it('l’hôte qui part passe la main au plus ancien membre connecté', () => {
    const room = privateRoom('alice', 'bob', 'carol');
    setConnected(room, 'bob', false, 10);
    expect(leave(room, 'alice')).toEqual({ hostChanged: true, empty: false });
    expect(room.host).toBe('carol');
    expect(leave(room, 'bob')).toEqual({ hostChanged: false, empty: false });
    expect(leave(room, 'carol')).toEqual({ hostChanged: true, empty: true });
    expect(room.host).toBeNull();
  });

  it('sans membre connecté, l’hôte passe au plus ancien membre', () => {
    const room = privateRoom('alice', 'bob', 'carol');
    setConnected(room, 'bob', false, 10);
    setConnected(room, 'carol', false, 10);
    leave(room, 'alice');
    expect(room.host).toBe('bob');
  });

  it('un salon rapide n’a pas d’hôte', () => {
    const room = createRoom({
      code: null,
      kind: 'quick',
      region: 'eu',
      capacity: 4,
      rules: STOCK,
      stage: 'random',
    });
    join(room, who('a'));
    join(room, who('b'));
    expect(room.host).toBeNull();
    expect(leave(room, 'a').hostChanged).toBe(false);
  });
});

describe('salon : sélection', () => {
  it('personnage de la liste ou au hasard ; refus sinon', () => {
    const room = privateRoom('alice');
    expect(setFighter(room, 'alice', 'lourd', CONTENT)).toEqual({ ok: true });
    expect(setFighter(room, 'alice', 'random', CONTENT)).toEqual({ ok: true });
    expect(setFighter(room, 'alice', 'inconnu', CONTENT)).toMatchObject({
      ok: false,
      code: 'invalid_fighter',
    });
    expect(room.members.get('alice')!.fighter).toBe('random');
    expect(setFighter(room, 'nobody', 'vif', CONTENT)).toMatchObject({ code: 'not_in_room' });
  });

  it('équipe de 0 à 3 ; changer de personnage ou d’équipe garde l’état prêt', () => {
    const room = privateRoom('alice', 'bob');
    setReady(room, 'bob', true);
    expect(setTeam(room, 'bob', 3)).toEqual({ ok: true });
    setFighter(room, 'bob', 'vif', CONTENT);
    expect(room.members.get('bob')!).toMatchObject({ team: 3, ready: true });
  });

  it('prêt seulement dans le salon, pas en partie', () => {
    const room = privateRoom('alice', 'bob');
    room.phase = 'playing';
    expect(setReady(room, 'bob', true)).toMatchObject({ ok: false, code: 'wrong_phase' });
  });
});

describe('salon : réglages de l’hôte', () => {
  it('seul l’hôte règle ; règles et stage remettent les « prêt » à zéro', () => {
    const room = privateRoom('alice', 'bob');
    setReady(room, 'bob', true);
    expect(setRules(room, 'bob', { locked: true }, CONTENT)).toMatchObject({ code: 'not_host' });
    expect(setRules(room, 'alice', { locked: true, capacity: 4 }, CONTENT)).toEqual({ ok: true });
    expect(room.members.get('bob')!.ready).toBe(true);
    const time = rulesOf(defaultMatchConfig('time', 2));
    expect(setRules(room, 'alice', { rules: time, stage: 'falaise' }, CONTENT)).toEqual({
      ok: true,
    });
    expect(room.members.get('bob')!.ready).toBe(false);
    expect(room).toMatchObject({ rules: time, stage: 'falaise', locked: true, capacity: 4 });
  });

  it('refuse des règles invalides avec les messages de match-rules', () => {
    const room = privateRoom('alice', 'bob');
    const outcome = setRules(
      room,
      'alice',
      { rules: { ...STOCK, mode: 'time', timeLimit: 0 } },
      CONTENT,
    );
    expect(outcome).toMatchObject({ ok: false, code: 'invalid_rules' });
    expect(outcome.ok ? '' : outcome.message.length).toBeGreaterThan(0);
    expect(room.rules).toEqual(STOCK);
  });

  it('refuse un stage inconnu, une capacité sous le nombre de membres, hors salon', () => {
    const room = privateRoom('alice', 'bob', 'carol');
    expect(setRules(room, 'alice', { stage: 'lune' }, CONTENT)).toMatchObject({
      code: 'invalid_stage',
    });
    expect(setRules(room, 'alice', { stage: 'random' }, CONTENT)).toEqual({ ok: true });
    expect(setRules(room, 'alice', { capacity: 2 }, CONTENT)).toMatchObject({
      code: 'bad_request',
    });
    room.phase = 'countdown';
    expect(setRules(room, 'alice', { locked: true }, CONTENT)).toMatchObject({
      code: 'wrong_phase',
    });
  });

  it('expulsion : hôte seulement, hors partie, jamais soi-même', () => {
    const room = privateRoom('alice', 'bob', 'carol');
    expect(kick(room, 'bob', 'carol')).toMatchObject({ code: 'not_host' });
    expect(kick(room, 'alice', 'alice')).toMatchObject({ code: 'bad_request' });
    expect(kick(room, 'alice', 'zed')).toMatchObject({ code: 'bad_request' });
    room.phase = 'playing';
    expect(kick(room, 'alice', 'bob')).toMatchObject({ code: 'wrong_phase' });
    room.phase = 'lobby';
    expect(kick(room, 'alice', 'bob')).toEqual({ ok: true });
    expect(room.members.has('bob')).toBe(false);
    expect(room.banned.has('bob')).toBe(true);
  });
});

describe('salon : lancement', () => {
  it('lançable par l’hôte à 2 membres prêts avec un personnage', () => {
    expect(canStart(readyRoom('alice', 'bob'), 'alice')).toEqual({ ok: true });
  });

  it('refuse : pas l’hôte, seul, personnage manquant, pas prêt, déconnecté, hors salon', () => {
    const room = readyRoom('alice', 'bob');
    expect(canStart(room, 'bob')).toMatchObject({ code: 'not_host' });
    expect(canStart(readyRoom('alice'), 'alice')).toMatchObject({ code: 'not_ready' });
    const noFighter = privateRoom('alice', 'bob');
    setReady(noFighter, 'bob', true);
    setFighter(noFighter, 'alice', 'vif', CONTENT);
    expect(canStart(noFighter, 'alice')).toMatchObject({ code: 'not_ready' });
    setReady(room, 'bob', false);
    expect(canStart(room, 'alice')).toMatchObject({ code: 'not_ready' });
    setReady(room, 'bob', true);
    setConnected(room, 'bob', false, 5);
    expect(canStart(room, 'alice')).toMatchObject({ code: 'not_ready' });
    setConnected(room, 'bob', true, 6);
    room.phase = 'playing';
    expect(canStart(room, 'alice')).toMatchObject({ code: 'wrong_phase' });
  });

  it('en équipes, il faut au moins deux équipes représentées', () => {
    const room = readyRoom('alice', 'bob');
    setRules(room, 'alice', { rules: { ...STOCK, teams: true } }, CONTENT);
    setReady(room, 'bob', true);
    setTeam(room, 'alice', 1);
    setTeam(room, 'bob', 1);
    expect(canStart(room, 'alice')).toMatchObject({ code: 'invalid_rules' });
    setTeam(room, 'bob', 2);
    expect(canStart(room, 'alice')).toEqual({ ok: true });
  });

  it('un salon rapide part quand tous sont prêts, sans hôte', () => {
    const room = createRoom({
      code: null,
      kind: 'quick',
      region: 'eu',
      capacity: 4,
      rules: STOCK,
      stage: 'random',
    });
    for (const id of ['a', 'b']) {
      join(room, who(id));
      setFighter(room, id, 'vif', CONTENT);
    }
    expect(canStart(room, null)).toMatchObject({ code: 'not_ready' });
    setReady(room, 'a', true);
    setReady(room, 'b', true);
    expect(canStart(room, null)).toEqual({ ok: true });
  });

  it('construit la configuration finale : places, équipes, tirage des « au hasard »', () => {
    const room = readyRoom('alice', 'bob', 'carol');
    setFighter(room, 'carol', 'random', CONTENT);
    setRules(room, 'alice', { stage: 'random', rules: { ...STOCK, teams: true } }, CONTENT);
    setTeam(room, 'alice', 1);
    const picks = [1, 0];
    const launch = buildLaunch(room, CONTENT, (max) => picks.shift()! % max);
    expect(launch.config.players).toEqual([{ team: 1 }, { team: 1 }, { team: 2 }]);
    expect(launch.config.teams).toBe(true);
    expect(launch.players.map((p) => p.id)).toEqual(['alice', 'bob', 'carol']);
    expect(launch.players[2]!.fighter).toBe('lourd');
    expect(launch.stage).toBe('arene');
    expect(launch.players[0]).toEqual({ id: 'alice', name: 'ALICE', guest: false, fighter: 'vif' });
  });

  it('l’instantané reprend l’état du salon', () => {
    const room = readyRoom('alice', 'gus');
    setConnected(room, 'gus', false, 3);
    room.members.get('alice')!.rttMs = 42;
    const view = roomView(room);
    expect(view).toMatchObject({ code: 'ABCDEF', kind: 'private', phase: 'lobby', host: 'alice' });
    expect(view.members[1]).toEqual({
      id: 'gus',
      name: 'GUS',
      guest: true,
      fighter: 'vif',
      team: 1,
      ready: true,
      connected: false,
      rttMs: null,
    });
    expect(view.members[0]!.rttMs).toBe(42);
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});
