import { describe, expect, it } from 'vitest';
import { MIN_SECRET_LENGTH, readConfig } from '../src/config.ts';

const SECRET = 'k'.repeat(32);

describe('readConfig', () => {
  it('applique des valeurs par défaut sûres', () => {
    expect(readConfig({ ACCOUNTS_TICKET_SECRETS: SECRET })).toEqual({
      host: '127.0.0.1',
      port: 8787,
      dbPath: 'data/accounts.sqlite',
      ticketSecrets: [SECRET],
      allowedOrigins: [],
      secureCookies: true,
      trustProxy: false,
    });
  });

  it('lit chaque variable', () => {
    const other = 'z'.repeat(40);
    expect(
      readConfig({
        ACCOUNTS_HOST: '0.0.0.0',
        ACCOUNTS_PORT: '9000',
        ACCOUNTS_DB: '/srv/comptes.sqlite',
        ACCOUNTS_TICKET_SECRETS: ` ${SECRET} , ${other} `,
        ACCOUNTS_ALLOWED_ORIGINS: 'https://jeu.example, https://www.jeu.example',
        ACCOUNTS_SECURE_COOKIES: 'false',
        ACCOUNTS_TRUST_PROXY: '1',
      }),
    ).toEqual({
      host: '0.0.0.0',
      port: 9000,
      dbPath: '/srv/comptes.sqlite',
      ticketSecrets: [SECRET, other],
      allowedOrigins: ['https://jeu.example', 'https://www.jeu.example'],
      secureCookies: false,
      trustProxy: true,
    });
  });

  it('refuse de démarrer sans clé de ticket, ou avec une clé trop courte', () => {
    expect(MIN_SECRET_LENGTH).toBe(32);
    expect(() => readConfig({})).toThrow(/ACCOUNTS_TICKET_SECRETS/);
    expect(() => readConfig({ ACCOUNTS_TICKET_SECRETS: ' , ' })).toThrow(/ACCOUNTS_TICKET_SECRETS/);
    expect(() => readConfig({ ACCOUNTS_TICKET_SECRETS: 'courte' })).toThrow(/32/);
    expect(() => readConfig({ ACCOUNTS_TICKET_SECRETS: `${SECRET},courte` })).toThrow(/32/);
  });

  it('refuse un port, un booléen ou une origine invalides', () => {
    const base = { ACCOUNTS_TICKET_SECRETS: SECRET };
    for (const port of ['abc', '-1', '70000', '80.5', '']) {
      expect(() => readConfig({ ...base, ACCOUNTS_PORT: port }), port).toThrow(/ACCOUNTS_PORT/);
    }
    expect(() => readConfig({ ...base, ACCOUNTS_SECURE_COOKIES: 'peut-être' })).toThrow(
      /ACCOUNTS_SECURE_COOKIES/,
    );
    expect(() => readConfig({ ...base, ACCOUNTS_ALLOWED_ORIGINS: 'jeu.example' })).toThrow(
      /ACCOUNTS_ALLOWED_ORIGINS/,
    );
    expect(() =>
      readConfig({ ...base, ACCOUNTS_ALLOWED_ORIGINS: 'https://jeu.example/chemin' }),
    ).toThrow(/ACCOUNTS_ALLOWED_ORIGINS/);
  });
});
