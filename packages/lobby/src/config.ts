/**
 * Configuration du serveur de jeu par variables d'environnement. Le serveur refuse de démarrer
 * sans clé de ticket ni contenu.
 *
 *   LOBBY_HOST, LOBBY_PORT, ACCOUNTS_TICKET_SECRETS (liste séparée par des virgules),
 *   LOBBY_FIGHTERS, LOBBY_STAGES (identifiants séparés par des virgules), LOBBY_REGIONS,
 *   LOBBY_TRUST_PROXY
 */
import { RANDOM, isContentId, isRegion } from './protocol.ts';
import type { GameServerConfig } from './server.ts';

export type EnvConfig = Pick<
  GameServerConfig,
  'host' | 'port' | 'ticketSecrets' | 'content' | 'regions' | 'trustProxy'
>;

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
    },
  };
}
