/** API publique de `netcode` côté client (navigateur et Node). Le serveur : `@game/netcode/server`. */
export {
  DEFAULT_CHECKSUM_INTERVAL,
  DEFAULT_INPUT_DELAY,
  DEFAULT_LATE_TOLERANCE,
  DEFAULT_MAX_PREDICTION,
  FRAME_MS,
  MAX_LOCAL_PLAYERS,
} from './constants.ts';
export {
  RESPAWN_FRAMES,
  simGame,
  stepWithRespawn,
  type Advance,
  type RollbackGame,
} from './game.ts';
