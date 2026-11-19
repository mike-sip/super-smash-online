/** API publique de `fighters`. Tout ce qui n'est pas exporté ici est un détail interne. */
export {
  STANDARD_BUILD,
  defineCharacter,
  type Archetype,
  type Character,
  type FighterId,
  type FighterLook,
  type LookAnchor,
  type LookColor,
  type LookBone,
  type LookPart,
  type LookSculptPart,
  type LookZone,
} from './character.ts';
export { ROSTER, character, isFighterId } from './roster.ts';
export { buildMatchConfig, type MatchOptions } from './match.ts';
export { formatIssue, validateCharacter, type Issue } from './validate.ts';
export {
  capsule,
  deepFreeze,
  dodge,
  hit,
  isDeepFrozen,
  move,
  moveset,
  throwDef,
  type HitSpec,
  type MoveSpec,
  type Shape,
  type ThrowSpec,
} from './build.ts';
export { SLOTS } from './slots.ts';
export { frameData, frameDataMarkdown, movementData, type FrameDataRow } from './framedata.ts';
export { fingerprint } from './fingerprint.ts';
