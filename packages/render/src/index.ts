/** API publique de `render`. Tout ce qui n'est pas exporté ici est un détail interne. */
export {
  createRenderer,
  type QualityOptions,
  type Renderer,
  type RendererOptions,
} from './renderer.ts';
export { QUALITIES, guessQuality, type Quality, type QualitySetting } from './quality.ts';
export type { FighterVisuals, FighterVisualsFactory } from './fighters/visual.ts';
export { createFigurines } from './fighters/figurine.ts';
export { PALETTE_COUNT, distinctPalettes } from './fighters/body.ts';
export type { FigurineStyle, VfxTheme } from './fighters/body.ts';
export type { BoneName, Sculpt, SculptPart, ZoneName } from './fighters/sdf.ts';
export {
  DEFAULT_AUDIO_SETTINGS,
  createGameAudio,
  type AudioSettings,
  type GameAudio,
  type GameAudioOptions,
  type GameAudioState,
} from './audio/audio.ts';
export {
  createSynthBank,
  type MusicData,
  type SoundBank,
  type SoundData,
  type SynthBankOptions,
} from './audio/bank.ts';
export {
  SND_DOUBLE_JUMP,
  SND_ENTITY_BREAK,
  SND_ENTITY_SPAWN,
  SND_GRAB,
  SND_HIT_MEDIUM,
  SND_HIT_STRONG,
  SND_HIT_WEAK,
  SND_JUMP,
  SND_KO,
  SND_LAND,
  SND_LEDGE,
  SND_PARRY,
  SND_SHIELD,
  SND_SHIELD_BREAK,
  SOUND_COUNT,
  SOUND_NAMES,
} from './audio/cues.ts';
export { ARENA_STYLE, DORIAN, NATURAL_MINOR, type TrackStyle } from './audio/music.ts';
export {
  TEAM_COLORS,
  createMatchDomSink,
  createMatchHud,
  formatClock,
  type MatchHud,
  type MatchHudData,
  type MatchHudSink,
} from './match-hud.ts';
export {
  MAX_PARTS,
  createMannequins,
  createStyledMannequins,
  type MannequinColor,
  type MannequinPart,
  type MannequinStyle,
} from './fighters/mannequin.ts';
export { createPortraitStudio, type PortraitKind, type PortraitStudio } from './portraits.ts';
