/**
 * Configuration du serveur, lue dans les variables d'environnement. Une valeur invalide arrête
 * le démarrage avec un message clair, plutôt que de laisser tourner un serveur mal réglé.
 */

/** Longueur minimale d'une clé de ticket : 32 caractères, soit au moins 128 bits d'aléa en base64. */
export const MIN_SECRET_LENGTH = 32;

export interface EnvConfig {
  readonly host: string;
  readonly port: number;
  /** Fichier SQLite. */
  readonly dbPath: string;
  readonly ticketSecrets: readonly string[];
  readonly allowedOrigins: readonly string[];
  readonly secureCookies: boolean;
  readonly trustProxy: boolean;
}

type Env = Readonly<Record<string, string | undefined>>;

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function flag(env: Env, name: string, fallback: boolean): boolean {
  const value = env[name]?.trim().toLowerCase();
  if (value === undefined || value === '') return fallback;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new Error(`${name} doit valoir true, false, 1 ou 0.`);
}

function port(env: Env): number {
  const raw = env.ACCOUNTS_PORT;
  if (raw === undefined) return 8787;
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error('ACCOUNTS_PORT doit être un entier de 0 à 65535.');
  }
  return value;
}

function origins(env: Env): string[] {
  return list(env.ACCOUNTS_ALLOWED_ORIGINS).map((origin) => {
    let parsed: URL | undefined;
    try {
      parsed = new URL(origin);
    } catch {
      parsed = undefined;
    }
    if (parsed === undefined || parsed.origin !== origin) {
      throw new Error(
        `ACCOUNTS_ALLOWED_ORIGINS : « ${origin} » n'est pas une origine (schéma, hôte, port éventuel, sans chemin).`,
      );
    }
    return origin;
  });
}

export function readConfig(env: Env): EnvConfig {
  const ticketSecrets = list(env.ACCOUNTS_TICKET_SECRETS);
  if (ticketSecrets.length === 0) {
    throw new Error(
      'ACCOUNTS_TICKET_SECRETS est obligatoire : une ou plusieurs clés, séparées par des virgules.',
    );
  }
  if (ticketSecrets.some((secret) => secret.length < MIN_SECRET_LENGTH)) {
    throw new Error(
      `ACCOUNTS_TICKET_SECRETS : chaque clé doit faire au moins ${MIN_SECRET_LENGTH} caractères.`,
    );
  }
  return {
    host: env.ACCOUNTS_HOST?.trim() || '127.0.0.1',
    port: port(env),
    dbPath: env.ACCOUNTS_DB?.trim() || 'data/accounts.sqlite',
    ticketSecrets,
    allowedOrigins: origins(env),
    secureCookies: flag(env, 'ACCOUNTS_SECURE_COOKIES', true),
    trustProxy: flag(env, 'ACCOUNTS_TRUST_PROXY', false),
  };
}
