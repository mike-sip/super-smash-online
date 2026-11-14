/** API publique de `render`. Tout ce qui n'est pas exporté ici est un détail interne. */
export { createRenderer, type Renderer, type RendererOptions } from './renderer.ts';
export type { FighterVisuals, FighterVisualsFactory } from './fighters/visual.ts';
export {
  MAX_PARTS,
  createMannequins,
  createStyledMannequins,
  type MannequinColor,
  type MannequinPart,
  type MannequinStyle,
} from './fighters/mannequin.ts';
