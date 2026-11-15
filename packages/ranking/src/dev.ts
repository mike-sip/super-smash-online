/**
 * Comptes et classement en développement : `pnpm --filter @game/ranking dev` (port 8787). Fournit
 * des valeurs propres au poste de développement, puis démarre comme en production. Ne jamais
 * utiliser ces clés ailleurs.
 */
import { DEV_REPORT_SECRET } from './dev-keys.ts';

process.env.ACCOUNTS_TICKET_SECRETS ??= 'dev-uniquement-cle-de-ticket-non-secrete-0000';
process.env.ACCOUNTS_DB ??= 'data/accounts.dev.sqlite';
// En http sur la machine locale, un cookie « Secure » n'est pas garanti dans tous les navigateurs.
process.env.ACCOUNTS_SECURE_COOKIES ??= 'false';
process.env.RANKING_REPORT_SECRETS ??= DEV_REPORT_SECRET;
process.env.RANKING_DB ??= 'data/ranking.dev.sqlite';

await import('./main.ts');
