/**
 * Serveur de jeu en développement : `pnpm --filter @game/lobby dev`. Même clé de ticket que
 * `pnpm --filter @game/accounts dev` (marquée « dev », à ne jamais utiliser ailleurs) et le contenu
 * de test de `sim-core`, en attendant `fighters` et `stages-items`.
 */
process.env.ACCOUNTS_TICKET_SECRETS ??= 'dev-uniquement-cle-de-ticket-non-secrete-0000';
process.env.LOBBY_FIGHTERS ??= 'mannequin';
process.env.LOBBY_STAGES ??= 'arene-test';
process.env.LOBBY_PORT ??= '8788';

await import('./main.ts');
