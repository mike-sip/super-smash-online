/** Ce qu'est un personnage pour le reste du jeu : des données, et rien d'autre. */
import type { EntityDef, FighterDef } from '@game/sim-core';
import { deepFreeze } from './build.ts';

export type FighterId = 'sorel' | 'zephine' | 'ferroc' | 'nacre';
export type Archetype = 'polyvalent' | 'rapide' | 'lourd' | 'zoneur';

/**
 * Couleur d'une pièce du mannequin : l'une des deux couleurs du personnage, la couleur du joueur
 * (pour distinguer deux joueurs qui prennent le même personnage), ou une couleur fixe 0xRRGGBB.
 */
export type LookColor = 'primary' | 'secondary' | 'player' | number;

/** Partie du corps qui porte une pièce ajoutée. La pièce suit ses mouvements. */
export type LookAnchor = 'head' | 'torso' | 'hips';

/**
 * Pièce ajoutée au mannequin (épaulière, coiffe, écharpe…) : une boîte. Dimensions et position en
 * hauteurs de combattant, dans le repère de la partie qui la porte, combattant de profil tourné
 * vers +x ; `z` positif vers la caméra.
 */
export interface LookPart {
  readonly anchor: LookAnchor;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** Rotation autour de l'axe de profondeur, en radians, positive vers l'avant. */
  readonly angle: number;
  readonly color: LookColor;
  /** Si vrai, une copie symétrique est placée de l'autre côté du corps (z opposé). */
  readonly mirror?: boolean;
}

/**
 * Description du mannequin d'un personnage : pure donnée, sans Three.js. Le rendu la consomme par
 * sa forme (`MannequinStyle` de `render`) ; aucun des deux paquets ne dépend de l'autre.
 */
export interface FighterLook {
  /** Couleurs 0xRRGGBB du corps (torse, jambes) et des membres et accents. */
  readonly primary: number;
  readonly secondary: number;
  /** Proportions relatives au mannequin standard (1 = inchangé). */
  readonly build: {
    readonly torsoWidth: number;
    readonly limbThickness: number;
    readonly headSize: number;
    readonly legLength: number;
    readonly armLength: number;
    readonly shoulderWidth: number;
  };
  readonly parts: readonly LookPart[];
}

export interface Character {
  /** Identifiant technique, indépendant du nom affiché : un `FighterId` pour le roster v1. */
  readonly id: string;
  /** Nom affiché. */
  readonly name: string;
  readonly archetype: Archetype;
  readonly def: FighterDef;
  /** Projectiles du personnage ; `SpawnDef.kind` y renvoie, à partir de 1. */
  readonly entities: readonly EntityDef[];
  readonly look: FighterLook;
}

/** Proportions du mannequin standard. */
export const STANDARD_BUILD: FighterLook['build'] = {
  torsoWidth: 1,
  limbThickness: 1,
  headSize: 1,
  legLength: 1,
  armLength: 1,
  shoulderWidth: 1,
};

/** Assemble un personnage et le fige en profondeur. */
export function defineCharacter(c: Character): Character {
  return deepFreeze(c);
}
