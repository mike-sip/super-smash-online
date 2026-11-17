/**
 * Règles métier des comptes : invités, inscription, conversion, connexion, sessions, profil,
 * suppression, tickets. Aucune entrée-sortie réseau : le stockage, l'horloge et la limitation
 * des tentatives sont fournis, ce qui rend tout testable sans serveur.
 */
import { randomUUID } from 'node:crypto';
import { HasherBusyError, type PasswordHasher } from './hashing.ts';
import { generateGuestPseudo, normalizePseudo, pseudoKey, validatePseudo } from './names.ts';
import { PASSWORD_MAX, normalizePassword, validatePassword } from './passwords.ts';
import {
  ERROR_MESSAGES,
  PASSWORD_PROBLEM_MESSAGES,
  PSEUDO_PROBLEM_MESSAGES,
  isAudience,
  isFighterId,
  type AccountView,
  type ErrorCode,
  type ProfileRequest,
  type TicketResponse,
} from './protocol.ts';
import { MemoryRateLimiter, RATE_RULES, type RateLimiter } from './rate-limit.ts';
import {
  PseudoTakenError,
  type AccountChanges,
  type AccountRecord,
  type AccountStore,
  type PurgeResult,
  type SessionRecord,
} from './store.ts';
import { signTicket } from './ticket.ts';
import { isWellFormedToken, newSessionToken, tokenDigest } from './tokens.ts';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Durée d'une session sans usage. */
export const SESSION_TTL_MS = 30 * DAY_MS;
/** La prolongation n'est écrite en base qu'une fois par heure au plus. */
export const SESSION_EXTEND_EVERY_MS = HOUR_MS;
export const MAX_SESSIONS_PER_ACCOUNT = 10;
/** Un invité sans visite depuis ce délai est effacé. */
export const GUEST_IDLE_MS = 30 * DAY_MS;
/** Au-delà, un pseudo saisi à la connexion ne peut correspondre à aucun compte. */
const MAX_PSEUDO_INPUT = 64;

export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: ErrorCode;
      readonly message: string;
      /** Secondes à attendre, pour `rate_limited`. */
      readonly retryAfter?: number;
    };

/** Session ouverte : le jeton est à remettre au navigateur, dans le cookie, et nulle part ailleurs. */
export interface SessionGrant {
  readonly account: AccountView;
  readonly token: string;
  /** Millisecondes Unix. */
  readonly expiresAt: number;
}

/** Résultat de l'authentification d'une requête. */
export interface Authenticated {
  readonly account: AccountRecord;
  readonly session: SessionRecord;
  readonly view: AccountView;
  /** Vrai si la session vient d'être prolongée : le cookie est à renvoyer avec sa nouvelle durée. */
  readonly extended: boolean;
}

export interface RateLimiters {
  readonly authPerAddress: RateLimiter;
  readonly guestPerAddress: RateLimiter;
  readonly loginFailuresPerPseudo: RateLimiter;
}

export interface ServiceOptions {
  readonly store: AccountStore;
  readonly hasher: PasswordHasher;
  /** La première signe les tickets ; toutes sont acceptées par `verifyTicket`. */
  readonly ticketSecrets: readonly string[];
  readonly now?: () => number;
  readonly limiters?: RateLimiters;
}

export type DeletionListener = (accountId: string) => void | Promise<void>;

const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });

function failure<T>(error: ErrorCode, message = ERROR_MESSAGES[error]): Outcome<T> {
  return { ok: false, error, message };
}

function limited<T>(retryAfter: number): Outcome<T> {
  return { ok: false, error: 'rate_limited', message: ERROR_MESSAGES.rate_limited, retryAfter };
}

export function toView(account: AccountRecord): AccountView {
  return {
    id: account.id,
    pseudo: account.pseudo,
    guest: account.guest,
    favoriteFighter: account.favoriteFighter,
    stats: { matchesPlayed: account.matchesPlayed, wins: account.wins },
    createdAt: new Date(account.createdAt).toISOString(),
  };
}

function checkPseudo(raw: unknown): Outcome<{ pseudo: string; key: string }> {
  if (typeof raw !== 'string') return failure('invalid_pseudo');
  const result = validatePseudo(raw);
  if (!result.ok) return failure('invalid_pseudo', PSEUDO_PROBLEM_MESSAGES[result.problem]);
  return ok({ pseudo: result.pseudo, key: result.key });
}

function checkPassword(password: unknown, pseudo: string): Outcome<string> {
  if (typeof password !== 'string') return failure('invalid_password');
  const result = validatePassword(password, pseudo);
  if (!result.ok) return failure('invalid_password', PASSWORD_PROBLEM_MESSAGES[result.problem]);
  return ok(normalizePassword(password));
}

export class AccountService {
  readonly #store: AccountStore;
  readonly #hasher: PasswordHasher;
  readonly #secrets: readonly string[];
  readonly #now: () => number;
  readonly #limits: RateLimiters;
  readonly #listeners: DeletionListener[] = [];

  constructor(options: ServiceOptions) {
    if (options.ticketSecrets.length === 0) throw new Error('Aucune clé de ticket fournie.');
    this.#store = options.store;
    this.#hasher = options.hasher;
    this.#secrets = options.ticketSecrets;
    this.#now = options.now ?? Date.now;
    this.#limits = options.limiters ?? {
      authPerAddress: new MemoryRateLimiter(RATE_RULES.authPerAddress, this.#now),
      guestPerAddress: new MemoryRateLimiter(RATE_RULES.guestPerAddress, this.#now),
      loginFailuresPerPseudo: new MemoryRateLimiter(RATE_RULES.loginFailuresPerPseudo, this.#now),
    };
  }

  /** Appelé après chaque suppression de compte (pas pour la purge des invités inactifs). */
  onAccountDeleted(listener: DeletionListener): () => void {
    this.#listeners.push(listener);
    return () => {
      const index = this.#listeners.indexOf(listener);
      if (index >= 0) this.#listeners.splice(index, 1);
    };
  }

  // --- Sessions -----------------------------------------------------------------------------

  /** Session du jeton, prolongée si besoin ; `null` si le jeton est absent, inconnu ou expiré. */
  async authenticate(token: string | undefined): Promise<Authenticated | null> {
    if (token === undefined || !isWellFormedToken(token)) return null;
    const digest = tokenDigest(token);
    const session = await this.#store.findSession(digest);
    if (session === null) return null;
    const now = this.#now();
    if (session.expiresAt <= now) {
      await this.#store.deleteSession(digest);
      return null;
    }
    let account = await this.#store.findAccountById(session.accountId);
    if (account === null) {
      await this.#store.deleteSession(digest);
      return null;
    }
    let current = session;
    let extended = false;
    if (session.expiresAt - now <= SESSION_TTL_MS - SESSION_EXTEND_EVERY_MS) {
      current = { ...session, expiresAt: now + SESSION_TTL_MS };
      await this.#store.extendSession(digest, current.expiresAt);
      await this.#store.updateAccount(account.id, { lastSeenAt: now });
      account = { ...account, lastSeenAt: now };
      extended = true;
    }
    return { account, session: current, view: toView(account), extended };
  }

  async #openSession(account: AccountRecord): Promise<SessionGrant> {
    const token = newSessionToken();
    const now = this.#now();
    const expiresAt = now + SESSION_TTL_MS;
    await this.#store.createSession(
      { tokenDigest: tokenDigest(token), accountId: account.id, createdAt: now, expiresAt },
      MAX_SESSIONS_PER_ACCOUNT,
    );
    return { account: toView(account), token, expiresAt };
  }

  /** Ferme la session courante avant d'en ouvrir une autre ; un invité est effacé. */
  async #leave(currentToken: string | undefined): Promise<void> {
    const current = await this.authenticate(currentToken);
    if (current === null) return;
    if (current.account.guest) await this.#store.deleteAccount(current.account.id);
    else await this.#store.deleteSession(current.session.tokenDigest);
  }

  // --- Parcours -----------------------------------------------------------------------------

  createGuest(
    pseudo: unknown,
    address: string,
    currentToken?: string,
  ): Promise<Outcome<SessionGrant>> {
    return this.#guarded(async () => {
      const wait = this.#limits.guestPerAddress.hit(address);
      if (wait > 0) return limited(wait);
      let chosen = { pseudo: generateGuestPseudo(), key: '' };
      if (pseudo !== undefined) {
        const checked = checkPseudo(pseudo);
        if (!checked.ok) return checked;
        if ((await this.#store.findAccountByKey(checked.value.key)) !== null) {
          return failure('pseudo_taken');
        }
        chosen = checked.value;
      }
      const now = this.#now();
      const account: AccountRecord = {
        id: randomUUID(),
        pseudo: chosen.pseudo,
        pseudoKey: chosen.key === '' ? pseudoKey(chosen.pseudo) : chosen.key,
        guest: true,
        passwordHash: null,
        favoriteFighter: null,
        matchesPlayed: 0,
        wins: 0,
        createdAt: now,
        lastSeenAt: now,
      };
      await this.#store.createAccount(account);
      await this.#leave(currentToken);
      return ok(await this.#openSession(account));
    });
  }

  register(
    pseudo: unknown,
    password: unknown,
    address: string,
    currentToken?: string,
  ): Promise<Outcome<SessionGrant>> {
    return this.#guarded(async () => {
      const wait = this.#limits.authPerAddress.hit(address);
      if (wait > 0) return limited(wait);
      const name = checkPseudo(pseudo);
      if (!name.ok) return name;
      const secret = checkPassword(password, name.value.pseudo);
      if (!secret.ok) return secret;
      // Vérifié avant le hachage pour répondre vite ; la base garantit l'unicité de toute façon.
      if ((await this.#store.findAccountByKey(name.value.key)) !== null) {
        return failure('pseudo_taken');
      }
      const passwordHash = await this.#hasher.hash(secret.value);
      const now = this.#now();
      const account: AccountRecord = {
        id: randomUUID(),
        pseudo: name.value.pseudo,
        pseudoKey: name.value.key,
        guest: false,
        passwordHash,
        favoriteFighter: null,
        matchesPlayed: 0,
        wins: 0,
        createdAt: now,
        lastSeenAt: now,
      };
      try {
        await this.#store.createAccount(account);
      } catch (error) {
        if (error instanceof PseudoTakenError) return failure('pseudo_taken');
        throw error;
      }
      await this.#leave(currentToken);
      return ok(await this.#openSession(account));
    });
  }

  convert(
    auth: Authenticated,
    pseudo: unknown,
    password: unknown,
    address: string,
  ): Promise<Outcome<SessionGrant>> {
    return this.#guarded(async () => {
      const wait = this.#limits.authPerAddress.hit(address);
      if (wait > 0) return limited(wait);
      if (!auth.account.guest) return failure('not_a_guest');
      const name = checkPseudo(pseudo);
      if (!name.ok) return name;
      const secret = checkPassword(password, name.value.pseudo);
      if (!secret.ok) return secret;
      if ((await this.#store.findAccountByKey(name.value.key)) !== null) {
        return failure('pseudo_taken');
      }
      const passwordHash = await this.#hasher.hash(secret.value);
      const changes: AccountChanges = {
        guest: false,
        pseudo: name.value.pseudo,
        pseudoKey: name.value.key,
        passwordHash,
        lastSeenAt: this.#now(),
      };
      try {
        await this.#store.updateAccount(auth.account.id, changes);
      } catch (error) {
        if (error instanceof PseudoTakenError) return failure('pseudo_taken');
        throw error;
      }
      // Nouveau jeton : celui de l'invité ne vaut plus rien (pas de fixation de session).
      await this.#store.deleteSessionsOf(auth.account.id);
      return ok(await this.#openSession({ ...auth.account, ...changes }));
    });
  }

  login(
    pseudo: unknown,
    password: unknown,
    address: string,
    currentToken?: string,
  ): Promise<Outcome<SessionGrant>> {
    return this.#guarded(async () => {
      const wait = this.#limits.authPerAddress.hit(address);
      if (wait > 0) return limited(wait);
      if (typeof pseudo !== 'string' || typeof password !== 'string') {
        return failure('invalid_credentials');
      }
      // Les règles des pseudos ne sont pas appliquées ici : un compte créé avant un ajout à la
      // liste des mots interdits doit pouvoir se connecter.
      const key = pseudoKey(pseudo.slice(0, MAX_PSEUDO_INPUT));
      const blocked = this.#limits.loginFailuresPerPseudo.peek(key);
      if (blocked > 0) return limited(blocked);
      const secret = normalizePassword(password);
      if ([...secret].length > PASSWORD_MAX || normalizePseudo(pseudo).length > MAX_PSEUDO_INPUT) {
        return failure('invalid_credentials');
      }
      const account = await this.#store.findAccountByKey(key);
      // Même calcul, donc même durée, que le compte existe ou non.
      const valid = await this.#hasher.verify(secret, account?.passwordHash ?? null);
      if (account === null || !valid) {
        this.#limits.loginFailuresPerPseudo.hit(key);
        return failure('invalid_credentials');
      }
      this.#limits.loginFailuresPerPseudo.reset(key);
      if (account.passwordHash !== null && this.#hasher.needsRehash(account.passwordHash)) {
        await this.#rehash(account.id, secret);
      }
      await this.#leave(currentToken);
      const now = this.#now();
      await this.#store.updateAccount(account.id, { lastSeenAt: now });
      return ok(await this.#openSession({ ...account, lastSeenAt: now }));
    });
  }

  async #rehash(accountId: string, password: string): Promise<void> {
    try {
      await this.#store.updateAccount(accountId, {
        passwordHash: await this.#hasher.hash(password),
      });
    } catch (error) {
      // Recalcul de confort : s'il échoue (serveur occupé), il sera retenté à la connexion suivante.
      if (!(error instanceof HasherBusyError)) throw error;
    }
  }

  /** Ferme la session ; un invité qui se déconnecte est effacé. */
  async logout(auth: Authenticated): Promise<void> {
    if (auth.account.guest) await this.#store.deleteAccount(auth.account.id);
    else await this.#store.deleteSession(auth.session.tokenDigest);
  }

  updateProfile(auth: Authenticated, changes: ProfileRequest): Promise<Outcome<AccountView>> {
    return this.#guarded(async () => {
      const update: { -readonly [K in keyof AccountChanges]: AccountChanges[K] } = {};
      if (changes.pseudo !== undefined) {
        const name = checkPseudo(changes.pseudo);
        if (!name.ok) return name;
        update.pseudo = name.value.pseudo;
        update.pseudoKey = name.value.key;
      }
      if (changes.favoriteFighter !== undefined) {
        const fighter = changes.favoriteFighter;
        if (fighter !== null && (typeof fighter !== 'string' || !isFighterId(fighter))) {
          return failure('invalid_fighter');
        }
        update.favoriteFighter = fighter;
      }
      if (update.pseudoKey !== undefined && auth.account.guest) {
        // Un invité ne prend jamais le pseudo d'un compte ; la base ne le vérifie que pour les comptes.
        if ((await this.#store.findAccountByKey(update.pseudoKey)) !== null) {
          return failure('pseudo_taken');
        }
      }
      try {
        await this.#store.updateAccount(auth.account.id, update);
      } catch (error) {
        if (error instanceof PseudoTakenError) return failure('pseudo_taken');
        throw error;
      }
      return ok(toView({ ...auth.account, ...update }));
    });
  }

  changePassword(
    auth: Authenticated,
    current: unknown,
    next: unknown,
    address: string,
  ): Promise<Outcome<void>> {
    return this.#guarded(async () => {
      if (auth.account.guest) return failure('guest_not_allowed');
      const proof = await this.#checkOwnPassword(auth.account, current, address);
      if (!proof.ok) return proof;
      const secret = checkPassword(next, auth.account.pseudo);
      if (!secret.ok) return secret;
      const passwordHash = await this.#hasher.hash(secret.value);
      await this.#store.updateAccount(auth.account.id, { passwordHash });
      // Un voleur de session ou de mot de passe perd l'accès ; cette session-ci reste ouverte.
      await this.#store.deleteSessionsOf(auth.account.id, auth.session.tokenDigest);
      return ok(undefined);
    });
  }

  deleteAccount(auth: Authenticated, password: unknown, address: string): Promise<Outcome<void>> {
    return this.#guarded(async () => {
      if (!auth.account.guest) {
        const proof = await this.#checkOwnPassword(auth.account, password, address);
        if (!proof.ok) return proof;
      }
      await this.#store.deleteAccount(auth.account.id);
      for (const listener of [...this.#listeners]) {
        try {
          await listener(auth.account.id);
        } catch {
          // Un module en panne ne doit pas empêcher la suppression, déjà faite. Rien de
          // personnel dans le journal.
          console.error('accounts : un écouteur de suppression a échoué.');
        }
      }
      return ok(undefined);
    });
  }

  /** Vérifie le mot de passe du titulaire d'une session, avec les mêmes limites qu'une connexion. */
  async #checkOwnPassword(
    account: AccountRecord,
    password: unknown,
    address: string,
  ): Promise<Outcome<void>> {
    const wait = this.#limits.authPerAddress.hit(address);
    if (wait > 0) return limited(wait);
    const blocked = this.#limits.loginFailuresPerPseudo.peek(account.pseudoKey);
    if (blocked > 0) return limited(blocked);
    const secret = typeof password === 'string' ? normalizePassword(password) : '';
    const valid =
      typeof password === 'string' &&
      [...secret].length <= PASSWORD_MAX &&
      (await this.#hasher.verify(secret, account.passwordHash));
    if (!valid) {
      this.#limits.loginFailuresPerPseudo.hit(account.pseudoKey);
      return failure('invalid_credentials');
    }
    return ok(undefined);
  }

  issueTicket(auth: Authenticated, audience: unknown): Outcome<TicketResponse> {
    if (!isAudience(audience)) return failure('invalid_audience');
    const { ticket, claims } = signTicket(
      { sub: auth.account.id, name: auth.account.pseudo, guest: auth.account.guest, aud: audience },
      { secret: this.#secrets[0]!, now: this.#now() },
    );
    return ok({ ticket, expiresAt: claims.exp });
  }

  /**
   * Pseudo actuel et marqueur invité des comptes existants, pour l'affichage par `ranking` ; les
   * identifiants inconnus sont absents du résultat.
   */
  async publicNames(
    ids: readonly string[],
  ): Promise<Map<string, { pseudo: string; guest: boolean }>> {
    const result = new Map<string, { pseudo: string; guest: boolean }>();
    for (const id of new Set(ids)) {
      const account = await this.#store.findAccountById(id);
      if (account !== null) result.set(id, { pseudo: account.pseudo, guest: account.guest });
    }
    return result;
  }

  /** Ajoute un match aux statistiques. Pour `ranking`, hébergé dans le même processus. */
  recordMatch(accountId: string, won: boolean): Promise<boolean> {
    return this.#store.recordMatch(accountId, won);
  }

  /** Sessions expirées et invités inactifs. À appeler régulièrement. */
  purge(): Promise<PurgeResult> {
    const now = this.#now();
    for (const limiter of Object.values(this.#limits)) {
      if (limiter instanceof MemoryRateLimiter) limiter.sweep();
    }
    return this.#store.purge(now, now - GUEST_IDLE_MS);
  }

  /** Transforme « file de hachage pleine » en réponse `server_busy`. */
  async #guarded<T>(work: () => Promise<Outcome<T>>): Promise<Outcome<T>> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HasherBusyError) return failure('server_busy');
      throw error;
    }
  }
}
