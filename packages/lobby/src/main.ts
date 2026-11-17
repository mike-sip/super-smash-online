/**
 * Serveur de jeu (lobby + relais) : `pnpm --filter @game/lobby start`, configuré par les
 * variables d'environnement de `config.ts`. Arrêt propre sur SIGINT et SIGTERM.
 *
 * Résultats de match : envoyés au classement (`ranking-report.ts`) quand `RANKING_URL` et
 * `RANKING_REPORT_SECRETS` sont donnés ; sinon seulement journalisés.
 */
import { readConfig } from './config.ts';
import { createRankingReporter, type RankingReporter } from './ranking-report.ts';
import { createGameServer } from './server.ts';

const read = readConfig(process.env);
if (!read.ok) {
  for (const e of read.errors) console.error(e);
  process.exit(1);
}
const config = read.config;
/** Une ligne par événement, préfixée de l'heure ISO ; jamais de pseudo, ticket ni adresse. */
const log = (message: string): void => console.log(`${new Date().toISOString()} ${message}`);

let reporter: RankingReporter | null = null;
if (config.ranking !== null) {
  reporter = createRankingReporter({
    url: config.ranking.url,
    secret: config.ranking.secret,
    now: () => Date.now(),
    fetch: (input, init) => fetch(input, init),
    setTimer: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    },
    log,
  });
} else {
  console.warn('RANKING_URL absent : les résultats de match ne sont pas envoyés au classement.');
}

const server = createGameServer({
  ...config,
  log,
  onMatchResult: (record) => {
    log(
      `[lobby] match ${record.matchId.slice(0, 8)} : ${record.status}, ${record.players.length} joueurs`,
    );
    reporter?.submit(record);
  },
  health: () => ({ reportsPending: reporter?.pending() ?? 0 }),
});
const { port } = await server.listen();
log(`Serveur de jeu à l'écoute : ws://${config.host}:${port}/lobby et /net`);

let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  log('Arrêt du serveur de jeu.');
  void server
    .close()
    .then(() => reporter?.close())
    .then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
