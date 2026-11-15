import { describe, expect, it } from 'vitest';
import { isWellFormedToken, newSessionToken, tokenDigest } from '../src/tokens.ts';

describe('jetons de session', () => {
  it('sont faits de 32 octets aléatoires en base64url', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => newSessionToken()));
    expect(tokens.size).toBe(100);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(isWellFormedToken(token)).toBe(true);
    }
  });

  it('ont une empreinte SHA-256 stable, différente du jeton', () => {
    const token = newSessionToken();
    expect(tokenDigest(token)).toBe(tokenDigest(token));
    expect(tokenDigest(token)).not.toBe(token);
    expect(tokenDigest(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenDigest(newSessionToken())).not.toBe(tokenDigest(token));
  });

  it("refusent ce qui n'a pas la forme d'un jeton", () => {
    for (const bad of ['', 'abc', 'a'.repeat(44), `${'a'.repeat(42)}!`, `${'a'.repeat(42)}=`]) {
      expect(isWellFormedToken(bad), bad).toBe(false);
    }
  });
});
