/**
 * Coup final (SPEC-finition.md, phase 3) : l'éjection du joueur `player` finirait-elle le match ?
 * Vrai s'il joue sa dernière vie et que sa chute ne laisserait qu'un camp debout. Les modes sans
 * vies comptées (Temps, Endurance) n'ont pas de coup final annoncé. Logique pure.
 */
export interface FinaleView {
  readonly players: number;
  readonly teams: boolean;
  readonly stocks: ArrayLike<number>;
  readonly team: ArrayLike<number>;
  readonly eliminated: ArrayLike<number>;
}

export function isFinalKo(view: FinaleView, player: number): boolean {
  if (view.stocks[player] !== 1 || view.eliminated[player] === 1) return false;
  let allies = 0;
  let rivals = 0;
  for (let j = 0; j < view.players; j++) {
    if (j === player || view.eliminated[j] === 1) continue;
    if (view.teams && view.team[j] === view.team[player]) allies++;
    else rivals++;
  }
  return allies === 0 && rivals > 0 && (view.teams || rivals === 1);
}

/** Ce que la tension de la musique lit du match. */
export interface TensionView extends FinaleView {
  /** Secondes restantes, ou -1 sans limite. */
  readonly timeLeft: number;
  readonly phase: string;
}

/** Secondes restantes à partir desquelles la musique se tend, en mode Temps. */
export const TENSION_SECONDS = 30;

/**
 * Tension de la musique (SPEC-finition.md, phase 5), 0 ou 1 : un combattant joue sa dernière vie
 * dans le dernier duel, les dernières secondes du temps, ou la mort subite. Logique pure.
 */
export function musicTension(view: TensionView): number {
  if (view.phase === 'over') return 0;
  if (view.phase === 'sudden-death') return 1;
  if (view.timeLeft >= 0 && view.timeLeft <= TENSION_SECONDS) return 1;
  for (let p = 0; p < view.players; p++) if (isFinalKo(view, p)) return 1;
  return 0;
}
