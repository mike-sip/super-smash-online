import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TICKET_TTL_SECONDS, signTicket, verifyTicket } from '../src/ticket.ts';

const SECRET = 'une-cle-de-test-suffisamment-longue-0001';
const OTHER = 'une-autre-cle-de-test-suffisamment-longue';
const NOW = Date.UTC(2026, 10, 13, 12, 0, 0);
const IDENTITY = { sub: '0b6a5c1e-2f43-4c1a-9d1e-5b2a7f6e3c10', name: 'Élodie', guest: false };

function sign(aud = 'relay', secret = SECRET, now = NOW): string {
  return signTicket({ ...IDENTITY, aud }, { secret, now }).ticket;
}

/** Signe une charge arbitraire, pour fabriquer des tickets bien signés mais au contenu douteux. */
function forge(payload: unknown, secret = SECRET): string {
  const body = Buffer.from(JSON.stringify(payload) ?? 'undefined').toString('base64url');
  const signature = createHmac('sha256', secret).update(`v1.${body}`).digest('base64url');
  return `v1.${body}.${signature}`;
}

const OPTIONS = { secrets: [SECRET], audience: 'relay', now: NOW };

describe('tickets', () => {
  it('sont acceptés avec la bonne clé et la bonne audience', () => {
    const ticket = sign();
    expect(ticket).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    const result = verifyTicket(ticket, OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims).toMatchObject({ ...IDENTITY, aud: 'relay', iat: NOW / 1000 });
    expect(result.claims.exp).toBe(NOW / 1000 + TICKET_TTL_SECONDS);
    expect(result.claims.jti).toMatch(/^[A-Za-z0-9_-]{16,}$/);
  });

  it("durent 60 secondes, avec 5 secondes de tolérance d'horloge", () => {
    expect(TICKET_TTL_SECONDS).toBe(60);
    const ticket = sign();
    const at = (seconds: number) => verifyTicket(ticket, { ...OPTIONS, now: NOW + seconds * 1000 });
    expect(at(64).ok).toBe(true);
    expect(at(66)).toEqual({ ok: false, error: 'expired' });
    // Horloge du relais en retard sur celle des comptes.
    expect(at(-4).ok).toBe(true);
    expect(at(-30)).toEqual({ ok: false, error: 'malformed' });
  });

  it('sont refusés pour une autre audience', () => {
    expect(verifyTicket(sign('lobby'), OPTIONS)).toEqual({ ok: false, error: 'wrong_audience' });
  });

  it('sont refusés si la charge ou la signature est modifiée', () => {
    const [version, body, signature] = sign().split('.') as [string, string, string];
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as Record<string, unknown>;
    const tampered = Buffer.from(JSON.stringify({ ...claims, name: 'Admin' })).toString(
      'base64url',
    );
    expect(verifyTicket(`${version}.${tampered}.${signature}`, OPTIONS)).toEqual({
      ok: false,
      error: 'bad_signature',
    });
    const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    expect(verifyTicket(`${version}.${body}.${flipped}`, OPTIONS)).toEqual({
      ok: false,
      error: 'bad_signature',
    });
  });

  it("acceptent l'ancienne clé pendant une rotation, refusent une clé inconnue", () => {
    const old = sign('relay', OTHER);
    expect(verifyTicket(old, { ...OPTIONS, secrets: [SECRET, OTHER] }).ok).toBe(true);
    expect(verifyTicket(old, OPTIONS)).toEqual({ ok: false, error: 'bad_signature' });
    expect(verifyTicket(old, { ...OPTIONS, secrets: [] })).toEqual({
      ok: false,
      error: 'bad_signature',
    });
  });

  it('refusent sans erreur tout texte mal formé', () => {
    const valid = sign();
    for (const bad of [
      '',
      'abc',
      'v1..',
      'v2' + valid.slice(2),
      valid + '.x',
      valid.replace(/\.[^.]+$/, '.***'),
      'v1.' + 'a'.repeat(5000) + '.b',
    ]) {
      const result = verifyTicket(bad, OPTIONS);
      expect(result.ok, bad.slice(0, 40)).toBe(false);
    }
    // Ce qui n'est pas une chaîne, venu d'un JSON douteux côté relais.
    expect(verifyTicket(42 as unknown as string, OPTIONS)).toEqual({
      ok: false,
      error: 'malformed',
    });
  });

  it('refusent une charge bien signée mais incomplète ou mal typée', () => {
    const good = {
      ...IDENTITY,
      aud: 'relay',
      iat: NOW / 1000,
      exp: NOW / 1000 + 60,
      jti: 'abcdefghijklmnop',
    };
    expect(verifyTicket(forge(good), OPTIONS).ok).toBe(true);
    for (const payload of [
      null,
      [],
      'texte',
      { ...good, sub: 1 },
      { ...good, guest: 'non' },
      { ...good, exp: '9999999999' },
      { ...good, jti: undefined },
      { ...good, name: undefined },
    ]) {
      expect(verifyTicket(forge(payload), OPTIONS), JSON.stringify(payload)).toEqual({
        ok: false,
        error: 'malformed',
      });
    }
    // Pas du JSON du tout, mais bien signé.
    const body = Buffer.from('{pas du json').toString('base64url');
    const signature = createHmac('sha256', SECRET).update(`v1.${body}`).digest('base64url');
    expect(verifyTicket(`v1.${body}.${signature}`, OPTIONS)).toEqual({
      ok: false,
      error: 'malformed',
    });
  });
});
