/**
 * Aides des tests de bout en bout : un vrai serveur comptes + classement sur un port libre, un
 * « navigateur » qui garde son cookie, et un « serveur lobby » qui signe ses rapports.
 */
import { MemoryRateLimiter, createMemoryStore } from '@game/accounts';
import { createGameServer, type GameServer } from '../src/index.ts';
import type { MatchReport } from '../src/protocol.ts';
import { signReport } from '../src/report.ts';
import { createMemoryRankingStore } from '../src/store-memory.ts';
import type { RankingStore } from '../src/store.ts';

export const REPORT_SECRET = 'cle-des-rapports-pour-les-tests-000000000';
const GENEROUS = { capacity: 1000, windowSeconds: 1 };
const TICKET_SECRET = 'cle-de-ticket-pour-les-tests-0123456789';

export interface Running {
  readonly server: GameServer;
  readonly origin: string;
  readonly logs: string[];
  readonly store: RankingStore;
  close(): Promise<void>;
}

export async function startGameServer(
  options: { now?: () => number; store?: RankingStore } = {},
): Promise<Running> {
  const logs: string[] = [];
  const store = options.store ?? createMemoryRankingStore();
  const server = createGameServer(
    {
      host: '127.0.0.1',
      port: 0,
      store: createMemoryStore(),
      ticketSecrets: [TICKET_SECRET],
      allowedOrigins: [],
      secureCookies: false,
      trustProxy: false,
      hashing: { logN: 10, r: 8, p: 1 },
      // La limitation des tentatives est testée par les comptes ; ici, elle gênerait les données semées.
      limiters: {
        authPerAddress: new MemoryRateLimiter(GENEROUS),
        guestPerAddress: new MemoryRateLimiter(GENEROUS),
        loginFailuresPerPseudo: new MemoryRateLimiter(GENEROUS),
      },
      log: (line) => logs.push(line),
      ...(options.now === undefined ? {} : { now: options.now }),
    },
    {
      store,
      reportSecrets: [REPORT_SECRET],
      ...(options.now === undefined ? {} : { now: options.now }),
    },
  );
  const { port } = await server.listen();
  return {
    server,
    origin: `http://127.0.0.1:${port}`,
    logs,
    store,
    close: () => server.close(),
  };
}

export interface Reply {
  readonly status: number;
  readonly headers: Headers;
  readonly body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function reply(response: Response): Promise<Reply> {
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text === '' ? null : JSON.parse(text),
  };
}

/** Un navigateur minimal : garde le cookie de session. */
export class Browser {
  cookie: string | null = null;
  readonly #origin: string;
  constructor(origin: string) {
    this.#origin = origin;
  }

  async send(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Reply> {
    const all: Record<string, string> = { ...headers };
    if (this.cookie !== null) all.cookie = this.cookie;
    const init: RequestInit = { method, headers: all };
    if (body !== undefined) {
      all['content-type'] ??= 'application/json';
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const response = await fetch(this.#origin + path, init);
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';').map((part) => part.trim());
      this.cookie = attributes.some((a) => a.toLowerCase() === 'max-age=0') ? null : pair!;
    }
    return reply(response);
  }

  /** Crée un compte et renvoie son identifiant. */
  async register(pseudo: string): Promise<string> {
    const r = await this.send('POST', '/api/accounts/v1/register', {
      pseudo,
      password: 'mot-de-passe-solide',
    });
    if (r.status !== 201) throw new Error(`inscription refusée : ${JSON.stringify(r.body)}`);
    return r.body.account.id as string;
  }

  async guest(pseudo: string): Promise<string> {
    const r = await this.send('POST', '/api/accounts/v1/guest', { pseudo });
    return r.body.account.id as string;
  }
}

/** Envoie un rapport comme le ferait le serveur de `lobby`. */
export async function postReport(
  origin: string,
  report: MatchReport | unknown,
  options: { secret?: string; headers?: Record<string, string>; raw?: string } = {},
): Promise<Reply> {
  const body = options.raw ?? JSON.stringify(report);
  const response = await fetch(`${origin}/api/ranking/v1/matches`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: signReport(body, options.secret ?? REPORT_SECRET),
      ...options.headers,
    },
    body,
  });
  return reply(response);
}
