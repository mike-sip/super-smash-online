/**
 * Suite de contrat de `AccountStore`, jouée sur chaque implémentation. Un nouveau stockage n'est
 * accepté que s'il la passe entière.
 */
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PseudoTakenError, type AccountRecord, type AccountStore } from '../src/store.ts';

const T0 = Date.UTC(2026, 10, 13);
const DAY = 86_400_000;

export function account(overrides: Partial<AccountRecord> = {}): AccountRecord {
  const pseudo = overrides.pseudo ?? `Joueur${Math.floor(Math.random() * 1e6)}`;
  return {
    id: randomUUID(),
    pseudo,
    pseudoKey: pseudo.toLowerCase(),
    guest: false,
    passwordHash: 'scrypt$10$8$1$sel$empreinte',
    favoriteFighter: null,
    matchesPlayed: 0,
    wins: 0,
    createdAt: T0,
    lastSeenAt: T0,
    ...overrides,
  };
}

function session(accountId: string, digest: string, createdAt = T0, expiresAt = T0 + 30 * DAY) {
  return { tokenDigest: digest, accountId, createdAt, expiresAt };
}

export function storeContract(name: string, open: () => Promise<AccountStore>): void {
  describe(`contrat du stockage : ${name}`, () => {
    let store: AccountStore;
    beforeEach(async () => {
      store = await open();
    });
    afterEach(async () => {
      await store.close();
    });

    describe('comptes', () => {
      it('crée un compte et le relit par identifiant et par clé', async () => {
        const a = account({ pseudo: 'Élodie', pseudoKey: 'elodie', favoriteFighter: 'vanguard' });
        await store.createAccount(a);
        expect(await store.findAccountById(a.id)).toEqual(a);
        expect(await store.findAccountByKey('elodie')).toEqual(a);
        expect(await store.findAccountById(randomUUID())).toBeNull();
        expect(await store.findAccountByKey('personne')).toBeNull();
      });

      it('refuse deux comptes avec la même clé de pseudo', async () => {
        await store.createAccount(account({ pseudo: 'Max', pseudoKey: 'max' }));
        await expect(
          store.createAccount(account({ pseudo: 'MAX', pseudoKey: 'max' })),
        ).rejects.toBeInstanceOf(PseudoTakenError);
      });

      it('laisse plusieurs invités porter la même clé, et ne les trouve pas par clé', async () => {
        const guest = { guest: true, passwordHash: null, pseudo: 'Max', pseudoKey: 'max' };
        await store.createAccount(account(guest));
        await store.createAccount(account(guest));
        expect(await store.findAccountByKey('max')).toBeNull();
        // Un compte peut prendre une clé portée par des invités.
        const owner = account({ pseudo: 'Max', pseudoKey: 'max' });
        await store.createAccount(owner);
        expect((await store.findAccountByKey('max'))?.id).toBe(owner.id);
      });

      it('convertit un invité en compte en gardant son identifiant et son profil', async () => {
        const guest = account({
          guest: true,
          passwordHash: null,
          pseudo: 'Invité-00042',
          pseudoKey: 'invite-00042',
          favoriteFighter: 'zephyr',
        });
        await store.createAccount(guest);
        expect(
          await store.updateAccount(guest.id, {
            guest: false,
            pseudo: 'Zoë',
            pseudoKey: 'zoe',
            passwordHash: 'scrypt$x',
          }),
        ).toBe(true);
        expect(await store.findAccountById(guest.id)).toEqual({
          ...guest,
          guest: false,
          pseudo: 'Zoë',
          pseudoKey: 'zoe',
          passwordHash: 'scrypt$x',
        });
        expect((await store.findAccountByKey('zoe'))?.id).toBe(guest.id);
      });

      it('refuse une conversion ou un renommage vers une clé prise', async () => {
        await store.createAccount(account({ pseudo: 'Zoë', pseudoKey: 'zoe' }));
        const guest = account({ guest: true, passwordHash: null, pseudo: 'Zoe', pseudoKey: 'zoe' });
        await store.createAccount(guest);
        await expect(
          store.updateAccount(guest.id, { guest: false, passwordHash: 'scrypt$x' }),
        ).rejects.toBeInstanceOf(PseudoTakenError);
        expect((await store.findAccountById(guest.id))?.guest).toBe(true);

        const other = account({ pseudo: 'Autre', pseudoKey: 'autre' });
        await store.createAccount(other);
        await expect(
          store.updateAccount(other.id, { pseudo: 'ZOE', pseudoKey: 'zoe' }),
        ).rejects.toBeInstanceOf(PseudoTakenError);
        expect((await store.findAccountById(other.id))?.pseudo).toBe('Autre');
        // Changer la casse de son propre pseudo reste permis.
        expect(await store.updateAccount(other.id, { pseudo: 'AUTRE', pseudoKey: 'autre' })).toBe(
          true,
        );
      });

      it('met à jour le profil, et signale un compte inexistant', async () => {
        const a = account();
        await store.createAccount(a);
        await store.updateAccount(a.id, { favoriteFighter: 'vanguard', lastSeenAt: T0 + DAY });
        expect(await store.findAccountById(a.id)).toMatchObject({
          favoriteFighter: 'vanguard',
          lastSeenAt: T0 + DAY,
        });
        await store.updateAccount(a.id, { favoriteFighter: null });
        expect((await store.findAccountById(a.id))?.favoriteFighter).toBeNull();
        expect(await store.updateAccount(randomUUID(), { favoriteFighter: 'x' })).toBe(false);
      });

      it('compte les matchs et les victoires', async () => {
        const a = account();
        await store.createAccount(a);
        await store.recordMatch(a.id, true);
        await store.recordMatch(a.id, false);
        await store.recordMatch(a.id, true);
        expect(await store.findAccountById(a.id)).toMatchObject({ matchesPlayed: 3, wins: 2 });
        expect(await store.recordMatch(randomUUID(), true)).toBe(false);
      });

      it('supprime un compte avec ses sessions, et libère son pseudo', async () => {
        const a = account({ pseudo: 'Max', pseudoKey: 'max' });
        const b = account();
        await store.createAccount(a);
        await store.createAccount(b);
        await store.createSession(session(a.id, 'a1'), 10);
        await store.createSession(session(b.id, 'b1'), 10);
        expect(await store.deleteAccount(a.id)).toBe(true);
        expect(await store.findAccountById(a.id)).toBeNull();
        expect(await store.findSession('a1')).toBeNull();
        expect(await store.findSession('b1')).not.toBeNull();
        expect(await store.deleteAccount(a.id)).toBe(false);
        await store.createAccount(account({ pseudo: 'Max', pseudoKey: 'max' }));
      });

      it('ne laisse pas modifier un enregistrement rendu', async () => {
        const a = account();
        await store.createAccount(a);
        const read = (await store.findAccountById(a.id)) as { pseudo: string };
        read.pseudo = 'modifié';
        expect((await store.findAccountById(a.id))?.pseudo).toBe(a.pseudo);
      });
    });

    describe('sessions', () => {
      it('crée, retrouve, prolonge et supprime une session', async () => {
        const a = account();
        await store.createAccount(a);
        await store.createSession(session(a.id, 'jeton'), 10);
        expect(await store.findSession('jeton')).toEqual(session(a.id, 'jeton'));
        await store.extendSession('jeton', T0 + 60 * DAY);
        expect((await store.findSession('jeton'))?.expiresAt).toBe(T0 + 60 * DAY);
        await store.deleteSession('jeton');
        expect(await store.findSession('jeton')).toBeNull();
        expect(await store.findSession('inconnu')).toBeNull();
      });

      it('ferme les plus anciennes sessions au-delà du plafond', async () => {
        const a = account();
        await store.createAccount(a);
        for (let i = 0; i < 5; i++) {
          await store.createSession(session(a.id, `s${i}`, T0 + i * 1000), 3);
        }
        expect(await store.countSessionsOf(a.id)).toBe(3);
        expect(await store.findSession('s0')).toBeNull();
        expect(await store.findSession('s1')).toBeNull();
        expect(await store.findSession('s4')).not.toBeNull();
      });

      it('ferme toutes les sessions d’un compte, sauf une au besoin', async () => {
        const a = account();
        const b = account();
        await store.createAccount(a);
        await store.createAccount(b);
        for (const digest of ['a1', 'a2', 'a3'])
          await store.createSession(session(a.id, digest), 10);
        await store.createSession(session(b.id, 'b1'), 10);
        await store.deleteSessionsOf(a.id, 'a2');
        expect(await store.countSessionsOf(a.id)).toBe(1);
        expect(await store.findSession('a2')).not.toBeNull();
        await store.deleteSessionsOf(a.id);
        expect(await store.countSessionsOf(a.id)).toBe(0);
        expect(await store.findSession('b1')).not.toBeNull();
      });
    });

    describe('purge', () => {
      it('supprime les sessions expirées et les invités inactifs, rien d’autre', async () => {
        const active = account();
        const idleAccount = account({ lastSeenAt: T0 - 400 * DAY });
        const idleGuest = account({ guest: true, passwordHash: null, lastSeenAt: T0 - 31 * DAY });
        const recentGuest = account({ guest: true, passwordHash: null, lastSeenAt: T0 - DAY });
        for (const a of [active, idleAccount, idleGuest, recentGuest]) await store.createAccount(a);
        await store.createSession(session(active.id, 'expired', T0 - 40 * DAY, T0 - DAY), 10);
        await store.createSession(session(active.id, 'alive', T0, T0 + DAY), 10);
        await store.createSession(session(idleGuest.id, 'guest', T0 - 31 * DAY, T0 + DAY), 10);

        const result = await store.purge(T0, T0 - 30 * DAY);
        expect(result).toEqual({ sessions: 1, guests: 1 });
        expect(await store.findSession('expired')).toBeNull();
        expect(await store.findSession('alive')).not.toBeNull();
        expect(await store.findSession('guest')).toBeNull();
        expect(await store.findAccountById(idleGuest.id)).toBeNull();
        // Un vrai compte n'est jamais purgé, même inactif.
        expect(await store.findAccountById(idleAccount.id)).not.toBeNull();
        expect(await store.findAccountById(recentGuest.id)).not.toBeNull();
      });
    });
  });
}
