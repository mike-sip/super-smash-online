import { defaultMatchConfig } from '@game/match-rules';
import { describe, expect, it } from 'vitest';
import {
  MAX_MESSAGE_CHARS,
  parseClientMessage,
  parseServerMessage,
  rulesOf,
  type ClientMessage,
  type DeclaredResult,
} from '../src/protocol.ts';

const RULES = rulesOf(defaultMatchConfig('stock', 2));

function playerResult(placement: number) {
  return {
    team: 0,
    placement,
    kos: 1,
    falls: 2,
    selfDestructs: 0,
    score: -1,
    damageDealt: 120,
    damageTaken: 90,
    stocksLeft: 0,
    ultimatesUsed: 0,
    eliminatedAt: 900,
  };
}

export const RESULT: DeclaredResult = {
  endFrame: 1800,
  reason: 'time',
  winners: [1],
  winningTeam: null,
  players: [playerResult(2), { ...playerResult(1), eliminatedAt: -1 }],
};

const VALID: ClientMessage[] = [
  { t: 'hello', version: 1, ticket: 'v1.abc.def' },
  { t: 'ping', time: 1234.5 },
  { t: 'createRoom' },
  { t: 'createRoom', capacity: 4 },
  { t: 'joinRoom', code: 'abc-def' },
  { t: 'leaveRoom' },
  { t: 'setFighter', fighter: 'random' },
  { t: 'setTeam', team: 3 },
  { t: 'setReady', ready: true },
  { t: 'setRules', rules: RULES, stage: 'arene', capacity: 8, locked: true },
  { t: 'setRules', locked: false },
  { t: 'kick', player: '6f1c2c9e-1b7a-4c1e-9a55-0d4c3b2a1f00' },
  { t: 'start' },
  { t: 'queue', region: 'eu', fighter: 'mannequin' },
  { t: 'leaveQueue' },
  { t: 'result', gameId: 'g_123-abc', result: RESULT },
];

describe('protocole : messages des clients', () => {
  it('accepte chaque message bien formé, à l’identique', () => {
    for (const m of VALID) {
      const parsed = parseClientMessage(JSON.stringify(m));
      expect(parsed, JSON.stringify(m)).toEqual({ ok: true, message: m });
    }
  });

  it('refuse un champ inconnu, y compris __proto__', () => {
    expect(parseClientMessage('{"t":"leaveRoom","x":1}').ok).toBe(false);
    expect(parseClientMessage('{"t":"leaveRoom","__proto__":{"a":1}}').ok).toBe(false);
    const rules = { ...RULES, extra: true };
    expect(parseClientMessage(JSON.stringify({ t: 'setRules', rules })).ok).toBe(false);
    const result = { ...RESULT, players: [{ ...RESULT.players[0], hack: 1 }, RESULT.players[1]] };
    expect(parseClientMessage(JSON.stringify({ t: 'result', gameId: 'g', result })).ok).toBe(false);
  });

  it('refuse un type faux ou une borne dépassée', () => {
    const bad: unknown[] = [
      { t: 'nope' },
      { t: 'hello', version: '1', ticket: 'x' },
      { t: 'hello', version: 1, ticket: 'x'.repeat(1025) },
      { t: 'ping', time: 'x' },
      { t: 'createRoom', capacity: 1 },
      { t: 'createRoom', capacity: 9 },
      { t: 'createRoom', capacity: 2.5 },
      { t: 'joinRoom', code: 7 },
      { t: 'setFighter', fighter: 'Majuscule' },
      { t: 'setFighter', fighter: 'a'.repeat(33) },
      { t: 'setFighter', fighter: '<script>' },
      { t: 'setTeam', team: 4 },
      { t: 'setReady', ready: 'yes' },
      { t: 'setRules', rules: { ...RULES, mode: 'chaos' } },
      { t: 'setRules', rules: { ...RULES, items: { enabled: true, frequency: 'max' } } },
      { t: 'kick', player: '../../etc' },
      { t: 'queue', region: 'EU', fighter: 'x' },
      { t: 'queue', region: 'eu' },
      { t: 'result', gameId: 'g', result: { ...RESULT, winners: [5] } },
      { t: 'result', gameId: 'g', result: { ...RESULT, winners: [1, 1] } },
      { t: 'result', gameId: 'g', result: { ...RESULT, players: [RESULT.players[0]] } },
      { t: 'result', gameId: 'g', result: { ...RESULT, reason: 'surrender' } },
      { t: 'result', gameId: 'g', result: { ...RESULT, endFrame: -1 } },
      { t: 'result', gameId: 'g!', result: RESULT },
      [],
      null,
      42,
      'texte',
    ];
    for (const m of bad)
      expect(parseClientMessage(JSON.stringify(m)).ok, JSON.stringify(m)).toBe(false);
  });

  it('refuse un JSON invalide et un message trop gros', () => {
    expect(parseClientMessage('{')).toMatchObject({ ok: false, error: 'JSON invalide' });
    const big = JSON.stringify({ t: 'joinRoom', code: 'x', pad: ' '.repeat(MAX_MESSAGE_CHARS) });
    expect(parseClientMessage(big).ok).toBe(false);
    const padded = `{"t":"leaveRoom"}${' '.repeat(MAX_MESSAGE_CHARS)}`;
    expect(parseClientMessage(padded)).toMatchObject({ ok: false, error: 'message trop gros' });
    expect(parseClientMessage(' '.repeat(20_000))).toMatchObject({ ok: false });
    expect(parseClientMessage(undefined as unknown as string).ok).toBe(false);
  });

  it('10 000 entrées aléatoires ou tronquées : aucune exception', () => {
    let seed = 12345;
    const random = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const samples = VALID.map((m) => JSON.stringify(m));
    for (let i = 0; i < 10_000; i++) {
      const base = samples[random(samples.length)]!;
      let s: string;
      switch (random(3)) {
        case 0:
          s = base.slice(0, random(base.length + 1));
          break;
        case 1: {
          const chars = [...base];
          for (let k = 0; k < 3; k++)
            chars[random(chars.length)] = String.fromCharCode(random(128));
          s = chars.join('');
          break;
        }
        default:
          s = Array.from({ length: random(60) }, () => String.fromCharCode(random(256))).join('');
      }
      expect(() => parseClientMessage(s)).not.toThrow();
    }
  });
});

describe('protocole : messages du serveur', () => {
  it('lit les types connus et ignore le reste sans exception', () => {
    expect(parseServerMessage('{"t":"pong","time":1}')).toEqual({
      ok: true,
      message: { t: 'pong', time: 1 },
    });
    expect(parseServerMessage('{"t":"inconnu"}').ok).toBe(false);
    expect(parseServerMessage('nope').ok).toBe(false);
    expect(parseServerMessage(42).ok).toBe(false);
    expect(parseServerMessage('null').ok).toBe(false);
  });
});
