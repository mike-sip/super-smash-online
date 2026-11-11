/**
 * Contrats de données consommés par la simulation. Le contenu réel (personnages, stages)
 * est fourni par les modules `fighters` et `stages-items`.
 *
 * Ces contrats grandissent avec les mécaniques : chaque phase du plan y ajoute les champs
 * dont elle a besoin, jamais par anticipation.
 */
import type { Fx } from './fixed.ts';

export interface Vec2 {
  readonly x: Fx;
  readonly y: Fx;
}

export interface FighterDef {
  readonly name: string;
  /** Accélération vers le bas, en unités par frame². */
  readonly gravity: Fx;
  /** Vitesse de chute maximale, en unités par frame. */
  readonly maxFallSpeed: Fx;
  /** Vitesse de chute maximale pendant une chute rapide. */
  readonly fastFallSpeed: Fx;
}

export interface StageDef {
  readonly name: string;
  /** Points d'apparition, dans l'ordre des joueurs. Il en faut au moins un par joueur. */
  readonly spawns: readonly Vec2[];
}
