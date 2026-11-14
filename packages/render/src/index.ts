/** API publique de `render`. Tout ce qui n'est pas exporté ici est un détail interne. */
export { createRenderer, type Renderer, type RendererOptions } from './renderer.ts';
export type { FighterVisuals, FighterVisualsFactory } from './fighters/visual.ts';
export {
  TEAM_COLORS,
  createMatchDomSink,
  createMatchHud,
  formatClock,
  type MatchHud,
  type MatchHudData,
  type MatchHudSink,
} from './match-hud.ts';
