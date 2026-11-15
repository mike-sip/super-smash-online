/**
 * Serveur des comptes : API publique du paquet `@game/accounts`.
 *
 * Deux autres points d'entrée : `@game/accounts/protocol` (types et validations, utilisables
 * dans le navigateur) et `@game/accounts/ticket` (vérification des tickets, pour le relais).
 */
import { createServer, type Server } from 'node:http';
import {
  PRODUCTION_HASH_PARAMS,
  PasswordHasher,
  type HashParams,
  type HasherLimits,
} from './hashing.ts';
import { checkExtensions, createHandler, type HttpExtension } from './http.ts';
import { AccountService, type RateLimiters } from './service.ts';
import type { AccountStore } from './store.ts';

export interface AccountsConfig {
  /** Défaut conseillé : 127.0.0.1, derrière le proxy inverse. */
  readonly host: string;
  /** 0 : un port libre, choisi par le système (tests). */
  readonly port: number;
  readonly store: AccountStore;
  /** Clés de signature des tickets ; la première signe. 32 caractères au moins (voir `config.ts`). */
  readonly ticketSecrets: readonly string[];
  /** Origines autorisées en plus de celle du serveur lui-même. */
  readonly allowedOrigins: readonly string[];
  /** `true` en production : cookie `Secure` et préfixe `__Host-`. */
  readonly secureCookies: boolean;
  /** Lire l'adresse du client dans `X-Forwarded-For`. */
  readonly trustProxy: boolean;
  /** Défaut : paramètres de production. */
  readonly hashing?: HashParams;
  readonly hasherLimits?: Partial<HasherLimits>;
  readonly limiters?: RateLimiters;
  /** Horloge injectable pour les tests. */
  readonly now?: () => number;
  /** Journal d'une ligne par requête ; défaut : la console. */
  readonly log?: (line: string) => void;
  /** Intervalle de la purge des sessions expirées et des invités inactifs ; défaut : une heure. */
  readonly purgeEveryMs?: number;
  /** Routes d'autres modules servies par ce processus (`ranking`), sous leur propre préfixe. */
  readonly extensions?: readonly HttpExtension[];
}

export interface AccountsServer {
  listen(): Promise<{ port: number }>;
  close(): Promise<void>;
  /** Règles métier, pour les futurs modules hébergés dans le même processus (`ranking`). */
  readonly service: AccountService;
}

export function createAccountsServer(config: AccountsConfig): AccountsServer {
  checkExtensions(config.extensions ?? []);
  const now = config.now ?? Date.now;
  const log = config.log ?? ((line: string) => console.log(line));
  const hasher = new PasswordHasher(config.hashing ?? PRODUCTION_HASH_PARAMS, config.hasherLimits);
  const service = new AccountService({
    store: config.store,
    hasher,
    ticketSecrets: config.ticketSecrets,
    now,
    ...(config.limiters === undefined ? {} : { limiters: config.limiters }),
  });
  const server: Server = createServer(
    createHandler({
      service,
      allowedOrigins: config.allowedOrigins,
      secureCookies: config.secureCookies,
      trustProxy: config.trustProxy,
      log,
      now,
      ...(config.extensions === undefined ? {} : { extensions: config.extensions }),
    }),
  );
  // Un client lent ne garde pas une connexion indéfiniment.
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;

  let timer: ReturnType<typeof setInterval> | undefined;

  return {
    service,
    async listen() {
      await hasher.warmUp();
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => {
          server.off('error', reject);
          timer = setInterval(() => {
            service
              .purge()
              .catch((error: unknown) => console.error('accounts : purge en échec', error));
          }, config.purgeEveryMs ?? 3_600_000);
          timer.unref();
          const address = server.address();
          resolve({
            port: typeof address === 'object' && address !== null ? address.port : config.port,
          });
        });
      });
    },
    async close() {
      clearInterval(timer);
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      await config.store.close();
    },
  };
}

export { AccountService, toView } from './service.ts';
export type { ExtensionAuth, ExtensionContext, HttpExtension } from './http.ts';
export type {
  Authenticated,
  DeletionListener,
  Outcome,
  RateLimiters,
  SessionGrant,
} from './service.ts';
export { GUEST_IDLE_MS, MAX_SESSIONS_PER_ACCOUNT, SESSION_TTL_MS } from './service.ts';
export { PRODUCTION_HASH_PARAMS, PasswordHasher, HasherBusyError } from './hashing.ts';
export type { HashParams, HasherLimits } from './hashing.ts';
export { createMemoryStore } from './store-memory.ts';
export { openSqliteStore, SCHEMA_VERSION } from './store-sqlite.ts';
export { PseudoTakenError } from './store.ts';
export type { AccountRecord, AccountStore, SessionRecord } from './store.ts';
export { MemoryRateLimiter, RATE_RULES } from './rate-limit.ts';
export type { RateLimiter, RateRule } from './rate-limit.ts';
export { readConfig } from './config.ts';
export type { EnvConfig } from './config.ts';
export { verifyTicket, signTicket, TICKET_TTL_SECONDS } from './ticket.ts';
export type { TicketClaims, TicketError } from './ticket.ts';
