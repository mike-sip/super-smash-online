import { defaultMatchConfig } from '@game/match-rules';
import { validateReport } from '@game/ranking/protocol';
import { verifyReportSignature } from '@game/ranking/report';
import { describe, expect, it } from 'vitest';
import { createRankingReporter, reportFromRecord } from '../src/ranking-report.ts';
import type { MatchRecord } from '../src/results.ts';

const SECRET = 'cle-de-test-pour-les-rapports-000000000';
const URL = 'http://comptes.test/api/ranking/v1/matches';

function playerResult(placement: number) {
  return {
    team: -1,
    placement,
    kos: 2 - placement,
    falls: placement - 1,
    selfDestructs: 0,
    score: 3 - 2 * placement,
    damageDealt: 100.5,
    damageTaken: 80.25,
    stocksLeft: 2 - placement,
    ultimatesUsed: 0,
    eliminatedAt: placement === 1 ? -1 : 1500,
  };
}

function record(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    matchId: '11111111-2222-4333-8444-555555555555',
    ranked: true,
    gameId: 'g1',
    kind: 'quick',
    region: 'eu',
    config: defaultMatchConfig('stock', 2),
    stage: 'belvedere',
    startedAt: 1_000,
    endedAt: 61_000,
    status: 'agreed',
    endFrame: 1600,
    players: [
      {
        accountId: 'aaaaaaaa-0000-4000-8000-000000000001',
        name: 'Alpha',
        guest: false,
        fighter: 'sorel',
        result: playerResult(1),
        leftAtFrame: null,
      },
      {
        accountId: 'aaaaaaaa-0000-4000-8000-000000000002',
        name: 'Beta',
        guest: false,
        fighter: 'ferroc',
        result: playerResult(2),
        leftAtFrame: 1500,
      },
    ],
    winners: [0],
    ...overrides,
  };
}

/** Horloge et minuteries virtuelles. */
function virtualTime(start = 1_000_000) {
  let now = start;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 0;
  return {
    now: () => now,
    setTimer(fn: () => void, ms: number) {
      const id = next++;
      timers.push({ at: now + ms, fn, id });
      return () => {
        timers = timers.filter((t) => t.id !== id);
      };
    },
    /** Avance l'horloge en déclenchant les minuteries échues, dans l'ordre. */
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        await flush();
        timers.sort((a, b) => a.at - b.at);
        const t = timers[0];
        if (t === undefined || t.at > end) break;
        timers.shift();
        now = t.at;
        t.fn();
      }
      now = end;
      await flush();
    },
    timers: () => timers.length,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

interface Call {
  url: string;
  body: string;
  auth: string;
  contentType: string;
}

function fakeFetch(answers: (call: Call, n: number) => Promise<Response> | Response) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    const call = {
      url,
      body: String(init.body),
      auth: headers.get('authorization') ?? '',
      contentType: headers.get('content-type') ?? '',
    };
    calls.push(call);
    const answer = answers(call, calls.length);
    if (init.signal) {
      return await new Promise<Response>((resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
        void Promise.resolve(answer).then(resolve, reject);
      });
    }
    return await answer;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const status = (code: number) => new Response('{}', { status: code });

function setup(answers: Parameters<typeof fakeFetch>[0], maxQueue?: number) {
  const time = virtualTime();
  const net = fakeFetch(answers);
  const logs: string[] = [];
  const reporter = createRankingReporter({
    url: URL,
    secret: SECRET,
    now: time.now,
    fetch: net.fn,
    setTimer: time.setTimer,
    log: (m) => logs.push(m),
    ...(maxQueue === undefined ? {} : { maxQueue }),
  });
  return { time, net, logs, reporter };
}

describe('reportFromRecord', () => {
  it('donne un rapport valide pour ranking, conforme à l’enregistrement', () => {
    const report = reportFromRecord(record(), 2_000);
    expect(validateReport(report).ok).toBe(true);
    expect(report).toMatchObject({
      version: 1,
      matchId: record().matchId,
      reportedAt: 2_000,
      endedAt: 61_000,
      ranked: true,
      mode: 'stock',
      teams: false,
      endFrame: 1600,
    });
    expect(report.players[1]).toEqual({
      accountId: 'aaaaaaaa-0000-4000-8000-000000000002',
      guest: false,
      fighter: 'ferroc',
      team: -1,
      placement: 2,
      kos: 0,
      falls: 1,
      leftAtFrame: 1500,
    });
  });

  it('refuse un enregistrement sans résultat accepté', () => {
    expect(() => reportFromRecord(record({ status: 'contested' }), 0)).toThrow();
    expect(() => reportFromRecord(record({ endFrame: null }), 0)).toThrow();
  });
});

describe('createRankingReporter', () => {
  it('envoie un rapport signé, en JSON, et s’arrête sur 201', async () => {
    const { time, net, reporter } = setup(() => status(201));
    reporter.submit(record());
    await time.advance(0);
    expect(net.calls).toHaveLength(1);
    const call = net.calls[0]!;
    expect(call.url).toBe(URL);
    expect(call.contentType).toBe('application/json');
    expect(verifyReportSignature(call.auth, call.body, [SECRET])).toBe(true);
    expect(JSON.parse(call.body).reportedAt).toBe(time.now());
    expect(reporter.pending()).toBe(0);
    await time.advance(3_600_000);
    expect(net.calls).toHaveLength(1);
  });

  it('200 duplicate : fini aussi', async () => {
    const { time, net, reporter } = setup(() => status(200));
    reporter.submit(record());
    await time.advance(10_000);
    expect(net.calls).toHaveLength(1);
    expect(reporter.pending()).toBe(0);
  });

  it('n’envoie que les matchs « agreed »', async () => {
    const { time, net, reporter } = setup(() => status(201));
    reporter.submit(record({ status: 'contested', endFrame: null, winners: [] }));
    reporter.submit(record({ status: 'abandoned', endFrame: null, winners: [] }));
    await time.advance(1_000);
    expect(net.calls).toHaveLength(0);
    expect(reporter.pending()).toBe(0);
  });

  it('erreur réseau, 5xx ou pas de réponse : renvoi avec le même matchId et une date neuve', async () => {
    const { time, net, reporter } = setup((_, n) => {
      if (n === 1) throw new Error('ECONNREFUSED');
      if (n === 2) return status(503);
      if (n === 3) return new Promise<Response>(() => {}); // jamais de réponse
      return status(201);
    });
    reporter.submit(record());
    await time.advance(0);
    expect(net.calls).toHaveLength(1);
    await time.advance(1_000); // 1 s après le premier échec
    expect(net.calls).toHaveLength(2);
    await time.advance(2_000); // 2 s après le deuxième
    expect(net.calls).toHaveLength(3);
    expect(reporter.pending()).toBe(1);
    await time.advance(5_000); // délai de réponse dépassé
    await time.advance(4_000); // puis 4 s
    expect(net.calls).toHaveLength(4);
    expect(reporter.pending()).toBe(0);
    const bodies = net.calls.map((c) => JSON.parse(c.body));
    expect(new Set(bodies.map((b) => b.matchId)).size).toBe(1);
    const dates = bodies.map((b) => b.reportedAt);
    expect(new Set(dates).size).toBe(4);
    for (const c of net.calls) expect(verifyReportSignature(c.auth, c.body, [SECRET])).toBe(true);
  });

  it('écart entre deux essais plafonné à 60 s, abandon après 24 h', async () => {
    const { time, net, reporter, logs } = setup(() => status(502));
    reporter.submit(record());
    await time.advance(0);
    await time.advance(10 * 60_000);
    const inTenMinutes = net.calls.length;
    // 1+2+4+8+16+32 = 63 s, puis un essai par minute : 1 + 6 + 9 essais environ en 10 min.
    expect(inTenMinutes).toBeGreaterThanOrEqual(14);
    expect(inTenMinutes).toBeLessThanOrEqual(17);
    await time.advance(24 * 3_600_000);
    expect(reporter.pending()).toBe(0);
    const total = net.calls.length;
    await time.advance(3_600_000);
    expect(net.calls.length).toBe(total);
    expect(logs.some((l) => l.includes('abandon'))).toBe(true);
  });

  it.each([400, 401, 403, 409])('%i : abandon sans renvoi, journalisé', async (code) => {
    const { time, net, reporter, logs } = setup(() => status(code));
    reporter.submit(record());
    await time.advance(3_600_000);
    expect(net.calls).toHaveLength(1);
    expect(reporter.pending()).toBe(0);
    expect(logs.some((l) => l.includes(String(code)))).toBe(true);
  });

  it('file bornée : au-delà, le rapport est refusé et journalisé', async () => {
    const { time, net, reporter, logs } = setup(() => new Promise<Response>(() => {}), 2);
    for (let i = 0; i < 3; i++) {
      reporter.submit(record({ matchId: `11111111-2222-4333-8444-55555555555${i}` }));
    }
    await time.advance(0);
    expect(reporter.pending()).toBe(2);
    expect(net.calls).toHaveLength(2);
    expect(logs.some((l) => l.includes('file pleine'))).toBe(true);
  });

  it('les journaux ne contiennent ni pseudo, ni identifiant de compte', async () => {
    const { time, reporter, logs } = setup((_, n) => (n === 1 ? status(500) : status(400)));
    reporter.submit(record());
    await time.advance(10_000);
    const all = logs.join('\n');
    expect(all).not.toMatch(/Alpha|Beta|aaaaaaaa-0000/);
    expect(logs.length).toBeGreaterThan(0);
  });

  it('close : un dernier essai pour ce qui attend, puis plus rien', async () => {
    let up = false;
    const { time, net, reporter, logs } = setup(() => (up ? status(201) : status(503)));
    reporter.submit(record());
    reporter.submit(record({ matchId: '11111111-2222-4333-8444-555555555556' }));
    await time.advance(0);
    expect(net.calls).toHaveLength(2);
    up = true;
    await reporter.close();
    expect(net.calls).toHaveLength(4);
    expect(reporter.pending()).toBe(0);
    reporter.submit(record({ matchId: '11111111-2222-4333-8444-555555555557' }));
    await time.advance(60_000);
    expect(net.calls).toHaveLength(4);
    expect(time.timers()).toBe(0);
    expect(logs.length).toBeGreaterThan(0);
  });

  it('close : ce qui reste après le dernier essai est journalisé', async () => {
    const { time, reporter, logs } = setup(() => status(503));
    reporter.submit(record());
    await time.advance(0);
    await reporter.close();
    expect(logs.some((l) => l.includes('perdu'))).toBe(true);
    expect(reporter.pending()).toBe(0);
  });
});
