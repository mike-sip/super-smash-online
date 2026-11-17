/** Faux comptes pour les tests du service : noms, statistiques, suppressions, pannes à la demande. */
import type { AccountsPort } from '../src/service.ts';

export class FakeAccounts implements AccountsPort {
  readonly names = new Map<string, { pseudo: string; guest: boolean }>();
  readonly recorded: { id: string; won: boolean }[] = [];
  readonly #listeners: ((id: string) => void | Promise<void>)[] = [];
  /** Nombre d'appels à `recordMatch` qui vont encore échouer. */
  failRecords = 0;

  add(id: string, pseudo: string, guest = false): this {
    this.names.set(id, { pseudo, guest });
    return this;
  }

  async publicNames(ids: readonly string[]) {
    const result = new Map<string, { pseudo: string; guest: boolean }>();
    for (const id of ids) {
      const name = this.names.get(id);
      if (name !== undefined) result.set(id, { ...name });
    }
    return result;
  }

  async recordMatch(id: string, won: boolean): Promise<boolean> {
    if (this.failRecords > 0) {
      this.failRecords--;
      throw new Error('panne simulée des comptes');
    }
    if (!this.names.has(id)) return false;
    this.recorded.push({ id, won });
    return true;
  }

  onAccountDeleted(listener: (id: string) => void | Promise<void>): () => void {
    this.#listeners.push(listener);
    return () => {
      this.#listeners.splice(this.#listeners.indexOf(listener), 1);
    };
  }

  /** Supprime un compte comme le ferait `accounts`, écouteurs compris. */
  async delete(id: string): Promise<void> {
    this.names.delete(id);
    for (const listener of this.#listeners) await listener(id);
  }

  /** Efface un compte sans prévenir (purge d'invités, déconnexion d'un invité). */
  forget(id: string): void {
    this.names.delete(id);
  }
}
