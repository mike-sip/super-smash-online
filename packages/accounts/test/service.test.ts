import { beforeEach, describe, expect, it } from 'vitest';
import { PasswordHasher } from '../src/hashing.ts';
import {
  AccountService,
  GUEST_IDLE_MS,
  MAX_SESSIONS_PER_ACCOUNT,
  SESSION_TTL_MS,
  type Outcome,
  type SessionGrant,
} from '../src/service.ts';
import { createMemoryStore } from '../src/store-memory.ts';
import type { AccountStore } from '../src/store.ts';
import { verifyTicket } from '../src/ticket.ts';
import { tokenDigest } from '../src/tokens.ts';

const SECRET = 'cle-de-ticket-pour-les-tests-0123456789';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const IP = '203.0.113.7';

let now: number;
let store: AccountStore;
let service: AccountService;

function value<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`Échec inattendu : ${outcome.error}`);
  return outcome.value;
}

function error<T>(outcome: Outcome<T>): string {
  if (outcome.ok) throw new Error('Succès inattendu');
  return outcome.error;
}

async function session(grant: SessionGrant) {
  const auth = await service.authenticate(grant.token);
  if (auth === null) throw new Error('Session introuvable');
  return auth;
}

beforeEach(() => {
  now = Date.UTC(2026, 10, 13, 12);
  store = createMemoryStore();
  service = new AccountService({
    store,
    hasher: new PasswordHasher({ logN: 10, r: 8, p: 1 }),
    ticketSecrets: [SECRET],
    now: () => now,
  });
});

describe('invités', () => {
  it('crée une session invité avec un pseudo tiré au hasard', async () => {
    const grant = value(await service.createGuest(undefined, IP));
    expect(grant.account.guest).toBe(true);
    expect(grant.account.pseudo).toMatch(/^Invité-\d{5}$/);
    expect(grant.account.stats).toEqual({ matchesPlayed: 0, wins: 0 });
    expect(grant.account.createdAt).toBe(new Date(now).toISOString());
    expect(grant.expiresAt).toBe(now + SESSION_TTL_MS);
    // Le jeton n'est stocké que par son empreinte.
    expect(await store.findSession(grant.token)).toBeNull();
    expect(await store.findSession(tokenDigest(grant.token))).not.toBeNull();
  });

  it('accepte un pseudo choisi, validé, que d’autres invités peuvent porter', async () => {
    const a = value(await service.createGuest('  Zoë ', IP));
    expect(a.account.pseudo).toBe('Zoë');
    expect(value(await service.createGuest('zoe', IP)).account.pseudo).toBe('zoe');
    expect(error(await service.createGuest('ab', IP))).toBe('invalid_pseudo');
    expect(error(await service.createGuest('Invité-1', IP))).toBe('invalid_pseudo');
  });

  it('refuse à un invité le pseudo d’un compte', async () => {
    value(await service.register('Élodie', 'tartiflette', IP));
    expect(error(await service.createGuest('elodie', IP))).toBe('pseudo_taken');
  });

  it('efface l’invité à sa déconnexion', async () => {
    const grant = value(await service.createGuest(undefined, IP));
    await service.logout(await session(grant));
    expect(await service.authenticate(grant.token)).toBeNull();
    expect(await store.findAccountById(grant.account.id)).toBeNull();
  });

  it('limite les créations d’invités par adresse', async () => {
    for (let i = 0; i < 30; i++) value(await service.createGuest(undefined, IP));
    const refused = await service.createGuest(undefined, IP);
    expect(refused).toMatchObject({ ok: false, error: 'rate_limited' });
    expect(!refused.ok && refused.retryAfter).toBeGreaterThan(0);
    // Une autre adresse n'est pas touchée.
    value(await service.createGuest(undefined, '198.51.100.1'));
  });
});

describe('inscription et connexion', () => {
  it('inscrit un compte et le connecte', async () => {
    const grant = value(await service.register('Élodie', 'tartiflette', IP));
    expect(grant.account).toMatchObject({ pseudo: 'Élodie', guest: false, favoriteFighter: null });
    const stored = await store.findAccountById(grant.account.id);
    expect(stored?.passwordHash).toMatch(/^scrypt\$/);
    expect(stored?.passwordHash).not.toContain('tartiflette');

    const login = value(await service.login('ELODIE', 'tartiflette', IP));
    expect(login.account.id).toBe(grant.account.id);
    expect(login.token).not.toBe(grant.token);
  });

  it('refuse un pseudo invalide, pris, ou un mot de passe faible, avec la raison', async () => {
    const bad = await service.register('a', 'tartiflette', IP);
    expect(bad).toMatchObject({ ok: false, error: 'invalid_pseudo' });
    expect(!bad.ok && bad.message).toContain('3 à 16');
    value(await service.register('Élodie', 'tartiflette', IP));
    expect(error(await service.register('elodie', 'autre-mot-de-passe', IP))).toBe('pseudo_taken');
    const weak = await service.register('Marius', 'password', IP);
    expect(weak).toMatchObject({ ok: false, error: 'invalid_password' });
    expect(!weak.ok && weak.message).toContain('courant');
    expect(error(await service.register('Marius', 'marius', IP))).toBe('invalid_password');
  });

  it('donne la même réponse pour un pseudo inconnu et un mauvais mot de passe', async () => {
    value(await service.register('Élodie', 'tartiflette', IP));
    const unknown = await service.login('Personne', 'tartiflette', IP);
    const wrong = await service.login('Élodie', 'raclette!', IP);
    expect(unknown).toEqual(wrong);
    expect(error(wrong)).toBe('invalid_credentials');
  });

  it('refuse la connexion à un invité, qui n’a pas de mot de passe', async () => {
    value(await service.createGuest('Zoë', IP));
    expect(error(await service.login('Zoë', '', IP))).toBe('invalid_credentials');
    expect(error(await service.login('Zoë', 'tartiflette', IP))).toBe('invalid_credentials');
  });

  it('bloque un pseudo après 10 échecs, quelle que soit l’adresse, et oublie après succès', async () => {
    value(await service.register('Élodie', 'tartiflette', IP));
    for (let i = 0; i < 10; i++) {
      expect(error(await service.login('Élodie', `mauvais-${i}`, `198.51.100.${i}`))).toBe(
        'invalid_credentials',
      );
    }
    // Même le bon mot de passe est refusé tant que le pseudo est bloqué.
    const blocked = await service.login('elodie', 'tartiflette', '192.0.2.1');
    expect(blocked).toMatchObject({ ok: false, error: 'rate_limited' });
    expect(!blocked.ok && blocked.retryAfter).toBeGreaterThan(0);
    now += 15 * 60_000;
    value(await service.login('Élodie', 'tartiflette', IP));
    // Le succès remet le compteur à zéro.
    for (let i = 0; i < 9; i++) await service.login('Élodie', 'mauvais', '192.0.2.2');
    value(await service.login('Élodie', 'tartiflette', '192.0.2.2'));
  });

  it('limite les tentatives d’authentification par adresse', async () => {
    for (let i = 0; i < 20; i++) await service.login(`Joueur${i}`, 'tartiflette', IP);
    expect(error(await service.login('Autre', 'tartiflette', IP))).toBe('rate_limited');
    expect(error(await service.register('Nouveau', 'tartiflette', IP))).toBe('rate_limited');
  });

  it('efface l’invité courant qui se connecte à un compte', async () => {
    value(await service.register('Élodie', 'tartiflette', IP));
    const guest = value(await service.createGuest(undefined, IP));
    value(await service.login('Élodie', 'tartiflette', IP, guest.token));
    expect(await store.findAccountById(guest.account.id)).toBeNull();
  });

  it('ferme la session de compte courante quand on se connecte à un autre', async () => {
    const first = value(await service.register('Élodie', 'tartiflette', IP));
    value(await service.register('Marius', 'pastis-bien-frais', IP));
    value(await service.login('Marius', 'pastis-bien-frais', IP, first.token));
    expect(await service.authenticate(first.token)).toBeNull();
    expect(await store.findAccountById(first.account.id)).not.toBeNull();
  });

  it('recalcule à la connexion une empreinte aux paramètres périmés', async () => {
    const old = await new PasswordHasher({ logN: 9, r: 8, p: 1 }).hash('tartiflette');
    const grant = value(await service.register('Élodie', 'tartiflette', IP));
    await store.updateAccount(grant.account.id, { passwordHash: old });
    value(await service.login('Élodie', 'tartiflette', IP));
    const rehashed = (await store.findAccountById(grant.account.id))?.passwordHash;
    expect(rehashed).toMatch(/^scrypt\$10\$/);
  });

  it('accepte un mot de passe tapé sous une autre forme Unicode', async () => {
    value(await service.register('Élodie', 'café-noir-serré', IP));
    value(await service.login('Élodie', 'café-noir-serré', IP));
  });
});

describe('conversion', () => {
  it('fait d’un invité un compte, même identifiant, profil gardé, nouveau jeton', async () => {
    const guest = value(await service.createGuest(undefined, IP));
    value(await service.updateProfile(await session(guest), { favoriteFighter: 'zephyr' }));
    const converted = value(await service.convert(await session(guest), 'Zoë', 'tartiflette', IP));
    expect(converted.account).toMatchObject({
      id: guest.account.id,
      pseudo: 'Zoë',
      guest: false,
      favoriteFighter: 'zephyr',
    });
    expect(converted.token).not.toBe(guest.token);
    expect(await service.authenticate(guest.token)).toBeNull();
    expect(value(await service.login('zoe', 'tartiflette', IP)).account.id).toBe(guest.account.id);
  });

  it('refuse de convertir un compte, un pseudo pris ou un mot de passe faible', async () => {
    const owner = value(await service.register('Élodie', 'tartiflette', IP));
    expect(error(await service.convert(await session(owner), 'Autre', 'tartiflette', IP))).toBe(
      'not_a_guest',
    );
    const guest = value(await service.createGuest(undefined, IP));
    expect(error(await service.convert(await session(guest), 'ELODIE', 'tartiflette', IP))).toBe(
      'pseudo_taken',
    );
    expect(error(await service.convert(await session(guest), 'Zoë', '12345678', IP))).toBe(
      'invalid_password',
    );
    // L'invité est intact après les refus.
    expect((await session(guest)).account.guest).toBe(true);
  });
});

describe('sessions', () => {
  it('expirent après 30 jours sans usage', async () => {
    const grant = value(await service.register('Élodie', 'tartiflette', IP));
    now += SESSION_TTL_MS + 1;
    expect(await service.authenticate(grant.token)).toBeNull();
    expect(await store.findSession(tokenDigest(grant.token))).toBeNull();
  });

  it('sont prolongées par l’usage, au plus une écriture par heure', async () => {
    const grant = value(await service.register('Élodie', 'tartiflette', IP));
    const digest = tokenDigest(grant.token);
    now += 30 * 60_000;
    await service.authenticate(grant.token);
    expect((await store.findSession(digest))?.expiresAt).toBe(grant.expiresAt);
    now += 31 * 60_000;
    await service.authenticate(grant.token);
    expect((await store.findSession(digest))?.expiresAt).toBe(now + SESSION_TTL_MS);
    expect((await store.findAccountById(grant.account.id))?.lastSeenAt).toBe(now);
    // Utilisée tous les 20 jours, elle ne meurt jamais.
    for (let i = 0; i < 5; i++) {
      now += 20 * DAY;
      expect(await service.authenticate(grant.token)).not.toBeNull();
    }
  });

  it('sont 10 au plus par compte', async () => {
    expect(MAX_SESSIONS_PER_ACCOUNT).toBe(10);
    const first = value(await service.register('Élodie', 'tartiflette', IP));
    for (let i = 0; i < 10; i++) {
      now += 1000;
      value(await service.login('Élodie', 'tartiflette', `192.0.2.${i}`));
    }
    expect(await store.countSessionsOf(first.account.id)).toBe(10);
    expect(await service.authenticate(first.token)).toBeNull();
  });

  it('ignorent un jeton mal formé ou inconnu', async () => {
    expect(await service.authenticate(undefined)).toBeNull();
    expect(await service.authenticate('')).toBeNull();
    expect(await service.authenticate('x'.repeat(43))).toBeNull();
    expect(await service.authenticate("'; DROP TABLE sessions; --")).toBeNull();
  });

  it('meurent à la déconnexion', async () => {
    const grant = value(await service.register('Élodie', 'tartiflette', IP));
    await service.logout(await session(grant));
    expect(await service.authenticate(grant.token)).toBeNull();
    expect(await store.findAccountById(grant.account.id)).not.toBeNull();
  });
});

describe('profil', () => {
  it('change le pseudo et le personnage favori', async () => {
    const grant = value(await service.register('Élodie', 'tartiflette', IP));
    const updated = value(
      await service.updateProfile(await session(grant), {
        pseudo: 'Elo_Dee',
        favoriteFighter: 'vanguard',
      }),
    );
    expect(updated).toMatchObject({ pseudo: 'Elo_Dee', favoriteFighter: 'vanguard' });
    value(await service.login('elo_dee', 'tartiflette', IP));
    expect(error(await service.login('Élodie', 'tartiflette', IP))).toBe('invalid_credentials');
    // L'ancien pseudo est libre.
    value(await service.register('Elodie', 'autre-mot-de-passe', IP));
    expect(
      value(await service.updateProfile(await session(grant), { favoriteFighter: null }))
        .favoriteFighter,
    ).toBeNull();
  });

  it('refuse un pseudo pris ou invalide, un personnage mal formé, sans rien modifier', async () => {
    value(await service.register('Marius', 'pastis-bien-frais', IP));
    const grant = value(await service.register('Élodie', 'tartiflette', IP));
    const s = await session(grant);
    expect(error(await service.updateProfile(s, { pseudo: 'MARIUS' }))).toBe('pseudo_taken');
    expect(error(await service.updateProfile(s, { pseudo: 'x' }))).toBe('invalid_pseudo');
    expect(
      error(await service.updateProfile(s, { pseudo: 'Nouveau', favoriteFighter: 'Pas Valide' })),
    ).toBe('invalid_fighter');
    expect((await store.findAccountById(grant.account.id))?.pseudo).toBe('Élodie');
    // Changer seulement la casse de son pseudo est permis.
    expect(value(await service.updateProfile(s, { pseudo: 'ÉLODIE' })).pseudo).toBe('ÉLODIE');
  });

  it('laisse un invité changer de pseudo, sauf pour celui d’un compte', async () => {
    value(await service.register('Marius', 'pastis-bien-frais', IP));
    const guest = value(await service.createGuest(undefined, IP));
    const s = await session(guest);
    expect(value(await service.updateProfile(s, { pseudo: 'Zoë' })).pseudo).toBe('Zoë');
    expect(error(await service.updateProfile(s, { pseudo: 'marius' }))).toBe('pseudo_taken');
  });

  it('compte les matchs pour ranking', async () => {
    const grant = value(await service.register('Élodie', 'tartiflette', IP));
    expect(await service.recordMatch(grant.account.id, true)).toBe(true);
    expect(await service.recordMatch(grant.account.id, false)).toBe(true);
    expect((await session(grant)).view.stats).toEqual({ matchesPlayed: 2, wins: 1 });
  });
});

describe('mot de passe', () => {
  it('se change avec l’ancien, et ferme les autres sessions', async () => {
    const here = value(await service.register('Élodie', 'tartiflette', IP));
    const elsewhere = value(await service.login('Élodie', 'tartiflette', IP));
    value(await service.changePassword(await session(here), 'tartiflette', 'raclette-fondue', IP));
    expect(await service.authenticate(here.token)).not.toBeNull();
    expect(await service.authenticate(elsewhere.token)).toBeNull();
    expect(error(await service.login('Élodie', 'tartiflette', IP))).toBe('invalid_credentials');
    value(await service.login('Élodie', 'raclette-fondue', IP));
  });

  it('refuse un ancien mot de passe faux, un nouveau trop faible, et les invités', async () => {
    const grant = value(await service.register('Élodie', 'tartiflette', IP));
    const s = await session(grant);
    expect(error(await service.changePassword(s, 'faux-mot', 'raclette-fondue', IP))).toBe(
      'invalid_credentials',
    );
    expect(error(await service.changePassword(s, 'tartiflette', 'court', IP))).toBe(
      'invalid_password',
    );
    const guest = value(await service.createGuest(undefined, IP));
    expect(error(await service.changePassword(await session(guest), '', 'raclette', IP))).toBe(
      'guest_not_allowed',
    );
  });
});

describe('suppression', () => {
  it('efface le compte, ses sessions, libère le pseudo et prévient les écouteurs', async () => {
    const deleted: string[] = [];
    service.onAccountDeleted((id) => {
      deleted.push(id);
    });
    const here = value(await service.register('Élodie', 'tartiflette', IP));
    const elsewhere = value(await service.login('Élodie', 'tartiflette', IP));
    value(await service.deleteAccount(await session(here), 'tartiflette', IP));
    expect(await store.findAccountById(here.account.id)).toBeNull();
    expect(await service.authenticate(here.token)).toBeNull();
    expect(await service.authenticate(elsewhere.token)).toBeNull();
    expect(deleted).toEqual([here.account.id]);
    value(await service.register('elodie', 'autre-mot-de-passe', IP));
  });

  it('exige le mot de passe d’un compte, pas celui d’un invité', async () => {
    const grant = value(await service.register('Élodie', 'tartiflette', IP));
    expect(error(await service.deleteAccount(await session(grant), 'faux', IP))).toBe(
      'invalid_credentials',
    );
    expect(error(await service.deleteAccount(await session(grant), undefined, IP))).toBe(
      'invalid_credentials',
    );
    expect(await store.findAccountById(grant.account.id)).not.toBeNull();
    const guest = value(await service.createGuest(undefined, IP));
    value(await service.deleteAccount(await session(guest), undefined, IP));
    expect(await store.findAccountById(guest.account.id)).toBeNull();
  });

  it('survit à un écouteur qui échoue', async () => {
    service.onAccountDeleted(() => {
      throw new Error('ranking en panne');
    });
    const guest = value(await service.createGuest(undefined, IP));
    value(await service.deleteAccount(await session(guest), undefined, IP));
    expect(await store.findAccountById(guest.account.id)).toBeNull();
  });
});

describe('tickets', () => {
  it('sont émis pour une audience connue et vérifiables par le relais', async () => {
    const grant = value(await service.createGuest('Zoë', IP));
    const { ticket, expiresAt } = value(service.issueTicket(await session(grant), 'relay'));
    expect(expiresAt).toBe(Math.floor(now / 1000) + 60);
    const result = verifyTicket(ticket, { secrets: [SECRET], audience: 'relay', now });
    expect(result).toMatchObject({
      ok: true,
      claims: { sub: grant.account.id, name: 'Zoë', guest: true, aud: 'relay' },
    });
  });

  it('sont refusés pour une audience inconnue', async () => {
    const grant = value(await service.createGuest(undefined, IP));
    expect(error(service.issueTicket(await session(grant), 'banque'))).toBe('invalid_audience');
  });
});

describe('purge', () => {
  it('efface les invités inactifs depuis 30 jours et les sessions expirées', async () => {
    expect(GUEST_IDLE_MS).toBe(30 * DAY);
    const idle = value(await service.createGuest(undefined, IP));
    const owner = value(await service.register('Élodie', 'tartiflette', IP));
    now += 31 * DAY;
    const fresh = value(await service.createGuest(undefined, IP));
    expect(await service.purge()).toEqual({ sessions: 1, guests: 1 });
    expect(await store.findAccountById(idle.account.id)).toBeNull();
    expect(await store.findAccountById(owner.account.id)).not.toBeNull();
    expect(await store.findAccountById(fresh.account.id)).not.toBeNull();
  });
});

describe('serveur occupé', () => {
  it('répond server_busy quand la file de hachage est pleine', async () => {
    const busy = new AccountService({
      store,
      hasher: new PasswordHasher({ logN: 12, r: 8, p: 1 }, { maxConcurrent: 1, maxQueue: 0 }),
      ticketSecrets: [SECRET],
      now: () => now,
    });
    const results = await Promise.all([
      busy.register('Premier', 'tartiflette', '192.0.2.1'),
      busy.register('Second', 'tartiflette', '192.0.2.2'),
    ]);
    expect(results.map((r) => (r.ok ? 'ok' : r.error)).sort()).toEqual(['ok', 'server_busy']);
  });
});
