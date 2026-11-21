import { describe, expect, it } from 'vitest';
import {
  addressKey,
  createAddressCounter,
  createBuckets,
  createReplayGuard,
} from '../src/limits.ts';

describe('seaux à jetons', () => {
  it('permet la rafale, refuse au-delà, puis se remplit avec le temps', () => {
    let t = 0;
    const b = createBuckets({ capacity: 3, refillMs: 1000 }, () => t);
    expect([b.take('a'), b.take('a'), b.take('a'), b.take('a')]).toEqual([true, true, true, false]);
    expect(b.peek('a')).toBe(false);
    t += 999;
    expect(b.take('a')).toBe(false);
    t += 1;
    expect(b.take('a')).toBe(true);
    expect(b.take('b')).toBe(true);
  });

  it('oublie les seaux redevenus pleins', () => {
    let t = 0;
    const b = createBuckets({ capacity: 2, refillMs: 100 }, () => t);
    for (let i = 0; i < 100; i++) b.take(`k${i}`);
    expect(b.size()).toBe(100);
    t += 1000;
    b.take('autre');
    expect(b.size()).toBe(1);
  });
});

describe('adresses', () => {
  it('regroupe les IPv6 par /64 et ramène les IPv4 vues en IPv6', () => {
    expect(addressKey('2001:db8:1:2:aaaa::1')).toBe(addressKey('2001:db8:1:2:bbbb::2'));
    expect(addressKey('2001:db8:1:2::1')).not.toBe(addressKey('2001:db8:1:3::1'));
    expect(addressKey('::ffff:192.168.1.2')).toBe('192.168.1.2');
    expect(addressKey('192.168.1.2')).toBe('192.168.1.2');
    expect(addressKey('fe80::1%eth0')).toBe(addressKey('fe80::2'));
    expect(addressKey('')).toBe('?');
    expect(addressKey('x'.repeat(500)).length).toBeLessThanOrEqual(64);
    expect(() => addressKey(':::::::::::')).not.toThrow();
    expect(() => addressKey(undefined as unknown as string)).not.toThrow();
  });

  it('plafonne les connexions par adresse', () => {
    const c = createAddressCounter(2);
    expect(c.open('1.2.3.4')).toBe(true);
    expect(c.open('::ffff:1.2.3.4')).toBe(true);
    expect(c.open('1.2.3.4')).toBe(false);
    expect(c.open('5.6.7.8')).toBe(true);
    c.close('1.2.3.4');
    expect(c.count('1.2.3.4')).toBe(1);
    expect(c.open('1.2.3.4')).toBe(true);
  });
});

describe('tickets déjà vus', () => {
  it('refuse un identifiant rejoué pendant la durée prévue, puis l’oublie', () => {
    let t = 0;
    const g = createReplayGuard(70_000, () => t);
    expect(g.first('a')).toBe(true);
    expect(g.first('a')).toBe(false);
    t += 69_999;
    expect(g.first('a')).toBe(false);
    t += 70_001;
    expect(g.first('b')).toBe(true);
    expect(g.size()).toBe(1);
    expect(g.first('a')).toBe(true);
  });
});
