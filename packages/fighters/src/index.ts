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
  type LookPart,
} from './character.ts';
export { ROSTER, character, isFighterId } from './roster.ts';
export { buildMatchConfig, type MatchOptions } from './match.ts';
