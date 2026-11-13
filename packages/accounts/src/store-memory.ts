/**
 * Stockage en mémoire : pour les tests, et comme seconde implémentation qui prouve que
 * l'interface ne dépend pas de SQLite. Tout est perdu à l'arrêt du processus.
 */
import {
  PseudoTakenError,
  type AccountChanges,
  type AccountRecord,
  type AccountStore,
  type PurgeResult,
  type SessionRecord,
} from './store.ts';

export function createMemoryStore(): AccountStore {
  const accounts = new Map<string, AccountRecord>();
  const sessions = new Map<string, SessionRecord>();

  function keyTaken(key: string, exceptId: string): boolean {
    for (const a of accounts.values()) {
      if (!a.guest && a.pseudoKey === key && a.id !== exceptId) return true;
    }
    return false;
  }

  function sessionsOf(accountId: string): SessionRecord[] {
    return [...sessions.values()].filter((s) => s.accountId === accountId);
  }

  function removeAccount(id: string): boolean {
    for (const s of sessionsOf(id)) sessions.delete(s.tokenDigest);
    return accounts.delete(id);
  }

  // Les enregistrements sont copiés à l'entrée et à la sortie : comme une vraie base, le
  // stockage ne partage aucun objet avec l'appelant.
  const copy = <T extends object>(value: T | undefined): T | null =>
    value === undefined ? null : { ...value };

  return {
    async createAccount(account) {
      if (!account.guest && keyTaken(account.pseudoKey, account.id)) throw new PseudoTakenError();
      accounts.set(account.id, { ...account });
    },
    async findAccountById(id) {
      return copy(accounts.get(id));
    },
    async findAccountByKey(key) {
      for (const a of accounts.values()) if (!a.guest && a.pseudoKey === key) return { ...a };
      return null;
    },
    async updateAccount(id, changes: AccountChanges) {
      const current = accounts.get(id);
      if (current === undefined) return false;
      const next = { ...current, ...changes };
      if (!next.guest && keyTaken(next.pseudoKey, id)) throw new PseudoTakenError();
      accounts.set(id, next);
      return true;
    },
    async deleteAccount(id) {
      return removeAccount(id);
    },
    async recordMatch(id, won) {
      const current = accounts.get(id);
      if (current === undefined) return false;
      accounts.set(id, {
        ...current,
        matchesPlayed: current.matchesPlayed + 1,
        wins: current.wins + (won ? 1 : 0),
      });
      return true;
    },

    async createSession(session, maxPerAccount) {
      sessions.set(session.tokenDigest, { ...session });
      const owned = sessionsOf(session.accountId).sort((a, b) => b.createdAt - a.createdAt);
      for (const old of owned.slice(maxPerAccount)) sessions.delete(old.tokenDigest);
    },
    async findSession(digest) {
      return copy(sessions.get(digest));
    },
    async extendSession(digest, expiresAt) {
      const current = sessions.get(digest);
      if (current !== undefined) sessions.set(digest, { ...current, expiresAt });
    },
    async deleteSession(digest) {
      sessions.delete(digest);
    },
    async deleteSessionsOf(accountId, except) {
      for (const s of sessionsOf(accountId)) {
        if (s.tokenDigest !== except) sessions.delete(s.tokenDigest);
      }
    },
    async countSessionsOf(accountId) {
      return sessionsOf(accountId).length;
    },

    async purge(now, guestSeenBefore): Promise<PurgeResult> {
      let guests = 0;
      for (const a of [...accounts.values()]) {
        if (a.guest && a.lastSeenAt < guestSeenBefore && removeAccount(a.id)) guests++;
      }
      let expired = 0;
      for (const s of [...sessions.values()]) {
        if (s.expiresAt <= now && sessions.delete(s.tokenDigest)) expired++;
      }
      return { sessions: expired, guests };
    },
    async close() {
      accounts.clear();
      sessions.clear();
    },
  };
}
