/**
 * Effets d'une attaque qui durent sur une fenêtre de frames, ajoutés pour le module `fighters`
 * (SPEC-fighters.md) : élan propre (E1) et invincibilité (E3) ; et les réactions d'une attaque à
 * un coup reçu, appelées par `hit.ts` : armure (E4) et contre (E5).
 *
 * Appliqués après les décisions de la frame, pour tout combattant en attaque et non gelé : ainsi
 * une attaque qui vient de partir (par un input, une annulation ou un contre) reçoit ses effets
 * dès sa première frame, quel que soit le chemin qui l'a lancée.
 */
import { A_ATTACK } from '../actions.ts';
import type { Sim } from '../step.ts';
import { forceMove } from './movement.ts';

/**
 * Intangibilité donnée au défenseur qui contre : elle couvre la frame du contre et tout son gel,
 * pendant lequel l'intangibilité ne décroît pas.
 */
const COUNTER_INTANGIBLE = 2;

/** Vrai si `i` est dans la fenêtre de contre de son attaque en cours. */
export function isCountering(sim: Sim, i: number): boolean {
  const s = sim.state;
  if (s.action[i] !== A_ATTACK) return false;
  const counter = sim.config.fighters[i]!.moves[s.move[i]!]!.counter;
  if (counter === undefined) return false;
  const moveFrame = s.actionFrame[i]! + 1;
  return moveFrame >= counter.start && moveFrame <= counter.end;
}

/**
 * Contre réussi : aucun dégât, le défenseur se tourne vers l'origine du coup (`pushDir` est le sens
 * dans lequel le coup l'aurait poussé) et lance sa riposte après le même gel que l'attaquant.
 */
export function counterHit(sim: Sim, i: number, pushDir: number, hitlag: number): void {
  const s = sim.state;
  const counter = sim.config.fighters[i]!.moves[s.move[i]!]!.counter!;
  s.facing[i] = -pushDir;
  forceMove(s, i, counter.to);
  if (s.intangible[i]! < COUNTER_INTANGIBLE) s.intangible[i] = COUNTER_INTANGIBLE;
  if (hitlag > s.hitlag[i]!) s.hitlag[i] = hitlag;
}

/** Vrai si l'armure de l'attaque en cours de `i` encaisse un coup d'éjection `kb`. */
export function armorHolds(sim: Sim, i: number, kb: number): boolean {
  const s = sim.state;
  if (s.action[i] !== A_ATTACK) return false;
  const armor = sim.config.fighters[i]!.moves[s.move[i]!]!.armor;
  if (armor === undefined || kb > armor.maxKnockback) return false;
  const moveFrame = s.actionFrame[i]! + 1;
  return moveFrame >= armor.start && moveFrame <= armor.end;
}

export function applyMoveEffects(sim: Sim, i: number): void {
  const s = sim.state;
  if (s.action[i] !== A_ATTACK) return;
  const def = sim.config.fighters[i]!;
  const move = def.moves[s.move[i]!]!;
  // Numéro de la frame de l'attaque que ce `step` joue (même convention que les hitbox).
  const moveFrame = s.actionFrame[i]! + 1;

  const window = move.intangible;
  if (window !== undefined && moveFrame >= window.start && moveFrame <= window.end) {
    if (s.intangible[i]! < 1) s.intangible[i] = 1;
  }

  const motion = move.motion;
  if (motion === undefined) return;
  for (let k = 0; k < motion.length; k++) {
    const m = motion[k]!;
    if (moveFrame < m.start || moveFrame > m.end) continue;
    if (m.velX !== undefined) s.velX[i] = s.facing[i]! * m.velX;
    const velY = m.velY;
    if (velY !== undefined) {
      if (velY > 0 && s.grounded[i] === 1) {
        s.grounded[i] = 0;
        s.surface[i] = 0;
        s.jumpsLeft[i] = def.airJumps;
      }
      // Au sol, une vitesse vers le bas n'a pas d'effet : le combattant reste posé.
      if (s.grounded[i] === 0) {
        s.velY[i] = velY;
        s.fastFall[i] = 0;
        // Une frame sans gravité : la vitesse imposée est exactement la distance parcourue.
        s.floatFrames[i] = 1;
      }
    }
    return;
  }
}
