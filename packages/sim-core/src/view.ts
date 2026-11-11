/** Lecture de l'état pour le rendu. Rien de ce qui sort d'ici ne doit revenir dans la simulation. */
import { fxToFloat } from './fixed.ts';
import type { Sim } from './step.ts';

/** Objet réutilisable rempli par `readFighter` : le rendu n'alloue rien par frame. */
export interface FighterView {
  x: number;
  y: number;
  /** 1 vers la droite, -1 vers la gauche. */
  facing: number;
  action: number;
  actionFrame: number;
  /** Dégâts accumulés, en pourcentage. */
  damage: number;
}

export function readFighter(sim: Sim, player: number, out: FighterView): void {
  const s = sim.state;
  out.x = fxToFloat(s.posX[player]!);
  out.y = fxToFloat(s.posY[player]!);
  out.facing = s.facing[player]!;
  out.action = s.action[player]!;
  out.actionFrame = s.actionFrame[player]!;
  out.damage = fxToFloat(s.damage[player]!);
}
