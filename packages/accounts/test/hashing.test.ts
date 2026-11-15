import { describe, expect, it } from 'vitest';
import {
  HasherBusyError,
  PRODUCTION_HASH_PARAMS,
  PasswordHasher,
  type HashParams,
} from '../src/hashing.ts';

/** Paramètres réduits : le hachage de production prend 0,2 s par calcul. */
const FAST: HashParams = { logN: 10, r: 8, p: 1 };

describe('PasswordHasher', () => {
  it('utilise par défaut les paramètres de production (OWASP : N=2^15, r=8, p=3)', () => {
    expect(PRODUCTION_HASH_PARAMS).toEqual({ logN: 15, r: 8, p: 3 });
    expect(new PasswordHasher().params).toEqual(PRODUCTION_HASH_PARAMS);
  });

  it('hache au format scrypt$logN$r$p$sel$empreinte, avec un sel différent à chaque fois', async () => {
    const hasher = new PasswordHasher(FAST);
    const a = await hasher.hash('tartiflette');
    const b = await hasher.hash('tartiflette');
    expect(a).toMatch(/^scrypt\$10\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('tartiflette');
  });

  it('vérifie le bon mot de passe et refuse les autres', async () => {
    const hasher = new PasswordHasher(FAST);
    const stored = await hasher.hash('tartiflette');
    expect(await hasher.verify('tartiflette', stored)).toBe(true);
    expect(await hasher.verify('Tartiflette', stored)).toBe(false);
    expect(await hasher.verify('', stored)).toBe(false);
  });

  it("vérifie une empreinte faite avec d'autres paramètres que les siens", async () => {
    const old = await new PasswordHasher({ logN: 9, r: 8, p: 1 }).hash('tartiflette');
    expect(await new PasswordHasher(FAST).verify('tartiflette', old)).toBe(true);
  });

  it('refuse sans erreur une empreinte mal formée ou aux paramètres déraisonnables', async () => {
    const hasher = new PasswordHasher(FAST);
    const good = await hasher.hash('tartiflette');
    for (const bad of [
      '',
      "n'importe quoi",
      'bcrypt$10$8$1$aaaa$bbbb',
      good.replace('$10$', '$40$'),
      good.replace('$8$1$', '$8$999$'),
      good.slice(0, -5),
      good + '$extra',
    ]) {
      expect(await hasher.verify('tartiflette', bad), bad).toBe(false);
    }
  });

  it('signale une empreinte aux paramètres périmés, pour la recalculer', async () => {
    const hasher = new PasswordHasher(FAST);
    expect(hasher.needsRehash(await hasher.hash('a-password'))).toBe(false);
    const weaker = await new PasswordHasher({ logN: 9, r: 8, p: 1 }).hash('a-password');
    expect(hasher.needsRehash(weaker)).toBe(true);
    expect(hasher.needsRehash('mal formée')).toBe(true);
  });

  it("vérifie contre une empreinte factice quand le compte n'existe pas", async () => {
    const hasher = new PasswordHasher(FAST);
    expect(await hasher.verify('tartiflette', null)).toBe(false);
  });

  it('plafonne les calculs simultanés et refuse au-delà de la file', async () => {
    const hasher = new PasswordHasher(FAST, { maxConcurrent: 1, maxQueue: 2 });
    const running = [
      hasher.hash('un-mot-de-passe'),
      hasher.hash('deux-mots'),
      hasher.hash('trois-mots'),
    ];
    await expect(hasher.hash('quatre-mots')).rejects.toBeInstanceOf(HasherBusyError);
    await expect(Promise.all(running)).resolves.toHaveLength(3);
    // La file vidée, on peut de nouveau hacher.
    await expect(hasher.hash('cinq-mots')).resolves.toMatch(/^scrypt\$/);
  });
});

describe('empreinte factice', () => {
  it('se prépare à l’avance, une seule fois', async () => {
    const hasher = new PasswordHasher({ logN: 10, r: 8, p: 1 });
    // Préparer deux fois ne recalcule rien, et la vérification d'un compte inexistant reste
    // fausse ensuite. Que la préparation épargne bien un calcul ne se voit qu'à la durée : non
    // testé ici, pour ne pas dépendre de la vitesse de la machine.
    await hasher.warmUp();
    await hasher.warmUp();
    await expect(hasher.verify('tartiflette', null)).resolves.toBe(false);
  });
});
