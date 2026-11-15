/**
 * Mode réservé du relais (SPEC-lobby.md, « Relais authentifié ») : avec `authenticate`, seules
 * les parties réservées existent, et chaque compte reçoit la place que le lobby lui a réservée.
 */
import { describe, expect, it } from 'vitest';
import {
  ERR_AUTH,
  ERR_CLOSED,
  ERR_MISMATCH,
  ERR_TIMEOUT,
  MSG_ERROR,
  MSG_LEFT,
  MSG_REJOINED,
  MSG_START,
  MSG_WAITING,
} from '../src/protocol.ts';
import { createRelay } from '../src/server/relay.ts';
import { FakeClient, reservedSetup, testAuthenticate } from './relay-fake.ts';

describe('relais réservé : admission', () => {
  it('refuse un ticket absent ou invalide', () => {
    const { relay } = reservedSetup();
    relay.reserve('g1', { seats: ['alice', 'bob'], expiresInMs: 20_000 });
    const none = new FakeClient(relay);
    none.hello('g1', 2);
    expect(none.last(MSG_ERROR)!.code).toBe(ERR_AUTH);
    expect(none.closedWith).not.toBeNull();
    const bad = new FakeClient(relay);
    bad.hello('g1', 2, 'faux');
    expect(bad.last(MSG_ERROR)!.code).toBe(ERR_AUTH);
  });

  it('refuse une partie non réservée, même avec un ticket valide', () => {
    const { relay } = reservedSetup();
    const c = new FakeClient(relay);
    c.hello('libre', 2, 'ok:alice');
    expect(c.last(MSG_ERROR)!.code).toBe(ERR_AUTH);
    expect(relay.gameCount()).toBe(0);
  });

  it('refuse un compte qui n’a pas de place dans la partie', () => {
    const { relay } = reservedSetup();
    relay.reserve('g1', { seats: ['alice', 'bob'], expiresInMs: 20_000 });
    const eve = new FakeClient(relay);
    eve.hello('g1', 2, 'ok:eve');
    expect(eve.last(MSG_ERROR)!.code).toBe(ERR_AUTH);
  });

  it('refuse un nombre de joueurs ou de joueurs locaux différent de la réservation', () => {
    const { relay } = reservedSetup();
    relay.reserve('g1', { seats: ['alice', 'bob'], expiresInMs: 20_000 });
    const a = new FakeClient(relay);
    a.hello('g1', 3, 'ok:alice');
    expect(a.last(MSG_ERROR)!.code).toBe(ERR_MISMATCH);
    const b = new FakeClient(relay);
    b.hello('g1', 2, 'ok:bob', 2);
    expect(b.last(MSG_ERROR)!.code).toBe(ERR_MISMATCH);
  });

  it('donne à chacun sa place réservée, quel que soit l’ordre d’arrivée', () => {
    const { relay, events } = reservedSetup();
    relay.reserve('g1', { seats: ['alice', 'bob', 'carol'], expiresInMs: 20_000 });
    const carol = new FakeClient(relay);
    carol.hello('g1', 3, 'ok:carol');
    expect(carol.last(MSG_WAITING)).toMatchObject({ joined: 1, players: 3 });
    const alice = new FakeClient(relay);
    alice.hello('g1', 3, 'ok:alice');
    const bob = new FakeClient(relay);
    bob.hello('g1', 3, 'ok:bob');
    const slot = (c: FakeClient) => {
      const s = c.last(MSG_START)!;
      return Array.from(s.slots.subarray(0, s.slotCount));
    };
    expect(slot(alice)).toEqual([0]);
    expect(slot(bob)).toEqual([1]);
    expect(slot(carol)).toEqual([2]);
    expect(events).toEqual([{ type: 'started', gameId: 'g1' }]);
  });

  it('une seconde connexion du même compte remplace la première avant le départ', () => {
    const { relay } = reservedSetup();
    relay.reserve('g1', { seats: ['alice', 'bob'], expiresInMs: 20_000 });
    const first = new FakeClient(relay);
    first.hello('g1', 2, 'ok:alice');
    const second = new FakeClient(relay);
    second.hello('g1', 2, 'ok:alice');
    expect(first.last(MSG_ERROR)!.code).toBe(ERR_AUTH);
    expect(first.closedWith).not.toBeNull();
    expect(second.last(MSG_WAITING)).toMatchObject({ joined: 1 });
    const bob = new FakeClient(relay);
    bob.hello('g1', 2, 'ok:bob');
    expect(second.last(MSG_START)).toBeDefined();
    expect(first.last(MSG_START)).toBeUndefined();
  });

  it('garde la réservation quand le seul arrivé repart avant le départ', () => {
    const { relay } = reservedSetup();
    relay.reserve('g1', { seats: ['alice', 'bob'], expiresInMs: 20_000 });
    const a = new FakeClient(relay);
    a.hello('g1', 2, 'ok:alice');
    a.disconnect();
    expect(relay.gameCount()).toBe(1);
    const again = new FakeClient(relay);
    again.hello('g1', 2, 'ok:alice');
    const bob = new FakeClient(relay);
    bob.hello('g1', 2, 'ok:bob');
    expect(again.last(MSG_START)).toBeDefined();
  });
});

describe('relais réservé : réservations', () => {
  it('refuse une réservation en double, mal formée, ou sans authentification', () => {
    const { relay } = reservedSetup();
    expect(relay.reserve('g1', { seats: ['a', 'b'], expiresInMs: 1000 })).toBe(true);
    expect(relay.reserve('g1', { seats: ['a', 'b'], expiresInMs: 1000 })).toBe(false);
    expect(relay.reserve('g2', { seats: ['a'], expiresInMs: 1000 })).toBe(false);
    expect(relay.reserve('g3', { seats: ['a', 'a'], expiresInMs: 1000 })).toBe(false);
    expect(relay.reserve('mauvais id!', { seats: ['a', 'b'], expiresInMs: 1000 })).toBe(false);
    expect(
      relay.reserve('g4', {
        seats: Array(9)
          .fill('x')
          .map((x, i) => x + i),
        expiresInMs: 1,
      }),
    ).toBe(false);
    const open = createRelay({ now: () => 0 });
    expect(open.reserve('g1', { seats: ['a', 'b'], expiresInMs: 1000 })).toBe(false);
  });

  it('ferme une réservation expirée sans tous les joueurs et prévient les présents', () => {
    const { relay, events, advance } = reservedSetup();
    relay.reserve('g1', { seats: ['alice', 'bob'], expiresInMs: 20_000 });
    const a = new FakeClient(relay);
    a.hello('g1', 2, 'ok:alice');
    advance(19_000);
    expect(relay.gameCount()).toBe(1);
    advance(2_000);
    expect(relay.gameCount()).toBe(0);
    expect(a.last(MSG_ERROR)!.code).toBe(ERR_TIMEOUT);
    expect(events).toContainEqual({ type: 'closed', gameId: 'g1', reason: 'expired' });
  });

  it('l’échéance ne joue plus une fois la partie lancée', () => {
    const { relay, advance } = reservedSetup();
    relay.reserve('g1', { seats: ['alice', 'bob'], expiresInMs: 5_000 });
    new FakeClient(relay).hello('g1', 2, 'ok:alice');
    new FakeClient(relay).hello('g1', 2, 'ok:bob');
    advance(30_000);
    expect(relay.gameCount()).toBe(1);
  });

  it('annule une partie : erreur aux connectés, fermeture, événement', () => {
    const { relay, events } = reservedSetup();
    relay.reserve('g1', { seats: ['alice', 'bob'], expiresInMs: 20_000 });
    const a = new FakeClient(relay);
    a.hello('g1', 2, 'ok:alice');
    const b = new FakeClient(relay);
    b.hello('g1', 2, 'ok:bob');
    expect(relay.cancel('g1', 'fin du match')).toBe(true);
    for (const c of [a, b]) {
      expect(c.last(MSG_ERROR)).toMatchObject({ code: ERR_CLOSED, text: 'fin du match' });
      expect(c.closedWith).not.toBeNull();
    }
    expect(relay.gameCount()).toBe(0);
    expect(events).toContainEqual({ type: 'closed', gameId: 'g1', reason: 'cancelled' });
    expect(relay.cancel('g1', 'encore')).toBe(false);
  });

  it('annonce les départs en pleine partie et la fermeture quand tout le monde est parti', () => {
    const { relay, events, advance } = reservedSetup();
    relay.reserve('g1', { seats: ['alice', 'bob'], expiresInMs: 20_000 });
    const a = new FakeClient(relay);
    a.hello('g1', 2, 'ok:alice');
    const b = new FakeClient(relay);
    b.hello('g1', 2, 'ok:bob');
    advance(2_100);
    b.disconnect();
    expect(a.last(MSG_LEFT)!.slot).toBe(1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'left', gameId: 'g1', slot: 1 }));
    a.disconnect();
    // Une partie réservée vide attend encore 30 s un retour.
    advance(29_000);
    expect(relay.gameCount()).toBe(1);
    advance(2_000);
    expect(events).toContainEqual({ type: 'closed', gameId: 'g1', reason: 'empty' });
    expect(relay.gameCount()).toBe(0);
  });

  it('sans authenticate, le relais reste ouvert comme avant', () => {
    let t = 0;
    const relay = createRelay({ now: () => t });
    const a = new FakeClient(relay);
    a.hello('libre', 2);
    expect(a.last(MSG_WAITING)).toBeDefined();
    t += 1;
    expect(testAuthenticate('ok:x')).toEqual({ id: 'x' });
  });
});

describe('relais réservé : retour en pleine partie', () => {
  function running() {
    const env = reservedSetup();
    env.relay.reserve('g1', { seats: ['alice', 'bob'], expiresInMs: 20_000 });
    const a = new FakeClient(env.relay);
    a.hello('g1', 2, 'ok:alice');
    const b = new FakeClient(env.relay);
    b.hello('g1', 2, 'ok:bob');
    const startAt = a.last(MSG_START)!.startAt;
    env.advance(startAt - env.now() + 1000);
    return { ...env, a, b, startAt };
  }

  it('renvoie le START d’origine, annonce le retour et transmet l’historique depuis le début', () => {
    const { relay, a, b, startAt, advance, events } = running();
    b.disconnect();
    advance(500);
    const back = new FakeClient(relay);
    back.hello('g1', 2, 'ok:bob');
    const start = back.last(MSG_START)!;
    expect(start.startAt).toBe(startAt);
    expect(Array.from(start.slots.subarray(0, start.slotCount))).toEqual([1]);
    const rejoined = a.last(MSG_REJOINED)!;
    expect(rejoined.slot).toBe(1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'rejoined', slot: 1 }));
    advance(4);
    // Le revenant reçoit les inputs confirmés de tous depuis la frame D = 2.
    expect(back.inputsOf(0).has(2)).toBe(true);
    expect(back.inputsOf(1).has(2)).toBe(true);
    // Ses inputs comptent à partir de la frame annoncée.
    back.input(2, 1, rejoined.frame, [7]);
    advance(4);
    expect(a.inputsOf(1).get(rejoined.frame)).toBe(7);
  });

  it('une seconde connexion du même compte en pleine partie remplace la première', () => {
    const { relay, a, b } = running();
    const again = new FakeClient(relay);
    again.hello('g1', 2, 'ok:bob');
    expect(b.last(MSG_ERROR)!.code).toBe(ERR_AUTH);
    expect(a.last(MSG_LEFT)!.slot).toBe(1);
    expect(a.last(MSG_REJOINED)!.slot).toBe(1);
    expect(again.last(MSG_START)).toBeDefined();
  });

  it('refuse le retour dans une partie fermée', () => {
    const { relay, a, b } = running();
    relay.cancel('g1', 'fin du match');
    const late = new FakeClient(relay);
    late.hello('g1', 2, 'ok:bob');
    expect(late.last(MSG_ERROR)!.code).toBe(ERR_AUTH);
    expect(a.closedWith).not.toBeNull();
    expect(b.closedWith).not.toBeNull();
  });

  it('le dernier connecté qui recharge sa page retrouve la partie', () => {
    const { relay, b } = running();
    b.disconnect();
    const again = new FakeClient(relay);
    again.hello('g1', 2, 'ok:alice');
    expect(again.last(MSG_START)).toBeDefined();
    expect(relay.gameCount()).toBe(1);
  });

  it('refuse le retour dans une partie annulée, avec ERR_CLOSED pour une connexion déjà admise', () => {
    const { relay, a } = running();
    relay.cancel('g1', 'fin');
    expect(a.last(MSG_ERROR)!.code).toBe(ERR_CLOSED);
  });
});
