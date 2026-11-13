/**
 * Stockage SQLite par `node:sqlite` : un fichier, un seul processus, simple à sauvegarder
 * (copie du fichier à l'arrêt, ou `VACUUM INTO` à chaud). Requêtes préparées uniquement.
 *
 * Le schéma évolue par migrations numérotées ; `PRAGMA user_version` note la dernière appliquée.
 */
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import {
  PseudoTakenError,
  type AccountChanges,
  type AccountRecord,
  type AccountStore,
  type SessionRecord,
} from './store.ts';

/** Chaque entrée fait passer le schéma de la version `index` à `index + 1`. Ne jamais modifier une entrée publiée : en ajouter une. */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE accounts (
     id               TEXT PRIMARY KEY,
     pseudo           TEXT NOT NULL,
     pseudo_key       TEXT NOT NULL,
     guest            INTEGER NOT NULL CHECK (guest IN (0, 1)),
     password_hash    TEXT,
     favorite_fighter TEXT,
     matches_played   INTEGER NOT NULL DEFAULT 0,
     wins             INTEGER NOT NULL DEFAULT 0,
     created_at       INTEGER NOT NULL,
     last_seen_at     INTEGER NOT NULL
   ) STRICT;
   -- Unicité des pseudos parmi les comptes ; les invités peuvent partager le leur.
   CREATE UNIQUE INDEX accounts_pseudo_key ON accounts (pseudo_key) WHERE guest = 0;
   CREATE INDEX accounts_idle_guests ON accounts (last_seen_at) WHERE guest = 1;
   CREATE TABLE sessions (
     token_digest TEXT PRIMARY KEY,
     account_id   TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
     created_at   INTEGER NOT NULL,
     expires_at   INTEGER NOT NULL
   ) STRICT;
   CREATE INDEX sessions_account ON sessions (account_id, created_at);
   CREATE INDEX sessions_expiry ON sessions (expires_at);`,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

interface AccountRow {
  id: string;
  pseudo: string;
  pseudo_key: string;
  guest: number;
  password_hash: string | null;
  favorite_fighter: string | null;
  matches_played: number;
  wins: number;
  created_at: number;
  last_seen_at: number;
}

interface SessionRow {
  token_digest: string;
  account_id: string;
  created_at: number;
  expires_at: number;
}

function toAccount(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    pseudo: row.pseudo,
    pseudoKey: row.pseudo_key,
    guest: row.guest === 1,
    passwordHash: row.password_hash,
    favoriteFighter: row.favorite_fighter,
    matchesPlayed: row.matches_played,
    wins: row.wins,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

function toSession(row: SessionRow): SessionRecord {
  return {
    tokenDigest: row.token_digest,
    accountId: row.account_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/** Colonnes modifiables par `updateAccount`, et leur nom en base. */
const COLUMNS: Readonly<Record<keyof AccountChanges, string>> = {
  pseudo: 'pseudo',
  pseudoKey: 'pseudo_key',
  guest: 'guest',
  passwordHash: 'password_hash',
  favoriteFighter: 'favorite_fighter',
  lastSeenAt: 'last_seen_at',
};

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error && /UNIQUE constraint failed: accounts\.pseudo_key/.test(error.message)
  );
}

function migrate(db: DatabaseSync): void {
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `Base des comptes en version ${version}, plus récente que ce serveur (${SCHEMA_VERSION}).`,
    );
  }
  for (let v = version; v < SCHEMA_VERSION; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

/** Ouvre (ou crée) une base. `':memory:'` donne une base éphémère. */
export function openSqliteStore(path: string): AccountStore {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }

  const statements = new Map<string, StatementSync>();
  /** Requête préparée une fois, réutilisée ensuite. */
  const sql = (text: string): StatementSync => {
    let statement = statements.get(text);
    if (statement === undefined) {
      statement = db.prepare(text);
      statements.set(text, statement);
    }
    return statement;
  };

  function transaction<T>(work: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    async createAccount(a) {
      try {
        sql(
          `INSERT INTO accounts (id, pseudo, pseudo_key, guest, password_hash, favorite_fighter,
             matches_played, wins, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          a.id,
          a.pseudo,
          a.pseudoKey,
          a.guest ? 1 : 0,
          a.passwordHash,
          a.favoriteFighter,
          a.matchesPlayed,
          a.wins,
          a.createdAt,
          a.lastSeenAt,
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw new PseudoTakenError();
        throw error;
      }
    },
    async findAccountById(id) {
      const row = sql('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
      return row === undefined ? null : toAccount(row);
    },
    async findAccountByKey(key) {
      const row = sql('SELECT * FROM accounts WHERE pseudo_key = ? AND guest = 0').get(key) as
        AccountRow | undefined;
      return row === undefined ? null : toAccount(row);
    },
    async updateAccount(id, changes) {
      // Les noms de colonnes viennent de COLUMNS, jamais de l'appelant ; les valeurs sont liées.
      const entries = (Object.keys(COLUMNS) as (keyof AccountChanges)[])
        .filter((field) => changes[field] !== undefined)
        .map((field) => {
          const value = changes[field];
          return [COLUMNS[field], typeof value === 'boolean' ? (value ? 1 : 0) : value] as const;
        });
      if (entries.length === 0) {
        return sql('SELECT 1 FROM accounts WHERE id = ?').get(id) !== undefined;
      }
      const assignments = entries.map(([column]) => `${column} = ?`).join(', ');
      const values = entries.map(([, value]) => value as SQLInputValue);
      try {
        const result = sql(`UPDATE accounts SET ${assignments} WHERE id = ?`).run(...values, id);
        return result.changes > 0;
      } catch (error) {
        if (isUniqueViolation(error)) throw new PseudoTakenError();
        throw error;
      }
    },
    async deleteAccount(id) {
      return sql('DELETE FROM accounts WHERE id = ?').run(id).changes > 0;
    },
    async recordMatch(id, won) {
      return (
        sql(
          'UPDATE accounts SET matches_played = matches_played + 1, wins = wins + ? WHERE id = ?',
        ).run(won ? 1 : 0, id).changes > 0
      );
    },

    async createSession(s, maxPerAccount) {
      transaction(() => {
        sql(
          'INSERT INTO sessions (token_digest, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
        ).run(s.tokenDigest, s.accountId, s.createdAt, s.expiresAt);
        sql(
          `DELETE FROM sessions WHERE account_id = ? AND token_digest NOT IN (
             SELECT token_digest FROM sessions WHERE account_id = ?
             ORDER BY created_at DESC, rowid DESC LIMIT ?)`,
        ).run(s.accountId, s.accountId, maxPerAccount);
      });
    },
    async findSession(digest) {
      const row = sql('SELECT * FROM sessions WHERE token_digest = ?').get(digest) as
        SessionRow | undefined;
      return row === undefined ? null : toSession(row);
    },
    async extendSession(digest, expiresAt) {
      sql('UPDATE sessions SET expires_at = ? WHERE token_digest = ?').run(expiresAt, digest);
    },
    async deleteSession(digest) {
      sql('DELETE FROM sessions WHERE token_digest = ?').run(digest);
    },
    async deleteSessionsOf(accountId, except) {
      sql('DELETE FROM sessions WHERE account_id = ? AND token_digest IS NOT ?').run(
        accountId,
        except ?? null,
      );
    },
    async countSessionsOf(accountId) {
      const row = sql('SELECT COUNT(*) AS n FROM sessions WHERE account_id = ?').get(accountId) as {
        n: number;
      };
      return row.n;
    },

    async purge(now, guestSeenBefore) {
      return transaction(() => {
        const guests = sql('DELETE FROM accounts WHERE guest = 1 AND last_seen_at < ?').run(
          guestSeenBefore,
        ).changes;
        const sessions = sql('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes;
        return { sessions: Number(sessions), guests: Number(guests) };
      });
    },
    async close() {
      if (db.isOpen) db.close();
    },
  };
}
