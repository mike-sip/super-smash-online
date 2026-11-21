/** API publique de `cpu` : l'adversaire ordinateur (SPEC-finition.md, phase 6). */
export { createBot, type Bot, type BotOptions } from './bot.ts';
export {
  DEFAULT_PROFILE,
  MAX_LEVEL,
  MIN_LEVEL,
  PROFILES,
  levelParams,
  profileOf,
  type LevelParams,
  type Profile,
} from './levels.ts';
export { analyzeMoves, type MoveInfo } from './moves.ts';
