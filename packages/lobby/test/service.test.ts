/** Service du lobby : identité, connexions, salons, grâce, hôte, protections (T8). */
import { describe, expect, it } from 'vitest';
import { FakeClient, setup, ticketFor } from './fakes.ts';

describe('service : identité', () => {
  it('accueille un compte au ticket valide, avec le contenu et les régions', () => {
    const env = setup();
    const a = env.client('alice');
    expect(a.last('welcome')).toMatchObject({
      you: { id: 'alice', name: 'ALICE', guest: false },
      content: { fighters: ['vif', 'lourd'] },
      regions: ['eu'],
    });
  });

  it('refuse un ticket invalide, rejoué, une autre version, une action avant hello', () => {
    const env = setup();
    const bad = new FakeClient(env.lobby);
    bad.send({ t: 'hello', version: 1, ticket: 'nope' });
    expect(bad.lastError()?.code).toBe('ticket');
    expect(bad.closedWith).not.toBeNull();
    const first = new FakeClient(env.lobby).hello('alice', 'same-jti');
    expect(first.last('welcome')).toBeDefined();
    const replay = new FakeClient(env.lobby).hello('alice', 'same-jti');
    expect(replay.lastError()?.code).toBe('ticket');
    const old = new FakeClient(env.lobby);
    old.send({ t: 'hello', version: 99, ticket: ticketFor('bob') });
    expect(old.lastError()?.code).toBe('version');
    const rude = new FakeClient(env.lobby);
    rude.send({ t: 'createRoom' });
    expect(rude.lastError()?.code).toBe('unauthenticated');
    expect(rude.closedWith).not.toBeNull();
  });

  it('une nouvelle connexion du même compte remplace l’ancienne et retrouve son salon', () => {
    const env = setup();
    const a = env.client('alice');
    a.send({ t: 'createRoom' });
    const code = a.room()!.code;
    const again = env.client('alice');
    expect(a.last('bye')?.reason).toBe('replaced');
    expect(a.closedWith).toBe('replaced');
    expect(again.room()?.code).toBe(code);
    expect(again.room()!.members[0]!.connected).toBe(true);
  });

  it('ferme une connexion muette, ou qui ne se présente pas', () => {
    const env = setup({ limits: { silenceMs: 30_000 } });
    const silent = new FakeClient(env.lobby);
    env.advance(5_100);
    expect(silent.last('bye')?.reason).toBe('timeout');
    const a = env.client('alice');
    env.advance(29_000);
    a.send({ t: 'ping', time: 1 });
    env.advance(29_000);
    expect(a.closedWith).toBeNull();
    env.advance(2_000);
    expect(a.last('bye')?.reason).toBe('timeout');
  });

  it('répond aux pings et retient l’aller-retour déclaré', () => {
    const env = setup();
    const a = env.client('alice');
    a.send({ t: 'createRoom' });
    a.send({ t: 'ping', time: 12.5, rtt: 48 });
    expect(a.last('pong')).toEqual({ t: 'pong', time: 12.5 });
    a.send({ t: 'setReady', ready: false });
    expect(a.room()!.members[0]!.rttMs).toBe(48);
  });
});

describe('service : protections', () => {
  it('trois messages invalides de suite ferment la connexion', () => {
    const env = setup();
    const a = env.client('alice');
    a.raw('{');
    a.raw('{"t":"zzz"}');
    expect(a.closedWith).toBeNull();
    a.raw('[1]');
    expect(a.last('bye')?.reason).toBe('invalid');
  });

  it('limite le débit de messages', () => {
    const env = setup();
    const a = env.client('alice');
    for (let i = 0; i < 25; i++) a.send({ t: 'ping', time: i });
    expect(a.last('bye')?.reason).toBe('rate_limited');
  });

  it('limite les connexions par adresse', () => {
    const env = setup({ limits: { maxConnectionsPerAddress: 2 } });
    env.client('a', '1.1.1.1');
    env.client('b', '1.1.1.1');
    const c = env.client('c', '1.1.1.1');
    expect(c.last('bye')?.reason).toBe('rate_limited');
    expect(c.last('welcome')).toBeUndefined();
    expect(env.client('d', '2.2.2.2').last('welcome')).toBeDefined();
  });

  it('limite les codes faux par compte, sans dire si le code suivant existe', () => {
    const env = setup();
    const host = env.client('host', '9.9.9.9');
    host.send({ t: 'createRoom' });
    const code = host.room()!.code!;
    const guesser = env.client('eve', '8.8.8.8');
    for (let i = 0; i < 10; i++) guesser.send({ t: 'joinRoom', code: 'ZZZZZZ' });
    expect(guesser.lastError()?.code).toBe('not_found');
    guesser.send({ t: 'joinRoom', code });
    expect(guesser.lastError()?.code).toBe('rate_limited');
    env.advance(6_100);
    guesser.send({ t: 'joinRoom', code });
    expect(guesser.room()?.code).toBe(code);
  });

  it('limite aussi les codes faux par adresse, quel que soit le compte', () => {
    const env = setup({ limits: { maxConnectionsPerAddress: 20 } });
    for (let i = 0; i < 10; i++)
      env.client(`bot${i}`, '7.7.7.7').send({ t: 'joinRoom', code: 'ZZZZZZ' });
    const next = env.client('bot99', '7.7.7.7');
    next.send({ t: 'joinRoom', code: 'ZZZZZZ' });
    expect(next.lastError()?.code).toBe('rate_limited');
  });

  it('limite les créations de salon', () => {
    const env = setup();
    const a = env.client('alice');
    for (let i = 0; i < 5; i++) {
      a.send({ t: 'createRoom' });
      a.send({ t: 'leaveRoom' });
    }
    a.send({ t: 'createRoom' });
    expect(a.lastError()?.code).toBe('rate_limited');
  });

  it('plafonne le nombre de salons', () => {
    const env = setup({ limits: { maxRooms: 1 } });
    env.client('a').send({ t: 'createRoom' });
    const b = env.client('b');
    b.send({ t: 'createRoom' });
    expect(b.lastError()?.code).toBe('server_full');
  });
});

describe('service : salons', () => {
  function room3() {
    const env = setup();
    const a = env.client('alice');
    a.send({ t: 'createRoom', capacity: 4 });
    const code = a.room()!.code!;
    const b = env.client('bob');
    b.send({ t: 'joinRoom', code: `${code.slice(0, 3).toLowerCase()}-${code.slice(3)}` });
    const c = env.client('carol');
    c.send({ t: 'joinRoom', code });
    return { env, a, b, c, code };
  }

  it('créer, rejoindre par code, voir les autres ; instantané envoyé à chacun', () => {
    const { a, b, c, code } = room3();
    for (const x of [a, b, c]) {
      expect(x.room()!.code).toBe(code);
      expect(x.room()!.members.map((m) => m.id)).toEqual(['alice', 'bob', 'carol']);
      expect(x.room()!.host).toBe('alice');
      expect(x.room()!.capacity).toBe(4);
    }
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
  });

  it('sélection, règles, verrou et expulsion', () => {
    const { env, a, b, c, code } = room3();
    b.send({ t: 'setFighter', fighter: 'lourd' });
    b.send({ t: 'setTeam', team: 2 });
    b.send({ t: 'setReady', ready: true });
    expect(a.room()!.members[1]).toMatchObject({ fighter: 'lourd', team: 2, ready: true });
    b.send({ t: 'setRules', locked: true });
    expect(b.lastError()?.code).toBe('not_host');
    a.send({ t: 'setRules', stage: 'falaise', locked: true });
    expect(c.room()).toMatchObject({ stage: 'falaise', locked: true });
    expect(c.room()!.members[1]!.ready).toBe(false);
    const d = env.client('dave');
    d.send({ t: 'joinRoom', code });
    expect(d.lastError()?.code).toBe('locked');
    a.send({ t: 'kick', player: 'carol' });
    expect(c.last('roomClosed')?.reason).toBe('kicked');
    expect(a.room()!.members.map((m) => m.id)).toEqual(['alice', 'bob']);
    a.send({ t: 'setRules', locked: false });
    c.send({ t: 'joinRoom', code });
    expect(c.lastError()?.code).toBe('banned');
  });

  it('un membre déconnecté garde sa place 30 s, puis la perd', () => {
    const { env, a, b } = room3();
    b.disconnect();
    expect(a.room()!.members[1]!.connected).toBe(false);
    env.advance(10_000);
    const back = env.client('bob');
    expect(back.room()!.members[1]).toMatchObject({ id: 'bob', connected: true });
    back.disconnect();
    env.advance(30_100);
    expect(a.room()!.members.map((m) => m.id)).toEqual(['alice', 'carol']);
  });

  it('l’hôte parti ou déconnecté passe la main', () => {
    const { env, a, b, c } = room3();
    a.send({ t: 'leaveRoom' });
    expect(a.last('roomClosed')?.reason).toBe('left');
    expect(b.room()!.host).toBe('bob');
    b.disconnect();
    env.advance(30_100);
    expect(c.room()!.host).toBe('carol');
  });

  it('un salon vide disparaît, son code ne sert plus', () => {
    const { env, a, b, c, code } = room3();
    for (const x of [a, b, c]) x.send({ t: 'leaveRoom' });
    expect(env.lobby.stats().rooms).toBe(0);
    const d = env.client('dave');
    d.send({ t: 'joinRoom', code });
    expect(d.lastError()?.code).toBe('not_found');
  });

  it('déjà dans un salon : pas de création ni d’arrivée ailleurs', () => {
    const { a } = room3();
    a.send({ t: 'createRoom' });
    expect(a.lastError()?.code).toBe('already_in_room');
  });

  it('une déconnexion pendant le compte à rebours l’annule', () => {
    const { env, a, b, c } = room3();
    for (const x of [a, b, c]) x.send({ t: 'setFighter', fighter: 'vif' });
    b.send({ t: 'setReady', ready: true });
    c.send({ t: 'setReady', ready: true });
    a.send({ t: 'start' });
    expect(a.last('countdown')?.seconds).toBe(3);
    expect(a.room()!.phase).toBe('countdown');
    c.disconnect();
    expect(a.room()!.phase).toBe('lobby');
    env.advance(4_000);
    expect(a.last('matchStart')).toBeUndefined();
  });
});

describe('service : codes faux et IPv6', () => {
  it('compte les essais d’un même bloc /64 ensemble', () => {
    const env = setup({ limits: { maxConnectionsPerAddress: 20 } });
    for (let i = 0; i < 10; i++) {
      env.client(`v6bot${i}`, `2001:db8:1:2::${i + 1}`).send({ t: 'joinRoom', code: 'ZZZZZZ' });
    }
    const next = env.client('v6bot99', '2001:db8:1:2:ffff::9');
    next.send({ t: 'joinRoom', code: 'ZZZZZZ' });
    expect(next.lastError()?.code).toBe('rate_limited');
    const elsewhere = env.client('v6other', '2001:db8:9:9::1');
    elsewhere.send({ t: 'joinRoom', code: 'ZZZZZZ' });
    expect(elsewhere.lastError()?.code).toBe('not_found');
  });
});
