/**
 * Point d'entrée du serveur des comptes avec le classement : `pnpm --filter @game/ranking start`.
 * Variables des comptes (voir SPEC-accounts.md) et du classement (`config.ts`).
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openSqliteStore, readConfig } from '@game/accounts';
import { readRankingConfig } from './config.ts';
import { createGameServer } from './index.ts';
import { openRankingSqliteStore } from './store-sqlite.ts';

let accounts;
let ranking;
try {
  accounts = readConfig(process.env);
  ranking = readRankingConfig(process.env);
} catch (error) {
  console.error(`Serveur : configuration invalide. ${(error as Error).message}`);
  process.exit(1);
}

for (const path of [accounts.dbPath, ranking.dbPath]) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
}
const server = createGameServer(
  { ...accounts, store: openSqliteStore(accounts.dbPath) },
  { store: openRankingSqliteStore(ranking.dbPath), reportSecrets: ranking.reportSecrets },
);
const { port } = await server.listen();
console.log(
  `Comptes et classement à l'écoute sur http://${accounts.host}:${port} ` +
    `(bases : ${accounts.dbPath}, ${ranking.dbPath}).`,
);
if (!accounts.secureCookies)
  console.warn('Cookies sans « Secure » : réservé au développement en http.');

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} reçu : arrêt du serveur.`);
  await server.close();
  process.exit(0);
}
process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));
