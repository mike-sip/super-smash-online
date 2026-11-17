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
        maxGames: 200,
        ranking: null,
        quick: {},
      },
    });
  });

  it('envoi au classement : adresse et clés ensemble, ou rien', () => {
    const key = 'r'.repeat(32);
    const r = readConfig({
      ...BASE,
      RANKING_URL: 'http://accounts:8787',
      RANKING_REPORT_SECRETS: `${key}, ${'s'.repeat(40)}`,
    });
    expect(r.ok && r.config.ranking).toEqual({
      url: 'http://accounts:8787/api/ranking/v1/matches',
      secret: key,
    });
    expect(readConfig({ ...BASE, RANKING_URL: 'http://accounts:8787' }).ok).toBe(false);
    expect(readConfig({ ...BASE, RANKING_REPORT_SECRETS: key }).ok).toBe(false);
    expect(
      readConfig({ ...BASE, RANKING_URL: 'http://accounts:8787', RANKING_REPORT_SECRETS: 'court' })
        .ok,
    ).toBe(false);
    expect(readConfig({ ...BASE, RANKING_URL: 'ftp://x', RANKING_REPORT_SECRETS: key }).ok).toBe(
      false,
    );
    // Clé de rapport identique à une clé de ticket : refusée, comme chez ranking.
    expect(
      readConfig({
        ...BASE,
        RANKING_URL: 'http://accounts:8787',
        RANKING_REPORT_SECRETS: 'x'.repeat(32),
      }).ok,
    ).toBe(false);
  });

  it('règles et attente de la partie rapide réglables, validées', () => {
    const rules = {
      mode: 'time',
      stocks: 3,
      timeLimit: 30,
      stamina: 150,
      teams: false,
      teamAttack: false,
      ultimate: true,
      items: { enabled: false, frequency: 'normal' },
    };
    const r = readConfig({
      ...BASE,
      LOBBY_QUICK_RULES: JSON.stringify(rules),
      LOBBY_QUICK_WAIT_MS: '500',
    });
    expect(r.ok && r.config.quick).toEqual({ rules, maxWaitMs: 500 });
    expect(
      readConfig(BASE).ok && (readConfig(BASE) as { config: { quick: unknown } }).config.quick,
    ).toEqual({});
    expect(readConfig({ ...BASE, LOBBY_QUICK_RULES: '{' }).ok).toBe(false);
    expect(
      readConfig({ ...BASE, LOBBY_QUICK_RULES: JSON.stringify({ ...rules, timeLimit: 5 }) }).ok,
    ).toBe(false);
    expect(
      readConfig({ ...BASE, LOBBY_QUICK_RULES: JSON.stringify({ ...rules, extra: 1 }) }).ok,
    ).toBe(false);
    expect(readConfig({ ...BASE, LOBBY_QUICK_WAIT_MS: '-1' }).ok).toBe(false);
  });

  it('plafond de parties du relais', () => {
    const r = readConfig({ ...BASE, RELAY_MAX_GAMES: '50' });
    expect(r.ok && r.config.maxGames).toBe(50);
    expect(readConfig({ ...BASE, RELAY_MAX_GAMES: '0' }).ok).toBe(false);
    expect(readConfig({ ...BASE, RELAY_MAX_GAMES: 'beaucoup' }).ok).toBe(false);
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
