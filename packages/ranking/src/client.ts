/**
 * Client navigateur du classement (`@game/ranking/client`) : appels typés, sans exception. Le
 * cookie de session est envoyé par le navigateur ; le client ne le voit jamais.
 */
import {
  API_PREFIX,
  ERROR_MESSAGES,
  type ErrorCode,
  type HistoryResponse,
  type LeaderboardResponse,
  type ProfileResponse,
} from './protocol.ts';

export interface ClientError {
  readonly code: ErrorCode | 'network';
  /** En français, affichable tel quel. */
  readonly message: string;
}

export type Result<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ClientError };

export interface RankingClientOptions {
  /** Défaut : `/api/ranking/v1`, sur la même origine que la page. */
  readonly baseUrl?: string;
  /** Défaut : le `fetch` du navigateur. */
  readonly fetch?: typeof fetch;
}

export interface RankingClient {
  leaderboard(offset?: number, limit?: number): Promise<Result<LeaderboardResponse>>;
  /** Profil de la session courante (`profile: null` sans session). */
  me(): Promise<Result<ProfileResponse>>;
  /** Historique de la session courante ; `before` : `next` de la page précédente. */
  myMatches(before?: string, limit?: number): Promise<Result<HistoryResponse>>;
}

const NETWORK: Result<never> = {
  ok: false,
  error: { code: 'network', message: 'Serveur du classement injoignable.' },
};

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_MESSAGES, value);
}

export function createRankingClient(options: RankingClientOptions = {}): RankingClient {
  const base = options.baseUrl ?? API_PREFIX;
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function get<T>(
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<Result<T>> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) query.set(key, String(value));
    }
    const suffix = query.size > 0 ? `?${query}` : '';
    let response: Response;
    try {
      response = await doFetch(`${base}${path}${suffix}`, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
    } catch {
      return NETWORK;
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // Un proxy sans serveur derrière répond souvent par une page d'erreur.
      return NETWORK;
    }
    if (response.ok) return { ok: true, value: body as T };
    const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
    if (!isErrorCode(code)) return NETWORK;
    return { ok: false, error: { code, message: ERROR_MESSAGES[code] } };
  }

  return {
    leaderboard: (offset, limit) => get('/leaderboard', { offset, limit }),
    me: () => get('/me', {}),
    myMatches: (before, limit) => get('/me/matches', { before, limit }),
  };
}

export type {
  FighterStats,
  HistoryEntry,
  HistoryPlayer,
  HistoryResponse,
  LeaderboardEntry,
  LeaderboardResponse,
  ProfileResponse,
  RankingProfile,
} from './protocol.ts';
