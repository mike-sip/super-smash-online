/**
 * Routes `/api/ranking/v1`, servies par le serveur des comptes comme extension. Aucune règle
 * métier ici : tout passe par `RankingService`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ExtensionContext, HttpExtension } from '@game/accounts';
import { API_PREFIX, ERROR_MESSAGES, type ErrorCode } from './protocol.ts';
import { verifyReportSignature } from './report.ts';
import type { RankingService } from './service.ts';

/** Un rapport à 8 joueurs pèse environ 2 Ko : large marge. */
export const MAX_REPORT_BYTES = 32 * 1024;
/** Écart toléré entre `reportedAt` et l'horloge du serveur. */
export const MAX_REPORT_SKEW_MS = 5 * 60_000;

const STATUS: Readonly<Record<ErrorCode, number>> = {
  bad_request: 400,
  unsupported_media_type: 415,
  payload_too_large: 413,
  forbidden_origin: 403,
  not_found: 404,
  method_not_allowed: 405,
  unauthenticated: 401,
  invalid_report: 400,
  bad_signature: 401,
  stale_report: 400,
  conflict: 409,
  internal: 500,
};

class HttpError extends Error {
  readonly code: ErrorCode;
  readonly problems: readonly string[] | undefined;
  constructor(code: ErrorCode, problems?: readonly string[]) {
    super(code);
    this.code = code;
    this.problems = problems;
  }
}

interface Reply {
  readonly status: number;
  readonly body: unknown;
}

function isJson(type: string | undefined): boolean {
  return type !== undefined && type.split(';')[0]!.trim().toLowerCase() === 'application/json';
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  const declared = Number(request.headers['content-length'] ?? 0);
  if (declared > MAX_REPORT_BYTES) return Promise.reject(new HttpError('payload_too_large'));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_REPORT_BYTES) {
        request.removeAllListeners('data');
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

/** Entier d'un paramètre de requête, ou la valeur par défaut ; `null` s'il est mal formé. */
function intParam(params: URLSearchParams, name: string, fallback: number): number | null {
  const raw = params.get(name);
  if (raw === null) return fallback;
  return /^[0-9]{1,9}$/.test(raw) ? Number(raw) : null;
}

export interface RankingHttpOptions {
  readonly service: RankingService;
  readonly reportSecrets: readonly string[];
  readonly now: () => number;
}

export function createRankingExtension(options: RankingHttpOptions): HttpExtension {
  const { service } = options;

  async function submit(request: IncomingMessage): Promise<Reply> {
    // Un navigateur envoie toujours l'un de ces en-têtes ; un serveur, jamais.
    if (request.headers.origin !== undefined || request.headers['sec-fetch-site'] !== undefined) {
      throw new HttpError('forbidden_origin');
    }
    if (!isJson(request.headers['content-type'])) throw new HttpError('unsupported_media_type');
    const raw = await readBody(request);
    if (!verifyReportSignature(request.headers.authorization, raw, options.reportSecrets)) {
      throw new HttpError('bad_signature');
    }
    let value: unknown;
    try {
      value = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new HttpError('bad_request');
    }
    const reportedAt = (value as { reportedAt?: unknown } | null)?.reportedAt;
    if (
      typeof reportedAt === 'number' &&
      Math.abs(options.now() - reportedAt) > MAX_REPORT_SKEW_MS
    ) {
      throw new HttpError('stale_report');
    }
    const outcome = await service.submit(value);
    if (!outcome.ok) throw new HttpError(outcome.error, outcome.problems);
    return { status: outcome.created ? 201 : 200, body: outcome.value };
  }

  async function route(
    method: string,
    path: string,
    params: URLSearchParams,
    request: IncomingMessage,
    context: ExtensionContext,
  ): Promise<Reply> {
    const allow = (methods: string): void => {
      if (!methods.split(', ').includes(method)) {
        throw Object.assign(new HttpError('method_not_allowed'), { allow: methods });
      }
    };
    switch (path) {
      case '/matches':
        allow('POST');
        return submit(request);
      case '/leaderboard': {
        allow('GET');
        const offset = intParam(params, 'offset', 0);
        const limit = intParam(params, 'limit', 50);
        if (offset === null || limit === null) throw new HttpError('bad_request');
        return { status: 200, body: await service.leaderboard(offset, limit) };
      }
      case '/me': {
        allow('GET');
        const auth = await context.auth();
        if (auth === null) return { status: 200, body: { profile: null, guest: false } };
        return {
          status: 200,
          body: { profile: await service.profile(auth.accountId), guest: auth.guest },
        };
      }
      case '/me/matches': {
        allow('GET');
        const limit = intParam(params, 'limit', 20);
        if (limit === null) throw new HttpError('bad_request');
        const auth = await context.auth();
        if (auth === null) throw new HttpError('unauthenticated');
        const outcome = await service.history(
          auth.accountId,
          params.get('before') ?? undefined,
          limit,
        );
        if (!outcome.ok) throw new HttpError(outcome.error);
        return { status: 200, body: outcome.value };
      }
      default:
        throw new HttpError('not_found');
    }
  }

  function send(
    response: ServerResponse,
    context: ExtensionContext,
    status: number,
    body: unknown,
  ): void {
    for (const [name, value] of Object.entries(context.securityHeaders)) {
      response.setHeader(name, value);
    }
    const text = JSON.stringify(body);
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
    });
    response.end(text);
  }

  const KNOWN = new Set(['/matches', '/leaderboard', '/me', '/me/matches']);

  return {
    prefix: API_PREFIX,
    async handle(request, response, context) {
      const method = request.method ?? 'GET';
      const url = new URL(request.url ?? '/', 'http://serveur');
      const path = url.pathname.slice(API_PREFIX.length);
      const label = KNOWN.has(path) ? path : '?';
      try {
        const reply = await route(method, path, url.searchParams, request, context);
        send(response, context, reply.status, reply.body);
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        const allow = (error as HttpError & { allow?: string }).allow;
        if (allow !== undefined) response.setHeader('Allow', allow);
        if (error.code === 'bad_signature') response.setHeader('WWW-Authenticate', 'Report');
        if (error.code === 'payload_too_large') response.setHeader('Connection', 'close');
        send(response, context, STATUS[error.code], {
          error: {
            code: error.code,
            message: ERROR_MESSAGES[error.code],
            ...(error.problems === undefined ? {} : { problems: error.problems }),
          },
        });
      }
      return label;
    },
  };
}
