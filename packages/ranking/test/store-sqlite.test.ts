import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { RANKING_SCHEMA_VERSION, openRankingSqliteStore } from '../src/store-sqlite.ts';
import { uuid } from './fixtures.ts';
import { match, participant, rankedDuel, storeContract } from './store-contract.ts';

const dir = mkdtempSync(join(tmpdir(), 'ranking-sqlite-'));
let files = 0;
const freshFile = (): string => join(dir, `base-${files++}.sqlite`);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

storeContract('SQLite en mémoire', () => Promise.resolve(openRankingSqliteStore(':memory:')));
storeContract('SQLite sur fichier', () => Promise.resolve(openRankingSqliteStore(freshFile())));

describe('stockage SQLite du classement', () => {
  const A = uuid(0xa);
  const B = uuid(0xb);

  it('retrouve ses données à la réouverture', async () => {
    const file = freshFile();
    const first = openRankingSqliteStore(file);
    const m = rankedDuel(1, A, B);
    await first.recordMatch(m);
    await first.close();
    const second = openRankingSqliteStore(file);
    expect(await second.findMatch(m.matchId)).toEqual(m);
    expect((await second.findPlayer(A))?.rating).toBe(1016);
    await second.close();
  });

  it('enregistre un match en tout ou rien', async () => {
    const file = freshFile();
    const store = openRankingSqliteStore(file);
    await store.recordMatch(rankedDuel(1, A, B));
    // Une panne au milieu de l'écriture : un déclencheur fait échouer les statistiques d'un personnage.
    const side = new DatabaseSync(file);
    side.exec(`CREATE TRIGGER boom BEFORE INSERT ON fighter_stats WHEN NEW.fighter = 'boom'
               BEGIN SELECT RAISE(ABORT, 'panne simulée'); END`);
    side.close();
    const failing = match(2, [
      participant(0, A, { ratingBefore: 1016, ratingAfter: 1030, delta: 14 }),
      participant(1, B, { ratingBefore: 984, ratingAfter: 970, delta: -14, fighter: 'boom' }),
    ]);
    await expect(store.recordMatch(failing)).rejects.toThrow(/panne simulée/);
    expect(await store.findMatch(failing.matchId)).toBeNull();
    expect(await store.findPlayer(A)).toMatchObject({ rating: 1016, matchesPlayed: 1 });
    expect(await store.fighterStats(A)).toEqual([{ fighter: 'vanguard', played: 1, wins: 1 }]);
    await store.close();
  });

  it('note sa version de schéma et refuse une base plus récente', async () => {
    const file = freshFile();
    (await Promise.resolve(openRankingSqliteStore(file))).close();
    const side = new DatabaseSync(file);
    expect(side.prepare('PRAGMA user_version').get()).toEqual({
      user_version: RANKING_SCHEMA_VERSION,
    });
    side.exec(`PRAGMA user_version = ${RANKING_SCHEMA_VERSION + 1}`);
    side.close();
    expect(() => openRankingSqliteStore(file)).toThrow(/plus récente/);
  });

  it('ne garde pas l’identifiant d’un compte supprimé dans le fichier', async () => {
    const file = freshFile();
    const marker = uuid(0xdeadbeef);
    const store = openRankingSqliteStore(file);
    await store.recordMatch(rankedDuel(1, marker, B));
    await store.deleteAccount(marker);
    await store.close();
    const { readFileSync } = await import('node:fs');
    const bytes = readFileSync(file).toString('latin1');
    const wal = (() => {
      try {
        return readFileSync(`${file}-wal`).toString('latin1');
      } catch {
        return '';
      }
    })();
    expect(bytes.includes(marker) || wal.includes(marker)).toBe(false);
  });
});
