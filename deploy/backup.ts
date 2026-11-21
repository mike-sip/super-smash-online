/**
 * Sauvegarde à chaud des bases SQLite (comptes, classement) par `VACUUM INTO` : une copie
 * cohérente, même pendant que les serveurs écrivent. Fichiers datés dans le dossier cible ; les
 * plus anciens au-delà de `keep` sont supprimés.
 *
 *   node deploy/backup.ts <dossier des bases> <dossier des sauvegardes> [nombre à garder]
 *
 * Dans Docker : voir DEPLOIEMENT.md (« Sauvegardes »).
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DATABASES = ['accounts.sqlite', 'ranking.sqlite'];

export function backup(from: string, to: string, keep = 14, now = new Date()): string[] {
  mkdirSync(to, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const written: string[] = [];
  for (const name of DATABASES) {
    const target = join(to, `${stamp}-${name}`);
    const db = new DatabaseSync(join(from, name), { readOnly: true });
    try {
      db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
    } finally {
      db.close();
    }
    written.push(target);
    const old = readdirSync(to)
      .filter((f) => f.endsWith(`-${name}`))
      .sort()
      .reverse()
      .slice(keep);
    for (const f of old) rmSync(join(to, f));
  }
  return written;
}

if (import.meta.main) {
  const [from, to, keep] = process.argv.slice(2);
  if (from === undefined || to === undefined) {
    console.error(
      'Usage : node deploy/backup.ts <dossier des bases> <dossier des sauvegardes> [nombre à garder]',
    );
    process.exit(1);
  }
  for (const file of backup(from, to, keep === undefined ? 14 : Number(keep)))
    console.log(`Sauvegarde : ${file}`);
}
