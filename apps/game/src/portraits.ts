/**
 * Portraits des personnages pour les écrans (SPEC-visuals.md, phase 7) : photographiés à la volée
 * par le studio de `render`, gardés en mémoire. Sans WebGL (tests, navigateur sans carte
 * graphique), aucun portrait : les écrans restent lisibles sans.
 */
import { createPortraitStudio, type PortraitKind, type PortraitStudio } from '@game/render';
import { lookOf, modelOf } from './content.ts';

let studio: PortraitStudio | null = null;
let unavailable = false;

/** URL d'image du personnage `id` dans sa couleur `variant`, ou `undefined`. */
export function portraitUrl(
  id: string,
  variant: number,
  kind: PortraitKind,
  size: number,
  pose = 0,
): string | undefined {
  const look = lookOf(id);
  if (look === undefined || unavailable) return undefined;
  try {
    studio ??= createPortraitStudio();
    return studio.render(look, variant, kind, size, pose, modelOf(id));
  } catch {
    unavailable = true;
    return undefined;
  }
}
