/**
 * Classement : API publique du paquet `@game/ranking` (côté serveur).
 *
 * Autres points d'entrée : `@game/ranking/protocol` (types, validation, `reportFromResult` ;
 * utilisable dans le navigateur), `@game/ranking/report` (signature des rapports, pour `lobby`)
 * et `@game/ranking/client` (client navigateur).
 */
import {
  createAccountsServer,
  type AccountsConfig,
  type AccountsServer,
  type HttpExtension,
} from '@game/accounts';
import { createRankingExtension } from './http.ts';
import { MIN_SECRET_LENGTH } from './report.ts';
import { RankingService, type AccountsPort, type SubmitOutcome } from './service.ts';
import type { RankingStore } from './store.ts';

export interface RankingOptions {
  readonly store: RankingStore;
  readonly accounts: AccountsPort;
  /** Clés acceptées pour la signature des rapports, 32 caractères au moins. */
  readonly reportSecrets: readonly string[];
  readonly now?: () => number;
  /** Intervalle de la reprise de synchronisation et du balayage ; défaut : 10 minutes. */
  readonly maintenanceEveryMs?: number;
}

export interface Ranking {
  /** À passer dans `AccountsConfig.extensions`. */
  readonly extension: HttpExtension;
  readonly service: RankingService;
  /** Soumission en mémoire, pour un module du même processus. Même validation que la route HTTP. */
  submitMatch(report: unknown): Promise<SubmitOutcome>;
  getRating(accountId: string): Promise<number | null>;
  /** Écoute les suppressions, rattrape la synchronisation, balaie, puis recommence régulièrement. */
  start(): Promise<void>;
  /** Arrête la maintenance et ferme le stockage. */
  close(): Promise<void>;
}

export function createRanking(options: RankingOptions): Ranking {
  if (options.reportSecrets.length === 0) throw new Error('Aucune clé de rapport fournie.');
  for (const secret of options.reportSecrets) {
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(`Clé de rapport trop courte (${MIN_SECRET_LENGTH} caractères au moins).`);
    }
  }
  const now = options.now ?? Date.now;
  const service = new RankingService({ store: options.store, accounts: options.accounts, now });
  const extension = createRankingExtension({ service, reportSecrets: options.reportSecrets, now });
  let detach: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const maintain = async (): Promise<void> => {
    await service.syncPending();
    await service.sweep();
  };

  return {
    extension,
    service,
    submitMatch: (report) => service.submit(report),
    getRating: (accountId) => service.getRating(accountId),
    async start() {
      detach ??= service.attach();
      await maintain();
      timer ??= setInterval(() => {
        maintain().catch((error: unknown) =>
          console.error('ranking : maintenance en échec', error),
        );
      }, options.maintenanceEveryMs ?? 600_000);
      timer.unref();
    },
    async close() {
      clearInterval(timer);
      timer = undefined;
      detach?.();
      detach = undefined;
      await options.store.close();
    },
  };
}

export interface GameServer {
  readonly accounts: AccountsServer;
  readonly ranking: Ranking;
  listen(): Promise<{ port: number }>;
  close(): Promise<void>;
}

/**
 * Serveur des comptes avec le classement en extension, dans un même processus : le classement lit
 * les sessions et les pseudos sans réseau.
 */
export function createGameServer(
  accountsConfig: Omit<AccountsConfig, 'extensions'>,
  rankingOptions: Omit<RankingOptions, 'accounts'>,
): GameServer {
  // Le service des comptes n'existe qu'une fois le serveur créé, qui a besoin de l'extension :
  // on passe par un relais, appelé seulement au traitement des requêtes.
  const holder: { server?: AccountsServer } = {};
  const port: AccountsPort = {
    publicNames: (ids) => holder.server!.service.publicNames(ids),
    recordMatch: (id, won) => holder.server!.service.recordMatch(id, won),
    onAccountDeleted: (listener) => holder.server!.service.onAccountDeleted(listener),
  };
  const ranking = createRanking({ ...rankingOptions, accounts: port });
  const server = createAccountsServer({ ...accountsConfig, extensions: [ranking.extension] });
  holder.server = server;
  return {
    accounts: server,
    ranking,
    async listen() {
      const address = await server.listen();
      await ranking.start();
      return address;
    },
    async close() {
      await ranking.close();
      await server.close();
    },
  };
}

export { RankingService, LEADERBOARD_MIN_MATCHES, DELETED_NAME } from './service.ts';
export type { AccountsPort, HistoryOutcome, SubmitOutcome } from './service.ts';
export {
  computeRatingChanges,
  standings,
  roundPreservingSum,
  INITIAL_RATING,
  K_FACTOR,
} from './rating.ts';
export type { RatingInput, RatingOutcome, RatingPlayer } from './rating.ts';
export { createMemoryRankingStore } from './store-memory.ts';
export { openRankingSqliteStore, RANKING_SCHEMA_VERSION } from './store-sqlite.ts';
export { MatchExistsError } from './store.ts';
export type * from './store.ts';
export { signReport, verifyReportSignature } from './report.ts';
export { MAX_REPORT_BYTES, MAX_REPORT_SKEW_MS } from './http.ts';
export * from './protocol.ts';
