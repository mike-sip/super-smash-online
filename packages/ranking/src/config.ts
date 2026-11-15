/** Configuration du classement par variables d'environnement (en plus de celles des comptes). */
import { MIN_SECRET_LENGTH } from './report.ts';

export interface RankingEnvConfig {
  readonly dbPath: string;
  readonly reportSecrets: readonly string[];
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * `RANKING_DB` (défaut `data/ranking.sqlite`, `:memory:` accepté) ; `RANKING_REPORT_SECRETS`,
 * obligatoire : une ou plusieurs clés séparées par des virgules, la première étant celle que
 * `lobby` utilise, 32 caractères au moins chacune, distinctes des clés de ticket.
 */
export function readRankingConfig(env: Env): RankingEnvConfig {
  const reportSecrets = (env.RANKING_REPORT_SECRETS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (reportSecrets.length === 0) {
    throw new Error(
      'RANKING_REPORT_SECRETS est obligatoire : une ou plusieurs clés, séparées par des virgules.',
    );
  }
  if (reportSecrets.some((s) => s.length < MIN_SECRET_LENGTH)) {
    throw new Error(
      `RANKING_REPORT_SECRETS : chaque clé doit faire au moins ${MIN_SECRET_LENGTH} caractères.`,
    );
  }
  const tickets = new Set((env.ACCOUNTS_TICKET_SECRETS ?? '').split(',').map((s) => s.trim()));
  if (reportSecrets.some((s) => tickets.has(s))) {
    throw new Error('RANKING_REPORT_SECRETS doit être distincte des clés de ticket des comptes.');
  }
  return { dbPath: env.RANKING_DB?.trim() || 'data/ranking.sqlite', reportSecrets };
}
