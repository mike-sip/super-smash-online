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
export { lobbyTicketVerifier, relayAuthenticator, type TicketKeys } from './admission.ts';
export { attachLobby, type LobbyHost } from './host.ts';
export {
  attachGameServer,
  createGameServer,
  type GameServer,
  type GameServerConfig,
} from './server.ts';
export { readConfig, type EnvConfig } from './config.ts';
