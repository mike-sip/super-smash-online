/**
 * Serveur de jeu (lobby + relais) : `pnpm --filter @game/lobby start`, configuré par les
 * variables d'environnement de `config.ts`. Arrêt propre sur SIGINT et SIGTERM.
 *
 * Résultats de match : journalisés pour l'instant. L'envoi au module `ranking` (POST signé vers
 * `/api/ranking/v1/matches`) se branchera ici à sa fusion, sur `onMatchResult`.
 */
import { readConfig } from './config.ts';
import { createGameServer } from './server.ts';

const read = readConfig(process.env);
if (!read.ok) {
  for (const e of read.errors) console.error(e);
  process.exit(1);
}
const config = read.config;
const server = createGameServer({
  ...config,
  log: (message) => console.log(message),
  onMatchResult: (record) =>
    console.log(
      `[lobby] match ${record.matchId} : ${record.status}, ${record.players.length} joueurs`,
    ),
});
const { port } = await server.listen();
console.log(`Serveur de jeu à l'écoute : ws://${config.host}:${port}/lobby et /net`);

const stop = (): void => {
  console.log('Arrêt du serveur de jeu.');
  void server.close().then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
