import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, openSqliteStore } from '../src/store-sqlite.ts';
import { account, storeContract } from './store-contract.ts';

const dir = mkdtempSync(join(tmpdir(), 'accounts-sqlite-'));
let files = 0;
const freshFile = (): string => join(dir, `base-${files++}.sqlite`);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

storeContract('SQLite en mémoire', () => Promise.resolve(openSqliteStore(':memory:')));
storeContract('SQLite sur fichier', () => Promise.resolve(openSqliteStore(freshFile())));

describe('stockage SQLite', () => {
  it('retrouve ses données à la réouverture', async () => {
    const file = freshFile();
    const a = account({ pseudo: 'Persistant', pseudoKey: 'persistant' });
    const first = openSqliteStore(file);
    await first.createAccount(a);
    await first.createSession(
      { tokenDigest: 'd', accountId: a.id, createdAt: 1, expiresAt: 2 },
      10,
    );
    await first.close();

    const second = openSqliteStore(file);
    expect(await second.findAccountById(a.id)).toEqual(a);
    expect(await second.findSession('d')).not.toBeNull();
    await second.close();
  });

  it('efface vraiment du fichier les données d’un compte supprimé', async () => {
    const file = freshFile();
    const marker = 'Effacezmoi';
    const a = account({
      pseudo: marker,
      pseudoKey: marker.toLowerCase(),
      passwordHash: 'scrypt$MARQUEUR',
    });
    const store = openSqliteStore(file);
    await store.createAccount(a);
    // Un autre compte garde la page en vie : sans effacement sécurisé, l'ancien contenu y resterait.
    await store.createAccount(account());
    await store.close();
    expect(readFileSync(file).includes(marker)).toBe(true);

    const again = openSqliteStore(file);
    await again.deleteAccount(a.id);
    await again.close();
    const bytes = Buffer.concat([
      readFileSync(file),
      ...(existsSync(`${file}-wal`) ? [readFileSync(`${file}-wal`)] : []),
    ]);
    expect(bytes.includes(marker)).toBe(false);
    expect(bytes.includes('MARQUEUR')).toBe(false);
  });

  it('crée le schéma sur une base vide et note sa version', async () => {
    const file = freshFile();
    await openSqliteStore(file).close();
    const db = new DatabaseSync(file);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION });
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    db.close();
  });

  it('refuse une base d’une version plus récente que le code', () => {
    const file = freshFile();
    const db = new DatabaseSync(file);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    db.close();
    expect(() => openSqliteStore(file)).toThrow(/version/);
  });

  it('tient l’unicité des pseudos par la base elle-même', () => {
    const file = freshFile();
    const store = openSqliteStore(file);
    void store.close();
    const db = new DatabaseSync(file);
    const insert = db.prepare(
      `INSERT INTO accounts (id, pseudo, pseudo_key, guest, created_at, last_seen_at)
       VALUES (?, 'Max', 'max', ?, 0, 0)`,
    );
    insert.run('a', 0);
    // Un invité peut porter la même clé ; un second compte, non.
    insert.run('b', 1);
    expect(() => insert.run('c', 0)).toThrow(/UNIQUE/);
    db.close();
  });

  it('active les clés étrangères : une session sans compte est refusée', async () => {
    const store = openSqliteStore(':memory:');
    await expect(
      store.createSession(
        { tokenDigest: 'x', accountId: 'absent', createdAt: 0, expiresAt: 1 },
        10,
      ),
    ).rejects.toThrow(/FOREIGN KEY/);
    await store.close();
  });

  it('résiste à un pseudo contenant des caractères SQL', async () => {
    const store = openSqliteStore(':memory:');
    const sneaky = account({ pseudo: "x'); DROP TABLE accounts;--", pseudoKey: "x'); drop" });
    await store.createAccount(sneaky);
    expect(await store.findAccountByKey("x'); drop")).toEqual(sneaky);
    await store.close();
  });
});
