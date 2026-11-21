/**
 * Point d'entrée du serveur des comptes : `pnpm --filter @game/accounts start`.
 * Configuration par variables d'environnement (voir `config.ts` et SPEC-accounts.md).
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { readConfig } from './config.ts';
import { createAccountsServer } from './index.ts';
import { openSqliteStore } from './store-sqlite.ts';

let config;
try {
  config = readConfig(process.env);
} catch (error) {
  console.error(`Serveur des comptes : configuration invalide. ${(error as Error).message}`);
  process.exit(1);
}

if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });
const server = createAccountsServer({ ...config, store: openSqliteStore(config.dbPath) });
const { port } = await server.listen();
console.log(
  `Serveur des comptes à l'écoute sur http://${config.host}:${port} (base : ${config.dbPath}).`,
);
if (!config.secureCookies) {
  console.warn('Cookies sans « Secure » : réservé au développement en http.');
}

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} reçu : arrêt du serveur des comptes.`);
  await server.close();
  process.exit(0);
}
process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));
