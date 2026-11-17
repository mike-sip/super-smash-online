/**
 * Configuration du serveur de jeu par variables d'environnement. Le serveur refuse de démarrer
 * sans clé de ticket ni contenu.
 *
 *   LOBBY_HOST, LOBBY_PORT, ACCOUNTS_TICKET_SECRETS (liste séparée par des virgules),
 *   LOBBY_FIGHTERS, LOBBY_STAGES (identifiants séparés par des virgules), LOBBY_REGIONS,
 *   LOBBY_TRUST_PROXY, RELAY_MAX_GAMES (défaut 200 : environ 700 Mo d'historique au pire)
 *
 * Envoi des résultats au classement (ensemble, ou pas du tout) :
 *   RANKING_URL (origine du serveur des comptes et du classement, ex. http://accounts:8787),
 *   RANKING_REPORT_SECRETS (mêmes clés que le classement ; la première signe les rapports)
 */
import { RANDOM, isContentId, isRegion } from './protocol.ts';
import type { GameServerConfig } from './server.ts';

/** Longueur minimale d'une clé, comme dans `accounts` et `ranking`. */
const MIN_SECRET_LENGTH = 32;
export const DEFAULT_MAX_GAMES = 200;
export const RANKING_REPORT_PATH = '/api/ranking/v1/matches';

export type EnvConfig = Pick<
  GameServerConfig,
  'host' | 'port' | 'ticketSecrets' | 'content' | 'regions' | 'trustProxy'
> & {
  readonly maxGames: number;
  /** Où et avec quelle clé envoyer les résultats ; `null` : seulement journalisés. */
  readonly ranking: { readonly url: string; readonly secret: string } | null;
};

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

export function readConfig(
  env: Record<string, string | undefined>,
): { ok: true; config: EnvConfig } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const port = Number(env.LOBBY_PORT ?? '8788');
  if (!Number.isInteger(port) || port < 0 || port > 65535) errors.push('LOBBY_PORT invalide.');
  const ticketSecrets = list(env.ACCOUNTS_TICKET_SECRETS);
  if (ticketSecrets.length === 0) errors.push('ACCOUNTS_TICKET_SECRETS manquant.');
  if (ticketSecrets.some((s) => s.length < 32)) {
    errors.push('Chaque clé de ACCOUNTS_TICKET_SECRETS doit faire 32 caractères au moins.');
  }
  const fighters = list(env.LOBBY_FIGHTERS);
  const stages = list(env.LOBBY_STAGES);
  for (const [name, ids] of [
    ['LOBBY_FIGHTERS', fighters],
    ['LOBBY_STAGES', stages],
  ] as const) {
    if (ids.length === 0) errors.push(`${name} manquant.`);
    for (const id of ids) {
      if (!isContentId(id) || id === RANDOM)
        errors.push(`${name} : identifiant invalide « ${id} ».`);
    }
  }
  const regions = env.LOBBY_REGIONS === undefined ? ['eu'] : list(env.LOBBY_REGIONS);
  if (regions.length === 0 || regions.some((r) => !isRegion(r)))
    errors.push('LOBBY_REGIONS invalide.');
  const trust = env.LOBBY_TRUST_PROXY ?? 'false';
  if (trust !== 'true' && trust !== 'false') errors.push('LOBBY_TRUST_PROXY : true ou false.');
  const maxGames = Number(env.RELAY_MAX_GAMES ?? DEFAULT_MAX_GAMES);
  if (!Number.isInteger(maxGames) || maxGames < 1 || maxGames > 100_000)
    errors.push('RELAY_MAX_GAMES : entier de 1 à 100 000.');
  const ranking = readRanking(env, ticketSecrets, errors);
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    config: {
      host: env.LOBBY_HOST ?? '127.0.0.1',
      port,
      ticketSecrets,
      content: { fighters, stages },
      regions,
      trustProxy: trust === 'true',
      maxGames,
      ranking,
    },
  };
}

function readRanking(
  env: Record<string, string | undefined>,
  ticketSecrets: readonly string[],
  errors: string[],
): EnvConfig['ranking'] {
  const origin = env.RANKING_URL?.trim() ?? '';
  const secrets = list(env.RANKING_REPORT_SECRETS);
  if (origin === '' && secrets.length === 0) return null;
  if (origin === '' || secrets.length === 0) {
    errors.push('RANKING_URL et RANKING_REPORT_SECRETS vont ensemble : les deux, ou aucun.');
    return null;
  }
  let url: URL | null = null;
  try {
    url = new URL(origin);
  } catch {
    url = null;
  }
  if (url === null || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    errors.push('RANKING_URL : adresse http ou https attendue.');
    return null;
  }
  if (secrets.some((s) => s.length < MIN_SECRET_LENGTH)) {
    errors.push(`RANKING_REPORT_SECRETS : ${MIN_SECRET_LENGTH} caractères au moins par clé.`);
    return null;
  }
  if (secrets.some((s) => ticketSecrets.includes(s))) {
    errors.push('RANKING_REPORT_SECRETS doit être distincte des clés de ticket.');
    return null;
  }
  return { url: new URL(RANKING_REPORT_PATH, url).toString(), secret: secrets[0]! };
}
