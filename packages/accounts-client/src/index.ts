/**
 * Client navigateur du serveur des comptes. Ne lève jamais d'exception : chaque appel rend un
 * `Result`. Ne voit jamais le jeton de session, que le navigateur garde dans un cookie `HttpOnly`.
 *
 * Le client vérifie pseudos et mots de passe avant l'envoi, avec les règles mêmes du serveur ;
 * le serveur les vérifie de nouveau, seul juge.
 */
import {
  API_PREFIX,
  PASSWORD_PROBLEM_MESSAGES,
  PSEUDO_PROBLEM_MESSAGES,
  validatePassword,
  validatePseudo,
  type AccountResponse,
  type AccountView,
  type Audience,
  type ErrorCode,
  type SessionResponse,
  type TicketResponse,
} from '@game/accounts/protocol';

export type ClientErrorCode = ErrorCode | 'network';

export interface ClientError {
  readonly code: ClientErrorCode;
  /** En français, affichable tel quel. */
  readonly message: string;
  /** Secondes à attendre, pour `rate_limited`. */
  readonly retryAfter?: number;
}

export type Result<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ClientError };

export interface ClientOptions {
  /** Défaut : `/api/accounts/v1`, sur la même origine que la page. */
  readonly baseUrl?: string;
  /** Défaut : le `fetch` du navigateur. */
  readonly fetch?: typeof fetch;
}

export interface ProfileChanges {
  readonly pseudo?: string;
  readonly favoriteFighter?: string | null;
}

export interface AccountsClient {
  /** Compte de la session courante, ou `null` sans session. */
  session(): Promise<Result<AccountView | null>>;
  guest(pseudo?: string): Promise<Result<AccountView>>;
  register(pseudo: string, password: string): Promise<Result<AccountView>>;
  convert(pseudo: string, password: string): Promise<Result<AccountView>>;
  login(pseudo: string, password: string): Promise<Result<AccountView>>;
  logout(): Promise<Result<void>>;
  updateProfile(changes: ProfileChanges): Promise<Result<AccountView>>;
  changePassword(current: string, next: string): Promise<Result<void>>;
  /** Mot de passe exigé pour un compte, pas pour un invité. */
  deleteAccount(password?: string): Promise<Result<void>>;
  ticket(audience: Audience): Promise<Result<TicketResponse>>;
}

const NETWORK: Result<never> = {
  ok: false,
  error: { code: 'network', message: 'Serveur des comptes injoignable.' },
};

function fail(code: ClientErrorCode, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}

/** Refus local d'un pseudo, ou `null` s'il est acceptable. */
function pseudoProblem(pseudo: string): Result<never> | null {
  const result = validatePseudo(pseudo);
  return result.ok ? null : fail('invalid_pseudo', PSEUDO_PROBLEM_MESSAGES[result.problem]);
}

function passwordProblem(password: string, pseudo: string): Result<never> | null {
  const result = validatePassword(password, pseudo);
  return result.ok ? null : fail('invalid_password', PASSWORD_PROBLEM_MESSAGES[result.problem]);
}

function isErrorBody(value: unknown): value is { error: { code: ErrorCode; message: string } } {
  if (typeof value !== 'object' || value === null) return false;
  const error = (value as { error?: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

export function createAccountsClient(options: ClientOptions = {}): AccountsClient {
  const base = options.baseUrl ?? API_PREFIX;
  const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function call<T>(method: string, path: string, body?: object): Promise<Result<T>> {
    let response: Response;
    try {
      response = await send(base + path, {
        method,
        // Le cookie de session ne part que vers la même origine que la page.
        credentials: 'same-origin',
        // Toute requête qui modifie quelque chose est en JSON : le serveur l'exige.
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
    } catch {
      return NETWORK;
    }
    if (response.status === 204) return { ok: true, value: undefined as T };
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return NETWORK;
    }
    if (response.ok) return { ok: true, value: data as T };
    if (!isErrorBody(data)) return NETWORK;
    const retryAfter = Number(response.headers.get('retry-after'));
    return {
      ok: false,
      error: {
        code: data.error.code,
        message: data.error.message,
        ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter } : {}),
      },
    };
  }

  async function account(method: string, path: string, body: object): Promise<Result<AccountView>> {
    const result = await call<AccountResponse>(method, path, body);
    return result.ok ? { ok: true, value: result.value.account } : result;
  }

  return {
    async session() {
      const result = await call<SessionResponse>('GET', '/session');
      return result.ok ? { ok: true, value: result.value.account } : result;
    },
    guest(pseudo) {
      if (pseudo !== undefined) {
        const problem = pseudoProblem(pseudo);
        if (problem !== null) return Promise.resolve(problem);
      }
      return account('POST', '/guest', pseudo === undefined ? {} : { pseudo });
    },
    register(pseudo, password) {
      const problem = pseudoProblem(pseudo) ?? passwordProblem(password, pseudo);
      if (problem !== null) return Promise.resolve(problem);
      return account('POST', '/register', { pseudo, password });
    },
    convert(pseudo, password) {
      const problem = pseudoProblem(pseudo) ?? passwordProblem(password, pseudo);
      if (problem !== null) return Promise.resolve(problem);
      return account('POST', '/convert', { pseudo, password });
    },
    login(pseudo, password) {
      // Pas de vérification locale : un compte créé sous d'anciennes règles doit pouvoir entrer.
      return account('POST', '/login', { pseudo, password });
    },
    logout() {
      return call('POST', '/logout', {});
    },
    updateProfile(changes) {
      if (changes.pseudo !== undefined) {
        const problem = pseudoProblem(changes.pseudo);
        if (problem !== null) return Promise.resolve(problem);
      }
      return account('PATCH', '/profile', changes);
    },
    changePassword(current, next) {
      return call('POST', '/password', { current, next });
    },
    deleteAccount(password) {
      return call('POST', '/delete', password === undefined ? {} : { password });
    },
    ticket(audience) {
      return call('POST', '/tickets', { audience });
    },
  };
}

export {
  API_PREFIX,
  ERROR_MESSAGES,
  PASSWORD_PROBLEM_MESSAGES,
  PSEUDO_PROBLEM_MESSAGES,
  PSEUDO_MAX,
  PSEUDO_MIN,
  PASSWORD_MAX,
  PASSWORD_MIN,
  isFighterId,
  validatePassword,
  validatePseudo,
} from '@game/accounts/protocol';
export type {
  AccountStats,
  AccountView,
  Audience,
  ErrorCode,
  PasswordProblem,
  PseudoProblem,
  TicketResponse,
} from '@game/accounts/protocol';
