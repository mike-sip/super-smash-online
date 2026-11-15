/** API publique du lobby côté serveur (Node.js). Le client : `@game/lobby/client`. */
export {
  DEFAULT_LIMITS,
  DEFAULT_QUICK,
  createLobby,
  type Lobby,
  type LobbyConnection,
  type LobbyLimits,
  type LobbyOptions,
  type LobbyPeer,
  type QuickMatchSettings,
  type TicketIdentity,
} from './service.ts';
export type { LobbyContent } from './room.ts';
export type { MatchRecord } from './results.ts';
export * from './protocol.ts';
