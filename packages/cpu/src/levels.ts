/**
 * Niveaux de l'ordinateur (SPEC-finition.md, phase 6), de 1 à 9, et profils de jeu des
 * personnages. Logique pure.
 */

export interface LevelParams {
  readonly level: number;
  /** Retard de perception, en frames : le bot voit l'adversaire tel qu'il était il y a tant. */
  readonly reaction: number;
  /** Chance de choisir le meilleur coup plutôt qu'un coup au hasard. */
  readonly accuracy: number;
  /** Chance, à chaque décision, d'attaquer plutôt que d'attendre. */
  readonly aggression: number;
  /** Chance de se protéger (bouclier, esquive) face à une attaque qui arrive. */
  readonly defense: number;
  /** Chance de punir un adversaire vulnérable (fin d'attaque, atterrissage, bouclier brisé). */
  readonly punish: number;
  /** Chance de récupérer au sol (tech) en retombant d'une éjection. */
  readonly tech: number;
  /** Chance d'influencer sa trajectoire quand on est éjecté (survivre plus longtemps). */
  readonly di: number;
  /** Garde du bord : poursuivre un adversaire hors du stage. */
  readonly edgeGuard: boolean;
  /** Frames de réflexion entre deux décisions de placement. */
  readonly think: number;
}

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 9;

/** Paramètres du niveau `level` (borné de 1 à 9). */
export function levelParams(level: number): LevelParams {
  const l = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.round(level)));
  const t = (l - 1) / (MAX_LEVEL - 1);
  return {
    level: l,
    reaction: Math.round(30 - 26 * t),
    accuracy: 0.15 + 0.82 * t,
    aggression: 0.15 + 0.75 * t,
    defense: 0.02 + 0.85 * t * t,
    punish: 0.05 + 0.9 * t,
    tech: Math.max(0, t * 1.1 - 0.1),
    di: t,
    edgeGuard: l >= 6,
    think: Math.round(40 - 34 * t),
  };
}

export interface Profile {
  /** Distance préférée à l'adversaire, en unités de jeu. */
  readonly range: number;
  /** Goût pour les attaques aériennes (0 à 1). */
  readonly air: number;
  /** Dégâts de l'adversaire à partir desquels le bot cherche à finir avec un smash. */
  readonly killAt: number;
  /** Penchant pour le projectile, de loin (0 à 1). */
  readonly zoning: number;
}

/** Profils : Sorel équilibré, Zéphine harcèle en l'air, Ferroc charge ses smashs, Nacre garde ses distances. */
export const PROFILES: Readonly<Record<string, Profile>> = {
  sorel: { range: 12, air: 0.35, killAt: 95, zoning: 0.2 },
  zephine: { range: 7, air: 0.7, killAt: 115, zoning: 0.1 },
  ferroc: { range: 11, air: 0.15, killAt: 75, zoning: 0.05 },
  nacre: { range: 38, air: 0.3, killAt: 100, zoning: 0.8 },
};

export const DEFAULT_PROFILE: Profile = { range: 12, air: 0.3, killAt: 100, zoning: 0.3 };

export function profileOf(fighter: string): Profile {
  return PROFILES[fighter] ?? DEFAULT_PROFILE;
}
