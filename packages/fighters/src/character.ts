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
  /**
   * Volumes de la figurine (SPEC-visuals.md, phase 3), ajoutés au corps commun ; ils remplacent les
   * pièces du mannequin. Absents : la figurine reprend les pièces, arrondies.
   */
  readonly sculpt?: readonly LookSculptPart[];
  /** Teintes des zones de la figurine que `primary` et `secondary` ne donnent pas. */
  readonly palette?: Partial<Record<LookZone, number>>;
  /**
   * Couleurs alternatives choisies à la sélection (SPEC-visuals.md, phase 4) : huit, chacune
   * remplace une partie des teintes ; la première est vide (les couleurs de base).
   */
  readonly palettes?: readonly Partial<Record<LookZone, number>>[];
  /** Zone de la figurine qui rayonne, plus fort pendant la charge d'un smash. */
  readonly emissive?: LookZone;
  /** Zone irisée de la figurine. */
  readonly iridescent?: LookZone;
  /** Thème des effets du personnage. */
  readonly vfx?: 'wind' | 'feather' | 'ember' | 'pearl';
}

/** Os de la figurine qui porte un volume ; « F » : du côté de la caméra quand il regarde à droite. */
export type LookBone =
  | 'hips'
  | 'spine'
  | 'neck'
  | 'head'
  | 'upperArmF'
  | 'forearmF'
  | 'handF'
  | 'upperArmB'
  | 'forearmB'
  | 'handB'
  | 'thighF'
  | 'shinF'
  | 'footF'
  | 'thighB'
  | 'shinB'
  | 'footB'
  // Os secondaires, animés par des ressorts : cheveux, pans de tissu, jupe.
  | 'tail1'
  | 'tail2'
  | 'cloth1'
  | 'cloth2'
  | 'skirt';

/** Zone de couleur d'un volume. */
export type LookZone =
  'primary' | 'secondary' | 'skin' | 'hair' | 'accent' | 'dark' | 'light' | 'player';

type Vec3 = readonly [number, number, number];

/**
 * Volume de la figurine, dans le repère de son os en pose de référence (x vers l'avant, y vers le
 * haut, un membre pend vers -y), en hauteurs de combattant. Le rendu le consomme par sa forme
 * (`SculptPart` de `render`).
 */
export interface LookSculptPart {
  readonly bone: LookBone;
  /** Repère dans lequel la pièce est décrite, s'il diffère de l'os qui l'anime. */
  readonly frame?: LookBone;
  readonly shape: 'capsule' | 'ellipsoid' | 'box';
  readonly zone: LookZone;
  readonly from?: Vec3;
  readonly to?: Vec3;
  readonly radius?: number;
  readonly radiusTo?: number;
  readonly center?: Vec3;
  readonly size?: Vec3;
  readonly rotation?: number;
  readonly round?: number;
  readonly blend?: number;
  readonly mirror?: boolean;
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
