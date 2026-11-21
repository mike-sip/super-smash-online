/** API publique de `netcode` côté serveur (Node.js seulement). */
export {
  SERVER_HISTORY,
  createRelay,
  type Connection,
  type Relay,
  type RelayOptions,
  type RelayGameEvent,
  type RelayPeer,
  type Reservation,
} from './relay.ts';
export { attachRelay, startRelayServer, type RelayHost } from './host.ts';
