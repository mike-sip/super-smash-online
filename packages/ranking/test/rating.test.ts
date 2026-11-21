import { describe, expect, it } from 'vitest';
import {
  INITIAL_RATING,
  K_FACTOR,
  computeRatingChanges,
  roundPreservingSum,
  standings,
  type RatingPlayer,
} from '../src/rating.ts';

/** Joueur classé (cote 1000 par défaut), en chacun pour soi. */
function p(id: string, placement: number, extra: Partial<RatingPlayer> = {}): RatingPlayer {
  return { accountId: id, rating: 1000, team: -1, placement, leftAtFrame: null, ...extra };
}

/** Variations par identifiant. */
function deltas(teams: boolean, players: RatingPlayer[]): Record<string, number> {
  const result = computeRatingChanges({ teams, players });
  return Object.fromEntries(result.changes.map((c) => [c.accountId, c.delta]));
}

describe('constantes', () => {
  it('K = 32, cote de départ 1000', () => {
    expect(K_FACTOR).toBe(32);
    expect(INITIAL_RATING).toBe(1000);
  });
});

describe('roundPreservingSum', () => {
  it('arrondit à l’entier inférieur puis rend les points manquants aux plus grandes parties fractionnaires', () => {
    const values = [16, 16 * (5 / 7), 16 * (3 / 7), 16 * (1 / 7)];
    const all = [...values, ...values.map((v) => -v)];
    const rounded = roundPreservingSum(all.map((value, i) => ({ id: `p${i}`, value })));
    expect(all.map((_, i) => rounded.get(`p${i}`))).toEqual([16, 11, 7, 2, -16, -11, -7, -2]);
  });

  it('départage les parties fractionnaires égales par identifiant croissant', () => {
    const third = 32 / 3;
    const rounded = roundPreservingSum([
      { id: 'c', value: -third },
      { id: 'a', value: -third },
      { id: 'b', value: -third },
      { id: 'z', value: 32 },
    ]);
    expect(Object.fromEntries(rounded)).toEqual({ a: -10, b: -11, c: -11, z: 32 });
  });

  it('refuse des valeurs dont la somme n’est pas nulle', () => {
    expect(() => roundPreservingSum([{ id: 'a', value: 1 }])).toThrow();
  });

  it('accepte une liste vide', () => {
    expect(roundPreservingSum([]).size).toBe(0);
  });
});

describe('chacun pour soi', () => {
  it('2 joueurs de même cote : +16 / −16', () => {
    expect(deltas(false, [p('a', 1), p('b', 2)])).toEqual({ a: 16, b: -16 });
  });

  it('2 joueurs, écart de 400 : le favori gagne +3, l’outsider gagne +29', () => {
    expect(deltas(false, [p('a', 1, { rating: 1400 }), p('b', 2)])).toEqual({ a: 3, b: -3 });
    expect(deltas(false, [p('a', 2, { rating: 1400 }), p('b', 1)])).toEqual({ a: -29, b: 29 });
  });

  it('égalité : 0 à cotes égales, l’outsider gagne 13 à 400 d’écart', () => {
    expect(deltas(false, [p('a', 1), p('b', 1)])).toEqual({ a: 0, b: 0 });
    expect(deltas(false, [p('a', 1, { rating: 1400 }), p('b', 1)])).toEqual({ a: -13, b: 13 });
  });

  it('8 joueurs de même cote, places 1 à 8 : +16, +11, +7, +2, −2, −7, −11, −16', () => {
    const players = 'abcdefgh'.split('').map((id, i) => p(id, i + 1));
    expect(Object.values(deltas(false, players))).toEqual([16, 11, 7, 2, -2, -7, -11, -16]);
  });

  it('8 joueurs avec ex æquo (1, 1, 3, 3, 3, 6, 7, 8)', () => {
    const places = [1, 1, 3, 3, 3, 6, 7, 8];
    const players = places.map((place, i) => p(`p${i}`, place));
    expect(Object.values(deltas(false, players))).toEqual([14, 14, 2, 2, 2, -7, -11, -16]);
  });

  it('renvoie avant, après et variation', () => {
    const result = computeRatingChanges({
      teams: false,
      players: [p('a', 1, { rating: 1200 }), p('b', 2, { rating: 1200 })],
    });
    expect(result.ranked).toBe(true);
    expect(result.changes).toEqual([
      { accountId: 'a', before: 1200, after: 1216, delta: 16 },
      { accountId: 'b', before: 1200, after: 1184, delta: -16 },
    ]);
  });
});

describe('équipes', () => {
  it('2 contre 2 de même cote : ±16 pour chacun', () => {
    const players = [
      p('a', 1, { team: 0 }),
      p('b', 1, { team: 0 }),
      p('c', 2, { team: 1 }),
      p('d', 2, { team: 1 }),
    ];
    expect(deltas(true, players)).toEqual({ a: 16, b: 16, c: -16, d: -16 });
  });

  it('la cote d’une équipe est la moyenne de ses membres', () => {
    const players = [
      p('a', 1, { team: 0, rating: 1200 }),
      p('b', 1, { team: 0, rating: 1000 }),
      p('c', 2, { team: 1, rating: 1100 }),
      p('d', 2, { team: 1, rating: 1100 }),
    ];
    expect(deltas(true, players)).toEqual({ a: 16, b: 16, c: -16, d: -16 });
  });

  it('3 contre 1 de même cote, le joueur seul gagne : +32, et −10 / −11 / −11', () => {
    const players = [
      p('solo', 1, { team: 1 }),
      p('m1', 2, { team: 0 }),
      p('m2', 2, { team: 0 }),
      p('m3', 2, { team: 0 }),
    ];
    expect(deltas(true, players)).toEqual({ solo: 32, m1: -10, m2: -11, m3: -11 });
  });

  it('4 équipes de 2, places 1 à 4 : +16, +5, −5, −16', () => {
    const players = [0, 1, 2, 3].flatMap((team) => [
      p(`t${team}a`, team + 1, { team }),
      p(`t${team}b`, team + 1, { team }),
    ]);
    expect(Object.values(deltas(true, players))).toEqual([16, 16, 5, 5, -5, -5, -16, -16]);
  });
});

describe('abandons', () => {
  it('un partant est classé dernier, même si match-rules le classait premier', () => {
    const players = [p('left', 1, { leftAtFrame: 600 }), p('b', 2), p('c', 3)];
    expect(deltas(false, players)).toEqual({ left: -16, b: 16, c: 0 });
  });

  it('plusieurs partants : le plus tôt parti est derrière', () => {
    const players = [
      p('a', 1),
      p('b', 2),
      p('c', 3, { leftAtFrame: 100 }),
      p('d', 4, { leftAtFrame: 200 }),
    ];
    expect(deltas(false, players)).toEqual({ a: 16, b: 5, d: -5, c: -16 });
  });

  it('partis à la même frame : ex æquo', () => {
    const players = [
      p('a', 1),
      p('b', 2),
      p('c', 3, { leftAtFrame: 100 }),
      p('d', 4, { leftAtFrame: 100 }),
    ];
    expect(deltas(false, players)).toEqual({ a: 16, b: 5, c: -10, d: -11 });
  });

  it('en équipes : le partant quitte son équipe, seul et dernier ; ses coéquipiers gardent leur place', () => {
    const players = [
      p('a', 1, { team: 0 }),
      p('b', 1, { team: 0, leftAtFrame: 900 }),
      p('c', 2, { team: 1 }),
      p('d', 2, { team: 1 }),
    ];
    expect(deltas(true, players)).toEqual({ a: 19, b: -19, c: 0, d: 0 });
  });

  it('le dernier présent bat tous les partants', () => {
    const players = [p('a', 2), p('b', 1, { leftAtFrame: 10 }), p('c', 3, { leftAtFrame: 20 })];
    const result = deltas(false, players);
    expect(result.a).toBe(16);
    expect(result.b).toBe(-16);
  });
});

describe('invités et matchs non classés', () => {
  it('les invités sont retirés : les inscrits sont comparés selon leurs places', () => {
    const players = [p('guest', 1, { rating: null }), p('a', 2), p('b', 3)];
    expect(deltas(false, players)).toEqual({ a: 16, b: -16 });
  });

  it('moins de deux unités classées : match non classé, aucune variation', () => {
    const lone = computeRatingChanges({
      teams: false,
      players: [p('guest', 1, { rating: null }), p('a', 2)],
    });
    expect(lone).toEqual({ ranked: false, changes: [] });
    const teamOfGuests = computeRatingChanges({
      teams: true,
      players: [
        p('a', 1, { team: 0 }),
        p('b', 1, { team: 0 }),
        p('g1', 2, { team: 1, rating: null }),
        p('g2', 2, { team: 1, rating: null }),
      ],
    });
    expect(teamOfGuests).toEqual({ ranked: false, changes: [] });
  });

  it('un inscrit seul de son équipe face à des invités et un autre inscrit', () => {
    const players = [
      p('a', 1, { team: 0 }),
      p('g', 1, { team: 0, rating: null }),
      p('b', 2, { team: 1 }),
    ];
    expect(deltas(true, players)).toEqual({ a: 16, b: -16 });
  });
});

describe('standings', () => {
  it('donne la place effective et le nombre d’unités, invités compris', () => {
    const result = standings({
      teams: false,
      players: [p('left', 1, { leftAtFrame: 5 }), p('g', 2, { rating: null }), p('b', 3)],
    });
    expect(result).toEqual({ units: 3, placements: [3, 1, 2] });
  });

  it('en équipes, un partant forme une unité de plus', () => {
    const result = standings({
      teams: true,
      players: [
        p('a', 1, { team: 0 }),
        p('b', 1, { team: 0, leftAtFrame: 9 }),
        p('c', 2, { team: 1 }),
        p('d', 2, { team: 1 }),
      ],
    });
    expect(result).toEqual({ units: 3, placements: [1, 3, 2, 2] });
  });
});
