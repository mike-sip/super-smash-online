/**
 * Représentation visuelle des combattants.
 *
 * `FighterVisuals` est le point de branchement : un mannequin procédural aujourd'hui, de vrais
 * modèles animés plus tard. Le renderer ne connaît que cette interface. Elle porte sur tous les
 * combattants à la fois, pour qu'une implémentation puisse les dessiner ensemble, par instances.
 */
import type { FighterView, SimConfig } from '@game/sim-core';
import type { Object3D } from 'three';

export interface FighterVisuals {
  /** Objet à placer dans la scène. */
  readonly root: Object3D;
  /**
   * À appeler une fois par frame simulée, pour chaque joueur, avec son état à cette frame.
   * Sert à repérer les changements d'action. Ne doit rien allouer.
   */
  capture(player: number, view: FighterView): void;
  /**
   * Met à jour l'image à dessiner. (x, y) est la position interpolée des pieds, `view` l'état
   * donné au dernier `capture`, `alpha` l'instant affiché entre les deux dernières frames.
   * Ne doit rien allouer.
   */
  update(player: number, x: number, y: number, view: FighterView, alpha: number): void;
  dispose(): void;
}

export type FighterVisualsFactory = (config: SimConfig) => FighterVisuals;

/** Couleurs franches, une par joueur. */
export const PLAYER_COLORS: readonly number[] = [
  0xe5484d, 0x3e7bfa, 0xf5c518, 0x30a46c, 0xf76b15, 0x8e4ec6, 0x12a5a5, 0xd6409f,
];
