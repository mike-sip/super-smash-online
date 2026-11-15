import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.ts';

const BASE = {
  ACCOUNTS_TICKET_SECRETS: 'x'.repeat(32),
  LOBBY_FIGHTERS: 'vif, lourd',
  LOBBY_STAGES: 'arene',
};

describe('configuration', () => {
  it('valeurs par défaut et listes', () => {
    expect(readConfig(BASE)).toEqual({
      ok: true,
      config: {
        host: '127.0.0.1',
        port: 8788,
        ticketSecrets: ['x'.repeat(32)],
        content: { fighters: ['vif', 'lourd'], stages: ['arene'] },
        regions: ['eu'],
        trustProxy: false,
      },
    });
  });

  it('refuse de démarrer sans clé, avec une clé courte, sans contenu ou avec un identifiant invalide', () => {
    expect(readConfig({ ...BASE, ACCOUNTS_TICKET_SECRETS: undefined }).ok).toBe(false);
    expect(readConfig({ ...BASE, ACCOUNTS_TICKET_SECRETS: 'court' }).ok).toBe(false);
    expect(readConfig({ ...BASE, LOBBY_FIGHTERS: '' }).ok).toBe(false);
    expect(readConfig({ ...BASE, LOBBY_STAGES: 'Arène' }).ok).toBe(false);
    expect(readConfig({ ...BASE, LOBBY_FIGHTERS: 'random' }).ok).toBe(false);
    expect(readConfig({ ...BASE, LOBBY_PORT: 'abc' }).ok).toBe(false);
    expect(readConfig({ ...BASE, LOBBY_REGIONS: 'EU' }).ok).toBe(false);
    expect(readConfig({ ...BASE, LOBBY_TRUST_PROXY: 'oui' }).ok).toBe(false);
  });

  it('régions et proxy de confiance', () => {
    const r = readConfig({ ...BASE, LOBBY_REGIONS: 'eu,na', LOBBY_TRUST_PROXY: 'true' });
    expect(r.ok && r.config.regions).toEqual(['eu', 'na']);
    expect(r.ok && r.config.trustProxy).toBe(true);
  });
});
