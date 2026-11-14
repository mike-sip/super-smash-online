/**
 * Lecture de l'état pour le rendu, le HUD et l'audio.
 *
 * Les vues sont des objets réutilisables que l'appelant fournit : lire l'état n'alloue rien.
 * Les positions sont converties en nombres flottants (unités de jeu) ; rien de ce qui sort d'ici
 * ne doit revenir dans la simulation.
 */
import { fxToFloat } from './fixed.ts';
import type { Sim } from './step.ts';
import { platformAt } from './systems/stage-motion.ts';

export interface FighterView {
  x: number;
  y: number;
  velX: number;
  velY: number;
  /** 1 vers la droite, -1 vers la gauche. */
  facing: number;
  grounded: boolean;
  /** Action en cours (`A_*`) et nombre de frames passées dedans. */
  action: number;
  actionFrame: number;
  /** Emplacement de l'attaque ou de la projection en cours ; n'a de sens que pendant celles-ci. */
  move: number;
  /** Frames de charge accumulées par l'attaque en cours. */
  charge: number;
  /** Dégâts accumulés, en pourcentage. */
  damage: number;
  /** Résistance restante du bouclier, de 0 à 1. */
  shield: number;
  /** Frames de gel restantes après un coup : le rendu doit figer l'animation. */
  hitlag: number;
  intangible: boolean;
  /** Sauts aériens restants. */
  jumpsLeft: number;
}

export interface EntityView {
  /** Type d'entité : index dans `SimConfig.entities`, plus 1. */
  kind: number;
  /** Index du joueur à l'origine de l'entité, ou -1. */
  owner: number;
  x: number;
  y: number;
  velX: number;
  velY: number;
  /** Frames de vie restantes. */
  life: number;
}

export function createFighterView(): FighterView {
  return {
    x: 0,
    y: 0,
    velX: 0,
    velY: 0,
    facing: 1,
    grounded: false,
    action: 0,
    actionFrame: 0,
    move: 0,
    charge: 0,
    damage: 0,
    shield: 1,
    hitlag: 0,
    intangible: false,
    jumpsLeft: 0,
  };
}

export function createEntityView(): EntityView {
  return { kind: 0, owner: -1, x: 0, y: 0, velX: 0, velY: 0, life: 0 };
}

export function readFighter(sim: Sim, player: number, out: FighterView): void {
  const s = sim.state;
  out.x = fxToFloat(s.posX[player]!);
  out.y = fxToFloat(s.posY[player]!);
  out.velX = fxToFloat(s.velX[player]!);
  out.velY = fxToFloat(s.velY[player]!);
  out.facing = s.facing[player]!;
  out.grounded = s.grounded[player] === 1;
  out.action = s.action[player]!;
  out.actionFrame = s.actionFrame[player]!;
  out.move = s.move[player]!;
  out.charge = s.charge[player]!;
  out.damage = fxToFloat(s.damage[player]!);
  out.shield = s.shield[player]! / sim.config.fighters[player]!.shieldMax;
  out.hitlag = s.hitlag[player]!;
  out.intangible = s.intangible[player]! > 0;
  out.jumpsLeft = s.jumpsLeft[player]!;
}

/**
 * Lit l'emplacement d'entité `slot` (de 0 à `MAX_ENTITIES - 1`). Renvoie faux, sans toucher à
 * `out`, si l'emplacement est libre.
 */
export function readEntity(sim: Sim, slot: number, out: EntityView): boolean {
  const s = sim.state;
  const kind = s.eKind[slot]!;
  if (kind === 0 || kind === undefined) return false;
  out.kind = kind;
  out.owner = s.eOwner[slot]! - 1;
  out.x = fxToFloat(s.ePosX[slot]!);
  out.y = fxToFloat(s.ePosY[slot]!);
  out.velX = fxToFloat(s.eVelX[slot]!);
  out.velY = fxToFloat(s.eVelY[slot]!);
  out.life = s.eLife[slot]!;
  return true;
}

export interface PlatformView {
  x1: number;
  x2: number;
  y: number;
}

const platformScratch = { x1: 0, x2: 0, y: 0 };

/**
 * Position courante de la plateforme `index` de `StageDef.platforms`, en unités de jeu : celle où
 * la simulation a posé les combattants pendant la dernière frame. Pour une plateforme fixe, ce sont
 * ses coordonnées de définition.
 */
export function readPlatform(sim: Sim, index: number, out: PlatformView): void {
  platformAt(sim, index, platformScratch);
  out.x1 = fxToFloat(platformScratch.x1);
  out.x2 = fxToFloat(platformScratch.x2);
  out.y = fxToFloat(platformScratch.y);
}
