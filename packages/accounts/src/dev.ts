/**
 * Serveur des comptes en développement : `pnpm --filter @game/accounts dev`. Fournit des
 * valeurs par défaut propres au poste de développement, puis démarre comme en production.
 * Ne jamais utiliser cette clé ailleurs.
 */
process.env.ACCOUNTS_TICKET_SECRETS ??= 'dev-uniquement-cle-de-ticket-non-secrete-0000';
process.env.ACCOUNTS_DB ??= 'data/accounts.dev.sqlite';
// En http sur la machine locale, un cookie « Secure » n'est pas garanti dans tous les navigateurs.
process.env.ACCOUNTS_SECURE_COOKIES ??= 'false';

await import('./main.ts');
