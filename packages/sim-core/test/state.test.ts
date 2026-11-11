import { describe, expect, it } from 'vitest';
import { rngNext, rngRange, rngSeed } from '../src/rng.ts';
import {
  ENTITY_FIELDS,
  FIGHTER_FIELDS,
  GLOBAL_COUNT,
  MAX_ENTITIES,
  MAX_PLAYERS,
  STATE_BYTES,
  checksumState,
  createState,
  loadInto,
  saveFrom,
} from '../src/state.ts';

/** Remplit chaque cellule d'une valeur distincte. */
function fillDistinct(s: ReturnType<typeof createState>): void {
  for (let w = 0; w < s.words.length; w++) s.words[w] = w + 1;
}

describe('disposition mémoire', () => {
  it('tient dans un seul tampon de moins de 64 Ko', () => {
    const s = createState();
    expect(s.buffer.byteLength).toBe(STATE_BYTES);
    expect(STATE_BYTES).toBeLessThan(64 * 1024);
    expect(STATE_BYTES).toBe(
      4 *
        (GLOBAL_COUNT +
          FIGHTER_FIELDS.length * MAX_PLAYERS +
          ENTITY_FIELDS.length * MAX_ENTITIES),
    );
  });

  it('donne à chaque champ sa propre zone, sans recouvrement', () => {
    const s = createState();
    const views = [
      s.g,
      ...FIGHTER_FIELDS.map((f) => s[f]),
      ...ENTITY_FIELDS.map((f) => s[f]),
    ];
    let n = 0;
    for (const v of views) for (let i = 0; i < v.length; i++) v[i] = ++n;
    n = 0;
    for (const v of views) for (let i = 0; i < v.length; i++) expect(v[i]).toBe(++n);
    expect(n).toBe(STATE_BYTES / 4);
  });

  it('dimensionne les champs par joueur et par entité', () => {
    const s = createState();
    expect(s.posX.length).toBe(MAX_PLAYERS);
    expect(s.ePosX.length).toBe(MAX_ENTITIES);
    expect(MAX_PLAYERS).toBe(8);
    expect(MAX_ENTITIES).toBe(32);
  });
});

describe('snapshot', () => {
  it('restaure exactement un état sauvegardé', () => {
    const s = createState();
    fillDistinct(s);
    const snap = new Uint8Array(STATE_BYTES);
    saveFrom(s, snap);
    const before = checksumState(s);

    s.posX[3] = -42;
    s.g[0] = 999;
    expect(checksumState(s)).not.toBe(before);

    loadInto(s, snap);
    expect(checksumState(s)).toBe(before);
    expect(s.posX[3]).not.toBe(-42);
  });

  it('ne partage pas de mémoire avec le snapshot', () => {
    const s = createState();
    const snap = new Uint8Array(STATE_BYTES);
    saveFrom(s, snap);
    s.velY[0] = 7;
    expect(snap.every((b) => b === 0)).toBe(true);
  });
});

describe('checksum', () => {
  it('est identique pour deux états identiques', () => {
    const a = createState();
    const b = createState();
    fillDistinct(a);
    fillDistinct(b);
    expect(checksumState(a)).toBe(checksumState(b));
  });

  it('change dès qu’un seul octet change, où qu’il soit', () => {
    const s = createState();
    fillDistinct(s);
    const ref = checksumState(s);
    for (const at of [0, 1, STATE_BYTES >> 1, STATE_BYTES - 1]) {
      s.bytes[at]! ^= 1;
      expect(checksumState(s)).not.toBe(ref);
      s.bytes[at]! ^= 1;
    }
    expect(checksumState(s)).toBe(ref);
  });

  it('est un entier non signé sur 32 bits', () => {
    const s = createState();
    fillDistinct(s);
    const c = checksumState(s);
    expect(Number.isInteger(c)).toBe(true);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThan(2 ** 32);
  });
});

describe('aléatoire', () => {
  it('suit la séquence xorshift32 de référence', () => {
    const s = createState();
    rngSeed(s, 1);
    expect(rngNext(s)).toBe(270369);
    expect(rngNext(s)).toBe(67634689);
  });

  it('accepte une graine nulle', () => {
    const s = createState();
    rngSeed(s, 0);
    const a = rngNext(s);
    expect(a).not.toBe(0);
    expect(rngNext(s)).not.toBe(a);
  });

  it('vit dans l’état : un snapshot rejoue le même tirage', () => {
    const s = createState();
    rngSeed(s, 12345);
    rngNext(s);
    const snap = new Uint8Array(STATE_BYTES);
    saveFrom(s, snap);
    const first = [rngNext(s), rngNext(s), rngNext(s)];
    loadInto(s, snap);
    expect([rngNext(s), rngNext(s), rngNext(s)]).toEqual(first);
  });

  it('tire un entier dans [0, n)', () => {
    const s = createState();
    rngSeed(s, 7);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = rngRange(s, 6);
      expect(Number.isInteger(v) && v >= 0 && v < 6).toBe(true);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });
});
