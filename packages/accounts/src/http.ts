/**
 * Couche HTTP : routage, lecture du corps, cookie de session, protections, en-têtes, erreurs.
 * Aucune règle métier ici : tout passe par `AccountService`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { API_PREFIX, ERROR_MESSAGES, type ErrorCode } from './protocol.ts';
import { addressKey } from './rate-limit.ts';
import {
  SESSION_TTL_MS,
  type AccountService,
  type Authenticated,
  type Outcome,
  type SessionGrant,
} from './service.ts';

/** Taille maximale d'un corps de requête. */
export const MAX_BODY_BYTES = 8 * 1024;

export interface HttpOptions {
  readonly service: AccountService;
  /** Origines autorisées en plus de celle du serveur lui-même. */
  readonly allowedOrigins: readonly string[];
  /** Cookie `Secure` et préfixe `__Host-` : obligatoire en production (https). */
  readonly secureCookies: boolean;
  /** Lire l'adresse du client dans `X-Forwarded-For` (derrière notre proxy inverse seulement). */
  readonly trustProxy: boolean;
  /** Une ligne par requête : méthode, route, statut, durée. */
  readonly log: (line: string) => void;
  /** Horloge, pour la durée des cookies. */
  readonly now: () => number;
}

const STATUS: Readonly<Record<ErrorCode, number>> = {
  bad_request: 400,
  unsupported_media_type: 415,
  payload_too_large: 413,
  forbidden_origin: 403,
  not_found: 404,
  method_not_allowed: 405,
  unauthenticated: 401,
  not_a_guest: 403,
  guest_not_allowed: 403,
  invalid_pseudo: 400,
  pseudo_taken: 409,
  invalid_password: 400,
  invalid_credentials: 401,
  invalid_fighter: 400,
  invalid_audience: 400,
  rate_limited: 429,
  server_busy: 503,
  internal: 500,
};

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/** Erreur qui interrompt le traitement d'une requête et devient une réponse. */
class HttpError extends Error {
  readonly code: ErrorCode;
  readonly detail: string | undefined;
  readonly retryAfter: number | undefined;
  constructor(code: ErrorCode, detail?: string, retryAfter?: number) {
    super(code);
    this.code = code;
    this.detail = detail;
    this.retryAfter = retryAfter;
  }
}

type Body = Readonly<Record<string, unknown>>;

interface Context {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly body: Body;
  readonly address: string;
  /** Jeton lu dans le cookie, s'il y en a un. */
  readonly token: string | undefined;
  /** Session de la requête, authentifiée à la demande. */
  auth(): Promise<Authenticated | null>;
  /** Session exigée : `unauthenticated` sinon. */
  requireAuth(): Promise<Authenticated>;
}

interface Route {
  /** Champs permis dans le corps ; tout autre est refusé. */
  readonly fields?: readonly string[];
  readonly handle: (context: Context) => Promise<Reply>;
}

interface Reply {
  readonly status: number;
  readonly body?: unknown;
  /** Session ouverte à poser dans le cookie, ou `null` pour effacer le cookie. */
  readonly session?: SessionGrant | null;
}

function unwrap<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new HttpError(outcome.error, outcome.message, outcome.retryAfter);
  return outcome.value;
}

function routes(
  service: AccountService,
): Readonly<Record<string, Readonly<Record<string, Route>>>> {
  return {
    '/health': {
      GET: { handle: async () => ({ status: 200, body: { ok: true } }) },
    },
    '/session': {
      GET: {
        handle: async (c) => ({ status: 200, body: { account: (await c.auth())?.view ?? null } }),
      },
    },
    '/guest': {
      POST: {
        fields: ['pseudo'],
        handle: async (c) => {
          const grant = unwrap(await service.createGuest(c.body.pseudo, c.address, c.token));
          return { status: 201, body: { account: grant.account }, session: grant };
        },
      },
    },
    '/register': {
      POST: {
        fields: ['pseudo', 'password'],
        handle: async (c) => {
          const { pseudo, password } = c.body;
          const grant = unwrap(await service.register(pseudo, password, c.address, c.token));
          return { status: 201, body: { account: grant.account }, session: grant };
        },
      },
    },
    '/convert': {
      POST: {
        fields: ['pseudo', 'password'],
        handle: async (c) => {
          const auth = await c.requireAuth();
          const { pseudo, password } = c.body;
          const grant = unwrap(await service.convert(auth, pseudo, password, c.address));
          return { status: 200, body: { account: grant.account }, session: grant };
        },
      },
    },
    '/login': {
      POST: {
        fields: ['pseudo', 'password'],
        handle: async (c) => {
          const { pseudo, password } = c.body;
          const grant = unwrap(await service.login(pseudo, password, c.address, c.token));
          return { status: 200, body: { account: grant.account }, session: grant };
        },
      },
    },
    '/logout': {
      POST: {
        fields: [],
        handle: async (c) => {
          // Sans session, la déconnexion ne fait rien, mais réussit : elle est idempotente.
          const auth = await c.auth();
          if (auth !== null) await service.logout(auth);
          return { status: 204, session: null };
        },
      },
    },
    '/profile': {
      PATCH: {
        fields: ['pseudo', 'favoriteFighter'],
        handle: async (c) => {
          const auth = await c.requireAuth();
          const changes = {
            pseudo: c.body.pseudo as string | undefined,
            favoriteFighter: c.body.favoriteFighter as string | null | undefined,
          };
          return {
            status: 200,
            body: { account: unwrap(await service.updateProfile(auth, changes)) },
          };
        },
      },
    },
    '/password': {
      POST: {
        fields: ['current', 'next'],
        handle: async (c) => {
          const auth = await c.requireAuth();
          unwrap(await service.changePassword(auth, c.body.current, c.body.next, c.address));
          return { status: 204 };
        },
      },
    },
    '/delete': {
      POST: {
        fields: ['password'],
        handle: async (c) => {
          const auth = await c.requireAuth();
          unwrap(await service.deleteAccount(auth, c.body.password, c.address));
          return { status: 204, session: null };
        },
      },
    },
    '/tickets': {
      POST: {
        fields: ['audience'],
        handle: async (c) => {
          const auth = await c.requireAuth();
          return { status: 200, body: unwrap(service.issueTicket(auth, c.body.audience)) };
        },
      },
    },
  };
}

/** Valeur d'un cookie de l'en-tête `Cookie`, ou `undefined`. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

function isJson(type: string | undefined): boolean {
  return type !== undefined && type.split(';')[0]!.trim().toLowerCase() === 'application/json';
}

/** Vrai si l'origine annoncée est celle du serveur lui-même (même hôte, même port). */
function isSameOrigin(origin: string, host: string | undefined): boolean {
  if (host === undefined) return false;
  try {
    return new URL(origin).host === host.toLowerCase();
  } catch {
    return false;
  }
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  const declared = Number(request.headers['content-length'] ?? 0);
  if (declared > MAX_BODY_BYTES) return Promise.reject(new HttpError('payload_too_large'));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        request.removeAllListeners('data');
        // On cesse de lire ; le reste du corps est ignoré et la connexion fermée après la réponse.
        request.pause();
        reject(new HttpError('payload_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function parseBody(raw: Buffer, fields: readonly string[]): Body {
  if (raw.length === 0) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError('bad_request', 'Le corps de la requête n’est pas du JSON valide.');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError('bad_request', 'Le corps de la requête doit être un objet JSON.');
  }
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) throw new HttpError('bad_request', `Champ inattendu : ${key}.`);
  }
  return value as Body;
}

export function createHandler(
  options: HttpOptions,
): (request: IncomingMessage, response: ServerResponse) => void {
  const table = routes(options.service);
  const cookieName = options.secureCookies ? '__Host-sid' : 'sid';
  const allowed = new Set(options.allowedOrigins);

  function cookie(value: string, maxAgeSeconds: number): string {
    const secure = options.secureCookies ? '; Secure' : '';
    return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=${maxAgeSeconds}`;
  }

  function addressOf(request: IncomingMessage): string {
    if (options.trustProxy) {
      const forwarded = request.headers['x-forwarded-for'];
      const list = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? '')).split(',');
      // Notre proxy ajoute l'adresse qu'il voit en fin de liste ; le début est écrit par le client.
      const last = list[list.length - 1]!.trim();
      if (last !== '') return addressKey(last);
    }
    return addressKey(request.socket.remoteAddress ?? '');
  }

  function checkOrigin(request: IncomingMessage): void {
    if (request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError('forbidden_origin');
    const origin = request.headers.origin;
    if (origin === undefined) return;
    if (allowed.has(origin) || isSameOrigin(origin, request.headers.host)) return;
    throw new HttpError('forbidden_origin');
  }

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<[string, number]> {
    const method = request.method ?? 'GET';
    const path = new URL(request.url ?? '/', 'http://serveur').pathname;
    const entry = path.startsWith(API_PREFIX + '/')
      ? table[path.slice(API_PREFIX.length)]
      : undefined;
    if (entry === undefined) throw new HttpError('not_found');
    const routeName = path.slice(API_PREFIX.length);
    const route = entry[method];
    if (route === undefined) {
      response.setHeader('Allow', Object.keys(entry).join(', '));
      throw Object.assign(new HttpError('method_not_allowed'), { routeName });
    }

    let body: Body = {};
    if (method !== 'GET') {
      checkOrigin(request);
      if (!isJson(request.headers['content-type'])) throw new HttpError('unsupported_media_type');
      body = parseBody(await readBody(request), route.fields ?? []);
    }

    const token = readCookie(request.headers.cookie, cookieName);
    let cached: Promise<Authenticated | null> | undefined;
    const auth = (): Promise<Authenticated | null> =>
      (cached ??= options.service.authenticate(token));
    const context: Context = {
      request,
      response,
      body,
      address: addressOf(request),
      token,
      auth,
      async requireAuth() {
        const found = await auth();
        if (found === null) throw new HttpError('unauthenticated');
        return found;
      },
    };

    const reply = await route.handle(context);
    if (reply.session === null) {
      response.setHeader('Set-Cookie', cookie('', 0));
    } else if (reply.session !== undefined) {
      const maxAge = Math.round((reply.session.expiresAt - options.now()) / 1000);
      response.setHeader('Set-Cookie', cookie(reply.session.token, maxAge));
    } else if (cached !== undefined && token !== undefined) {
      // Session prolongée par cette requête : le navigateur doit le savoir aussi.
      const found = await cached;
      if (found?.extended === true) {
        response.setHeader('Set-Cookie', cookie(token, Math.round(SESSION_TTL_MS / 1000)));
      }
    }
    send(response, reply.status, reply.body);
    return [routeName, reply.status];
  }

  function send(response: ServerResponse, status: number, body?: unknown): void {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
    if (body === undefined) {
      response.writeHead(status).end();
      return;
    }
    const text = JSON.stringify(body);
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
    });
    response.end(text);
  }

  return (request, response) => {
    const started = performance.now();
    const method = request.method ?? '?';
    const known = (path: string): string => {
      const route = new URL(path, 'http://serveur').pathname.slice(API_PREFIX.length);
      // Une adresse inconnue n'est pas recopiée : elle peut contenir n'importe quoi.
      return table[route] === undefined ? '?' : route;
    };
    handle(request, response)
      .then(([route, status]) => {
        options.log(`${method} ${route} ${status} ${Math.round(performance.now() - started)} ms`);
      })
      .catch((error: unknown) => {
        let code: ErrorCode = 'internal';
        let message = ERROR_MESSAGES.internal;
        if (error instanceof HttpError) {
          code = error.code;
          message = error.detail ?? ERROR_MESSAGES[code];
          if (error.retryAfter !== undefined)
            response.setHeader('Retry-After', String(error.retryAfter));
        } else {
          console.error('accounts : erreur interne', error);
        }
        if (code === 'server_busy') response.setHeader('Retry-After', '1');
        if (code === 'payload_too_large') response.setHeader('Connection', 'close');
        const status = STATUS[code];
        if (response.headersSent) {
          response.destroy();
        } else {
          send(response, status, { error: { code, message } });
        }
        const route = known(request.url ?? '/');
        options.log(`${method} ${route} ${status} ${Math.round(performance.now() - started)} ms`);
      });
  };
}
