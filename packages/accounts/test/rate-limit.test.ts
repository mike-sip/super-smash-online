import { describe, expect, it } from 'vitest';
import { MemoryRateLimiter, RATE_RULES, addressKey } from '../src/rate-limit.ts';

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance(seconds: number) {
      now += seconds * 1000;
    },
  };
}

describe('MemoryRateLimiter', () => {
  it('laisse passer jusqu’à la capacité, puis annonce le délai', () => {
    const time = clock();
    const limiter = new MemoryRateLimiter({ capacity: 3, windowSeconds: 60 }, time.now);
    expect([limiter.hit('a'), limiter.hit('a'), limiter.hit('a')]).toEqual([0, 0, 0]);
    // Un jeton revient toutes les 20 secondes.
    expect(limiter.hit('a')).toBe(20);
    time.advance(5);
    expect(limiter.peek('a')).toBe(15);
  });

  it('se remplit avec le temps, sans dépasser la capacité', () => {
    const time = clock();
    const limiter = new MemoryRateLimiter({ capacity: 2, windowSeconds: 10 }, time.now);
    limiter.hit('a');
    limiter.hit('a');
    expect(limiter.peek('a')).toBeGreaterThan(0);
    time.advance(5);
    expect(limiter.hit('a')).toBe(0);
    expect(limiter.hit('a')).toBeGreaterThan(0);
    time.advance(1000);
    expect([limiter.hit('a'), limiter.hit('a'), limiter.hit('a')]).toEqual([0, 0, 5]);
  });

  it('ne consomme rien en regardant', () => {
    const limiter = new MemoryRateLimiter({ capacity: 1, windowSeconds: 60 }, clock().now);
    expect(limiter.peek('a')).toBe(0);
    expect(limiter.peek('a')).toBe(0);
    expect(limiter.hit('a')).toBe(0);
    expect(limiter.peek('a')).toBe(60);
  });

  it('traite chaque clé séparément', () => {
    const limiter = new MemoryRateLimiter({ capacity: 1, windowSeconds: 60 }, clock().now);
    expect(limiter.hit('a')).toBe(0);
    expect(limiter.hit('a')).toBeGreaterThan(0);
    expect(limiter.hit('b')).toBe(0);
  });

  it('oublie une clé remise à zéro', () => {
    const limiter = new MemoryRateLimiter({ capacity: 1, windowSeconds: 60 }, clock().now);
    limiter.hit('a');
    limiter.reset('a');
    expect(limiter.hit('a')).toBe(0);
  });

  it('oublie les seaux redevenus pleins, et borne le nombre de seaux', () => {
    const time = clock();
    const limiter = new MemoryRateLimiter(
      { capacity: 2, windowSeconds: 10, maxKeys: 100 },
      time.now,
    );
    for (let i = 0; i < 50; i++) limiter.hit(`ip-${i}`);
    expect(limiter.size).toBe(50);
    time.advance(10);
    limiter.sweep();
    expect(limiter.size).toBe(0);

    // Au-delà de la borne, les plus anciens sont oubliés : la mémoire ne croît jamais sans fin.
    for (let i = 0; i < 1000; i++) limiter.hit(`ip-${i}`);
    expect(limiter.size).toBeLessThanOrEqual(100);
  });
});

describe('RATE_RULES', () => {
  it('suivent la spec', () => {
    expect(RATE_RULES.authPerAddress).toEqual({ capacity: 20, windowSeconds: 60 });
    expect(RATE_RULES.guestPerAddress).toEqual({ capacity: 30, windowSeconds: 3600 });
    expect(RATE_RULES.loginFailuresPerPseudo).toEqual({ capacity: 10, windowSeconds: 900 });
  });
});

describe('addressKey', () => {
  it('garde une adresse IPv4 telle quelle, y compris sous forme IPv6', () => {
    expect(addressKey('203.0.113.7')).toBe('203.0.113.7');
    expect(addressKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('regroupe une adresse IPv6 par bloc /64, que son titulaire peut parcourir à volonté', () => {
    expect(addressKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(addressKey('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(addressKey('2001:DB8:1:2:ffff::')).toBe('2001:db8:1:2::/64');
    expect(addressKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(addressKey('::1')).toBe('0:0:0:0::/64');
    expect(addressKey('2001:db8:1:3::1')).not.toBe(addressKey('2001:db8:1:2::1'));
  });

  it('borne la longueur de ce qui n’est pas une adresse', () => {
    expect(addressKey('x'.repeat(5000)).length).toBeLessThanOrEqual(64);
    expect(addressKey('')).toBe('inconnue');
    for (const odd of ['1:2:3:4:5:6:7:8::9', ':::', '1::2::3', '12345::1', 'fe80::1%eth0']) {
      expect(() => addressKey(odd), odd).not.toThrow();
      expect(addressKey(odd).length).toBeLessThanOrEqual(64);
    }
  });
});
