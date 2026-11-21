/**
 * Aides des tests de bout en bout : un vrai serveur HTTP sur un port libre, et un « navigateur »
 * minimal qui garde le cookie de session entre les requêtes, comme le ferait un vrai.
 */
import { createAccountsServer, type AccountsConfig, type AccountsServer } from '../src/index.ts';
import { API_PREFIX } from '../src/protocol.ts';
import { createMemoryStore } from '../src/store-memory.ts';

export const TEST_SECRET = 'cle-de-ticket-pour-les-tests-0123456789';

export interface Running {
  readonly server: AccountsServer;
  /** URL de base de l'API, préfixe compris. */
  readonly api: string;
  /** Origine du serveur, telle qu'un navigateur l'enverrait dans `Origin`. */
  readonly origin: string;
  /** Lignes écrites dans le journal. */
  readonly logs: string[];
  close(): Promise<void>;
}

export async function startServer(overrides: Partial<AccountsConfig> = {}): Promise<Running> {
  const logs: string[] = [];
  const server = createAccountsServer({
    host: '127.0.0.1',
    port: 0,
    store: createMemoryStore(),
    ticketSecrets: [TEST_SECRET],
    allowedOrigins: [],
    secureCookies: false,
    trustProxy: false,
    // Paramètres réduits : le hachage de production prend 0,2 s par calcul.
    hashing: { logN: 10, r: 8, p: 1 },
    log: (line) => logs.push(line),
    ...overrides,
  });
  const { port } = await server.listen();
  const origin = `http://127.0.0.1:${port}`;
  return { server, api: origin + API_PREFIX, origin, logs, close: () => server.close() };
}

export interface Reply {
  readonly status: number;
  readonly headers: Headers;
  /** Corps JSON décodé, ou `null` s'il est vide. */
  readonly body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  readonly text: string;
}

/** Un navigateur minimal : garde le cookie de session reçu et le renvoie. */
export class Agent {
  cookie: string | null = null;
  /** En-têtes `Set-Cookie` de la dernière réponse. */
  setCookies: string[] = [];

  readonly #api: string;

  constructor(api: string) {
    this.#api = api;
  }

  async send(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Reply> {
    const init: RequestInit = { method, headers: { ...headers } };
    const all = init.headers as Record<string, string>;
    if (this.cookie !== null) all.cookie = this.cookie;
    if (body !== undefined) {
      all['content-type'] ??= 'application/json';
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const response = await fetch(this.#api + path, init);
    this.setCookies = response.headers.getSetCookie();
    for (const line of this.setCookies) {
      const [pair, ...attributes] = line.split(';').map((part) => part.trim());
      const cleared = attributes.some((a) => a.toLowerCase() === 'max-age=0');
      this.cookie = cleared ? null : pair!;
    }
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: text === '' ? null : JSON.parse(text),
      text,
    };
  }

  get(path: string, headers?: Record<string, string>): Promise<Reply> {
    return this.send('GET', path, undefined, headers);
  }

  post(path: string, body: unknown = {}, headers?: Record<string, string>): Promise<Reply> {
    return this.send('POST', path, body, headers);
  }

  patch(path: string, body: unknown, headers?: Record<string, string>): Promise<Reply> {
    return this.send('PATCH', path, body, headers);
  }
}
