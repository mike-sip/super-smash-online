/**
 * Production en local : les mêmes processus que sur le serveur (comptes + classement, serveur de
 * jeu), lancés depuis le dépôt construit, derrière la passerelle qui reproduit le frontal. Sans
 * Docker ni TLS (cookies sans « Secure »). Clés tirées au hasard à chaque lancement, bases SQLite
 * dans un dossier temporaire.
 *
 *   pnpm --filter @game/app serve:prod     (après `pnpm --filter @game/app build`)
 *
 * Utilisé aussi par les tests de bout en bout, qui peuvent arrêter puis relancer le serveur de jeu.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway } from '../../../deploy/gateway.ts';
import { CONTENT_IDS } from '../src/content-ids.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

export interface ProductionOptions {
  /** Dossier du client construit. */
  readonly client: string;
  /** Port de la passerelle ; 0 : libre. */
  readonly port?: number;
  /** Règles et attente de la partie rapide (tests). */
  readonly quickRules?: object;
  readonly quickWaitMs?: number;
  readonly log?: (line: string) => void;
}

export interface Production {
  readonly url: string;
  stopGame(): Promise<void>;
  startGame(): Promise<void>;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

async function waitHealthy(url: string, ms = 30_000): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Pas encore prêt.
    }
    if (Date.now() > end) throw new Error(`Pas de réponse de ${url}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

const secret = (): string => randomBytes(32).toString('base64url');

function run(
  script: string,
  env: Record<string, string>,
  log: (l: string) => void,
  name: string,
): ChildProcess {
  const child = spawn(process.execPath, [join(REPO, script)], {
    cwd: REPO,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const forward = (chunk: Buffer): void => {
    for (const line of chunk.toString().split('\n'))
      if (line.trim() !== '') log(`[${name}] ${line}`);
  };
  child.stdout!.on('data', forward);
  child.stderr!.on('data', forward);
  return child;
}

async function kill(child: ChildProcess | null): Promise<void> {
  if (child === null || child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
  });
}

export async function startProduction(options: ProductionOptions): Promise<Production> {
  const log = options.log ?? (() => {});
  const data = mkdtempSync(join(tmpdir(), 'fracas-'));
  const ticket = secret();
  const report = secret();
  const accountsPort = await freePort();
  const gamePort = await freePort();

  const accounts = run(
    'packages/ranking/src/main.ts',
    {
      ACCOUNTS_HOST: '127.0.0.1',
      ACCOUNTS_PORT: String(accountsPort),
      ACCOUNTS_DB: join(data, 'accounts.sqlite'),
      RANKING_DB: join(data, 'ranking.sqlite'),
      ACCOUNTS_TICKET_SECRETS: ticket,
      RANKING_REPORT_SECRETS: report,
      ACCOUNTS_SECURE_COOKIES: 'false',
      ACCOUNTS_TRUST_PROXY: 'true',
    },
    log,
    'comptes',
  );

  const gameEnv: Record<string, string> = {
    LOBBY_HOST: '127.0.0.1',
    LOBBY_PORT: String(gamePort),
    ACCOUNTS_TICKET_SECRETS: ticket,
    LOBBY_FIGHTERS: CONTENT_IDS.fighters.join(','),
    LOBBY_STAGES: CONTENT_IDS.stages.join(','),
    LOBBY_TRUST_PROXY: 'true',
    RANKING_URL: `http://127.0.0.1:${accountsPort}`,
    RANKING_REPORT_SECRETS: report,
    RELAY_MAX_GAMES: '200',
  };
  if (options.quickRules !== undefined)
    gameEnv.LOBBY_QUICK_RULES = JSON.stringify(options.quickRules);
  if (options.quickWaitMs !== undefined) gameEnv.LOBBY_QUICK_WAIT_MS = String(options.quickWaitMs);
  let game: ChildProcess | null = null;
  const startGame = async (): Promise<void> => {
    game = run('packages/lobby/src/main.ts', gameEnv, log, 'jeu');
    await waitHealthy(`http://127.0.0.1:${gamePort}/health`);
  };

  await waitHealthy(`http://127.0.0.1:${accountsPort}/api/accounts/v1/health`);
  await startGame();

  const gateway: Server = createGateway({
    root: options.client,
    port: options.port ?? 0,
    upstreams: {
      accounts: new URL(`http://127.0.0.1:${accountsPort}`),
      game: new URL(`http://127.0.0.1:${gamePort}`),
    },
  });
  await new Promise<void>((resolve) => gateway.listen(options.port ?? 0, '127.0.0.1', resolve));
  const port = (gateway.address() as { port: number }).port;

  return {
    url: `http://127.0.0.1:${port}/`,
    stopGame: () => kill(game),
    startGame,
    async stop() {
      await new Promise<void>((resolve) => {
        gateway.closeAllConnections();
        gateway.close(() => resolve());
      });
      await kill(game);
      await kill(accounts);
      rmSync(data, { recursive: true, force: true });
    },
  };
}

if (import.meta.main) {
  const client = fileURLToPath(new URL('../dist/', import.meta.url));
  const prod = await startProduction({
    client,
    port: Number(process.env.PORT ?? 8080),
    log: (line) => console.log(line),
  });
  console.log(`Fracas (production locale) : ${prod.url}`);
  const stop = (): void => void prod.stop().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
