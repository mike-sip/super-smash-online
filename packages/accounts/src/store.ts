/**
 * Interface de stockage des comptes et des sessions. Asynchrone, pour qu'une base distante
 * puisse la remplir un jour ; deux implémentations aujourd'hui (mémoire, SQLite), qui passent la
 * même suite de contrat (`test/store-contract.ts`).
 *
 * Le stockage ne connaît aucune règle métier, sauf une, tenue par lui seul pour résister aux
 * requêtes simultanées : deux comptes (non invités) ne partagent jamais la même clé de pseudo.
 */

export interface AccountRecord {
  readonly id: string;
  readonly pseudo: string;
  /** Clé d'unicité du pseudo (voir `names.ts`). Unique parmi les comptes non invités. */
  readonly pseudoKey: string;
  readonly guest: boolean;
  /** Empreinte scrypt ; `null` pour un invité. */
  readonly passwordHash: string | null;
  readonly favoriteFighter: string | null;
  readonly matchesPlayed: number;
  readonly wins: number;
  /** Millisecondes Unix. */
  readonly createdAt: number;
  /** Dernière visite, en millisecondes Unix, à l'heure près (voir `service.ts`). */
  readonly lastSeenAt: number;
}

export type AccountChanges = Partial<
  Pick<
    AccountRecord,
    'pseudo' | 'pseudoKey' | 'guest' | 'passwordHash' | 'favoriteFighter' | 'lastSeenAt'
  >
>;

export interface SessionRecord {
  /** Empreinte SHA-256 du jeton ; le jeton lui-même n'est jamais stocké. */
  readonly tokenDigest: string;
  readonly accountId: string;
  /** Millisecondes Unix. */
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** Levée quand un compte prendrait la clé de pseudo d'un autre compte. */
export class PseudoTakenError extends Error {
  constructor() {
    super('Pseudo déjà pris.');
    this.name = 'PseudoTakenError';
  }
}

export interface PurgeResult {
  readonly sessions: number;
  readonly guests: number;
}

export interface AccountStore {
  /** Lève `PseudoTakenError` si le compte n'est pas un invité et que sa clé est prise. */
  createAccount(account: AccountRecord): Promise<void>;
  findAccountById(id: string): Promise<AccountRecord | null>;
  /** Compte non invité portant cette clé de pseudo. */
  findAccountByKey(pseudoKey: string): Promise<AccountRecord | null>;
  /**
   * Modifie un compte ; renvoie faux s'il n'existe pas. Lève `PseudoTakenError` si le compte,
   * une fois modifié, n'est pas un invité et que sa clé est prise par un autre.
   */
  updateAccount(id: string, changes: AccountChanges): Promise<boolean>;
  /** Supprime le compte et toutes ses sessions ; renvoie faux s'il n'existait pas. */
  deleteAccount(id: string): Promise<boolean>;
  /** Ajoute un match aux statistiques ; renvoie faux si le compte n'existe pas. */
  recordMatch(id: string, won: boolean): Promise<boolean>;

  /** Ajoute une session ; au-delà de `maxPerAccount`, les plus anciennes du compte sont fermées. */
  createSession(session: SessionRecord, maxPerAccount: number): Promise<void>;
  findSession(tokenDigest: string): Promise<SessionRecord | null>;
  extendSession(tokenDigest: string, expiresAt: number): Promise<void>;
  deleteSession(tokenDigest: string): Promise<void>;
  /** Ferme toutes les sessions du compte, sauf éventuellement une. */
  deleteSessionsOf(accountId: string, except?: string): Promise<void>;
  countSessionsOf(accountId: string): Promise<number>;

  /**
   * Supprime les sessions expirées à `now` et les invités dont la dernière visite est antérieure
   * à `guestSeenBefore`, avec leurs sessions.
   */
  purge(now: number, guestSeenBefore: number): Promise<PurgeResult>;
  close(): Promise<void>;
}
