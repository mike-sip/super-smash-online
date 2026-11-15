import { describe, expect, it } from 'vitest';
import { readRankingConfig } from '../src/config.ts';
import { createRanking } from '../src/index.ts';
import { createMemoryRankingStore } from '../src/store-memory.ts';
import { FakeAccounts } from './helpers.ts';

const KEY = 'cle-de-rapport-assez-longue-pour-test-000';

describe('configuration', () => {
  it('lit la base et les clés, avec une valeur par défaut pour la base', () => {
    expect(readRankingConfig({ RANKING_REPORT_SECRETS: ` ${KEY} , ${KEY}2 ` })).toEqual({
      dbPath: 'data/ranking.sqlite',
      reportSecrets: [KEY, `${KEY}2`],
    });
    expect(readRankingConfig({ RANKING_REPORT_SECRETS: KEY, RANKING_DB: ':memory:' }).dbPath).toBe(
      ':memory:',
    );
  });

  it('exige des clés, assez longues, distinctes des clés de ticket', () => {
    expect(() => readRankingConfig({})).toThrow(/obligatoire/);
    expect(() => readRankingConfig({ RANKING_REPORT_SECRETS: 'courte' })).toThrow(/32/);
    expect(() =>
      readRankingConfig({ RANKING_REPORT_SECRETS: KEY, ACCOUNTS_TICKET_SECRETS: `x,${KEY}` }),
    ).toThrow(/distincte/);
  });

  it('createRanking refuse une clé absente ou trop courte', () => {
    const base = { store: createMemoryRankingStore(), accounts: new FakeAccounts() };
    expect(() => createRanking({ ...base, reportSecrets: [] })).toThrow();
    expect(() => createRanking({ ...base, reportSecrets: ['courte'] })).toThrow(/32/);
  });
});
