/**
 * Vérification des tickets du serveur des comptes (SPEC-accounts.md, « Vérification d'un
 * ticket ») pour les deux portes du serveur de jeu : le lobby (audience « lobby », rejeu refusé
 * par le service lui-même) et le relais (audience « relay », rejeu refusé ici).
 */
import { verifyTicket } from '@game/accounts/ticket';
import { createReplayGuard } from './limits.ts';
import type { TicketIdentity } from './service.ts';

export interface TicketKeys {
  /** Clés acceptées (mêmes valeurs que `ACCOUNTS_TICKET_SECRETS` du serveur des comptes). */
  readonly secrets: readonly string[];
  /** Horloge en millisecondes, comme `Date.now`. */
  readonly now: () => number;
}

/** Pour `LobbyOptions.verifyTicket`. */
export function lobbyTicketVerifier(keys: TicketKeys): (ticket: string) => TicketIdentity | null {
  return (ticket) => {
    const r = verifyTicket(ticket, { secrets: keys.secrets, audience: 'lobby', now: keys.now() });
    if (!r.ok) return null;
    return { id: r.claims.sub, name: r.claims.name, guest: r.claims.guest, jti: r.claims.jti };
  };
}

/** Pour `RelayOptions.authenticate` : un ticket ne sert qu'une fois pendant sa durée de vie. */
export function relayAuthenticator(
  keys: TicketKeys,
  replayMs = 70_000,
): (ticket: string) => { id: string } | null {
  const replay = createReplayGuard(replayMs, keys.now);
  return (ticket) => {
    const r = verifyTicket(ticket, { secrets: keys.secrets, audience: 'relay', now: keys.now() });
    if (!r.ok || !replay.first(r.claims.jti)) return null;
    return { id: r.claims.sub };
  };
}
