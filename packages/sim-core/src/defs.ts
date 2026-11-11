/**
 * Contrats de données consommés par la simulation. Le contenu réel (personnages, stages)
 * est fourni par les modules `fighters` et `stages-items`.
 *
 * Ces contrats grandissent avec les mécaniques : chaque phase du plan y ajoute les champs
 * dont elle a besoin, jamais par anticipation.
 *
 * Unités : distances en unités de jeu, vitesses en unités par frame, accélérations en unités
 * par frame², durées en frames (1/60 s).
 */
import type { Fx } from './fixed.ts';

export interface Vec2 {
  readonly x: Fx;
  readonly y: Fx;
}

export interface FighterDef {
  readonly name: string;

  /** Demi-largeur du corps, pour les collisions avec les murs. */
  readonly halfWidth: Fx;
  /** Hauteur du corps, des pieds à la tête. */
  readonly height: Fx;

  /** Vitesse de marche stick à fond ; proportionnelle à l'inclinaison en dessous. */
  readonly walkSpeed: Fx;
  readonly walkAccel: Fx;
  /** Décélération au sol quand rien ne pousse le combattant. */
  readonly friction: Fx;
  /** Vitesse imposée pendant le dash initial. */
  readonly dashSpeed: Fx;
  readonly dashFrames: number;
  readonly runSpeed: Fx;
  readonly runAccel: Fx;
  /** Durée du freinage en sortie de course. */
  readonly brakeFrames: number;
  /** Durée du dérapage avant de repartir dans l'autre sens. */
  readonly turnFrames: number;

  /** Frames au sol entre l'appui sur saut et le décollage. */
  readonly jumpSquatFrames: number;
  /** Vitesse verticale du grand saut (bouton encore enfoncé au décollage). */
  readonly jumpVelocity: Fx;
  /** Vitesse verticale du petit saut (bouton relâché avant le décollage). */
  readonly shortHopVelocity: Fx;
  readonly doubleJumpVelocity: Fx;
  /** Nombre de sauts disponibles en l'air. */
  readonly airJumps: number;

  /** Vitesse horizontale maximale en l'air. */
  readonly airSpeed: Fx;
  readonly airAccel: Fx;
  /** Décélération horizontale en l'air, stick au neutre. */
  readonly airFriction: Fx;
  readonly gravity: Fx;
  readonly maxFallSpeed: Fx;
  /** Vitesse de chute imposée pendant une chute rapide. */
  readonly fastFallSpeed: Fx;
  /** Lag d'atterrissage après une chute sans attaque. */
  readonly landFrames: number;
}

/** Bloc plein : on marche dessus, on bute contre ses flancs et son dessous. */
export interface SolidDef {
  readonly x1: Fx;
  readonly y1: Fx;
  readonly x2: Fx;
  readonly y2: Fx;
}

/** Plateforme fine : traversable par le bas, et par le haut stick vers le bas. */
export interface PlatformDef {
  readonly x1: Fx;
  readonly x2: Fx;
  readonly y: Fx;
}

export interface StageDef {
  readonly name: string;
  /** Points d'apparition, dans l'ordre des joueurs. Il en faut au moins un par joueur. */
  readonly spawns: readonly Vec2[];
  readonly solids: readonly SolidDef[];
  readonly platforms: readonly PlatformDef[];
  /** Zones limites : un combattant qui en sort est KO. */
  readonly blast: {
    readonly left: Fx;
    readonly right: Fx;
    readonly top: Fx;
    readonly bottom: Fx;
  };
}
