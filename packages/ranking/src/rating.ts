/**
 * Formule de la cote : Elo par paires adapté de 2 à 8 joueurs, en chacun pour soi et en équipes,
 * avec égalités et abandons. Fonctions pures, sans entrée-sortie. Voir SPEC-ranking.md,
 * « Formule de la cote » et « Ce qui compte, ou non ».
 */
import type { RatingChange } from './protocol.ts';

export const K_FACTOR = 32;
export const INITIAL_RATING = 1000;
/** Écart de cote pour lequel le favori a 10 chances sur 11 de gagner un duel. */
const SCALE = 400;

export interface RatingPlayer {
  readonly accountId: string;
  /** Cote avant le match ; `null` pour un joueur non classé (invité) : retiré du calcul. */
  readonly rating: number | null;
  /** Équipe (en équipes seulement). */
  readonly team: number;
  /** Place donnée par `match-rules` ; en équipes, celle de l'équipe. */
  readonly placement: number;
  /** Frame de départ définitif, ou `null`. */
  readonly leftAtFrame: number | null;
}

export interface RatingInput {
  readonly teams: boolean;
  readonly players: readonly RatingPlayer[];
}

/** Clé de tri d'une unité : plus petite = mieux classée. */
interface Rank {
  /** 0 : resté jusqu'au bout ; 1 : parti. */
  readonly left: 0 | 1;
  /** Resté : place d'origine ; parti : opposé de la frame de départ (parti plus tard = devant). */
  readonly order: number;
}

function rankOf(player: RatingPlayer): Rank {
  return player.leftAtFrame === null
    ? { left: 0, order: player.placement }
    : { left: 1, order: -player.leftAtFrame };
}

function compareRank(a: Rank, b: Rank): number {
  return a.left !== b.left ? a.left - b.left : a.order - b.order;
}

/**
 * Unité de chaque joueur : son équipe s'il est resté (en équipes), sinon lui seul. Renvoie une
 * clé d'unité par joueur.
 */
function unitKeys(input: RatingInput): string[] {
  return input.players.map((player, i) =>
    input.teams && player.leftAtFrame === null ? `team:${player.team}` : `player:${i}`,
  );
}

/**
 * Place effective de chaque joueur (règle d'abandon appliquée), invités compris, et nombre
 * d'unités classées. La place est 1 + le nombre d'unités strictement mieux classées.
 */
export function standings(input: RatingInput): { units: number; placements: number[] } {
  const keys = unitKeys(input);
  const unitRanks = new Map<string, Rank>();
  input.players.forEach((player, i) => unitRanks.set(keys[i]!, rankOf(player)));
  const ranks = [...unitRanks.values()];
  const placements = input.players.map((player) => {
    const own = rankOf(player);
    return 1 + ranks.filter((other) => compareRank(other, own) < 0).length;
  });
  return { units: unitRanks.size, placements };
}

/** Score attendu de `a` contre `b`. */
export function expectedScore(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / SCALE));
}

/**
 * Arrondit des variations de somme nulle en entiers de somme nulle : arrondi à l'entier
 * inférieur, puis un point à chacune des plus grandes parties fractionnaires (méthode du plus
 * fort reste), ex æquo départagés par identifiant croissant. Lève si la somme n'est pas nulle.
 */
export function roundPreservingSum(
  values: readonly { readonly id: string; readonly value: number }[],
): Map<string, number> {
  const total = values.reduce((sum, v) => sum + v.value, 0);
  if (Math.abs(total) > 1e-6) throw new Error(`Variations de somme non nulle (${total}).`);
  const parts = values.map((v) => {
    const int = Math.floor(v.value);
    return { id: v.id, int, frac: v.value - int };
  });
  const missing = Math.round(-parts.reduce((sum, part) => sum + part.int, 0));
  const order = [...parts].sort((a, b) =>
    a.frac !== b.frac ? b.frac - a.frac : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (let i = 0; i < missing; i++) order[i]!.int += 1;
  return new Map(parts.map((part) => [part.id, part.int]));
}

export interface RatingOutcome {
  /** Vrai si au moins deux unités de joueurs classés s'affrontent. */
  readonly ranked: boolean;
  /** Une entrée par joueur classé, dans l'ordre d'entrée ; vide si le match n'est pas classé. */
  readonly changes: RatingChange[];
}

/** Variations de cote d'un match. Voir la spec pour la formule et des exemples chiffrés. */
export function computeRatingChanges(input: RatingInput): RatingOutcome {
  const { placements } = standings(input);
  const keys = unitKeys(input);
  const rated: { player: RatingPlayer; rating: number; unit: string; placement: number }[] = [];
  input.players.forEach((player, i) => {
    if (player.rating !== null) {
      rated.push({ player, rating: player.rating, unit: keys[i]!, placement: placements[i]! });
    }
  });

  const unitRatings = new Map<string, { sum: number; count: number }>();
  for (const r of rated) {
    const unit = unitRatings.get(r.unit) ?? { sum: 0, count: 0 };
    unit.sum += r.rating;
    unit.count += 1;
    unitRatings.set(r.unit, unit);
  }
  if (unitRatings.size < 2) return { ranked: false, changes: [] };
  const mean = (unit: string): number => {
    const u = unitRatings.get(unit)!;
    return u.sum / u.count;
  };

  // D : nombre moyen d'adversaires par joueur classé ; constant dans le match, d'où la somme nulle.
  let opponents = 0;
  for (const r of rated) opponents += rated.filter((o) => o.unit !== r.unit).length;
  const divisor = opponents / rated.length;

  const raw = rated.map((r) => {
    let sum = 0;
    for (const o of rated) {
      if (o.unit === r.unit) continue;
      const score = r.placement < o.placement ? 1 : r.placement === o.placement ? 0.5 : 0;
      sum += score - expectedScore(mean(r.unit), mean(o.unit));
    }
    return { id: r.player.accountId, value: (K_FACTOR / divisor) * sum };
  });
  const rounded = roundPreservingSum(raw);
  return {
    ranked: true,
    changes: rated.map((r) => {
      const delta = rounded.get(r.player.accountId)!;
      return { accountId: r.player.accountId, before: r.rating, after: r.rating + delta, delta };
    }),
  };
}
