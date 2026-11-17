/**
 * Propriétés de la formule sur des milliers de matchs tirés au hasard (générateur à graine fixe :
 * un échec se rejoue à l'identique).
 */
import { describe, expect, it } from 'vitest';
import { INITIAL_RATING, computeRatingChanges, type RatingPlayer } from '../src/rating.ts';

/** mulberry32 : petit générateur pseudo-aléatoire reproductible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RandomMatch {
  teams: boolean;
  players: RatingPlayer[];
}

/** Places « olympiques » cohérentes à partir d'un score par unité (plus grand = mieux). */
function placementsFromScores(scores: number[]): number[] {
  return scores.map((s) => 1 + scores.filter((o) => o > s).length);
}

function randomMatch(
  next: () => number,
  pool: string[],
  ratings: Map<string, number>,
): RandomMatch {
  const count = 2 + Math.floor(next() * 7);
  const ids = [...pool].sort(() => next() - 0.5).slice(0, count);
  const teams = next() < 0.4;
  const teamOf = ids.map((_, i) => (teams ? (i < 2 ? i : Math.floor(next() * 4)) : -1));
  // Scores : peu de valeurs distinctes, pour produire des ex æquo.
  const unitScore = new Map<number, number>();
  const scores = ids.map((_, i) => {
    const key = teams ? teamOf[i]! : i;
    if (!unitScore.has(key)) unitScore.set(key, Math.floor(next() * 4));
    return unitScore.get(key)!;
  });
  const placements = placementsFromScores(scores);
  return {
    teams,
    players: ids.map((id, i) => ({
      accountId: id,
      rating: next() < 0.15 ? null : ratings.get(id)!,
      team: teamOf[i]!,
      placement: placements[i]!,
      leftAtFrame: next() < 0.12 ? Math.floor(next() * 3) * 100 : null,
    })),
  };
}

describe('propriétés de la formule', () => {
  it('10 000 matchs : chaque match à somme nulle, total des cotes constant', () => {
    const next = rng(20261115);
    const pool = Array.from({ length: 200 }, (_, i) => `acc-${String(i).padStart(3, '0')}`);
    const ratings = new Map(pool.map((id) => [id, INITIAL_RATING]));
    let ranked = 0;
    for (let m = 0; m < 10_000; m++) {
      const match = randomMatch(next, pool, ratings);
      const outcome = computeRatingChanges(match);
      const sum = outcome.changes.reduce((s, c) => s + c.delta, 0);
      expect(sum).toBe(0);
      for (const change of outcome.changes) {
        expect(Number.isInteger(change.delta)).toBe(true);
        expect(change.before).toBe(ratings.get(change.accountId));
        ratings.set(change.accountId, change.after);
      }
      if (outcome.ranked) ranked++;
    }
    const total = [...ratings.values()].reduce((s, r) => s + r, 0);
    expect(total).toBe(INITIAL_RATING * pool.length);
    expect(ranked).toBeGreaterThan(8_000);
    // Les cotes ont bougé : le test n'est pas trivial.
    expect(Math.max(...ratings.values()) - Math.min(...ratings.values())).toBeGreaterThan(100);
  });

  it('à cotes égales, en chacun pour soi, mieux classé ⇒ variation au moins aussi bonne', () => {
    const next = rng(7);
    for (let m = 0; m < 2_000; m++) {
      const count = 2 + Math.floor(next() * 7);
      const scores = Array.from({ length: count }, () => Math.floor(next() * 5));
      const placements = placementsFromScores(scores);
      const players = placements.map((placement, i) => ({
        accountId: `p${i}`,
        rating: 1000,
        team: -1,
        placement,
        leftAtFrame: null,
      }));
      const { changes } = computeRatingChanges({ teams: false, players });
      for (let i = 0; i < count; i++) {
        for (let j = 0; j < count; j++) {
          if (placements[i]! < placements[j]!) {
            expect(changes[i]!.delta).toBeGreaterThanOrEqual(changes[j]!.delta);
          }
        }
      }
    }
  });

  it('un partant seul ne gagne jamais de points ; en chacun pour soi, partir n’est jamais mieux que rester', () => {
    const next = rng(99);
    for (let m = 0; m < 3_000; m++) {
      const teams = next() < 0.5;
      const count = 2 + Math.floor(next() * 7);
      const teamOf = Array.from({ length: count }, (_, i) =>
        teams ? (i < 2 ? i : Math.floor(next() * 4)) : -1,
      );
      const unitScore = new Map<number, number>();
      const scores = teamOf.map((team, i) => {
        const key = teams ? team : i;
        if (!unitScore.has(key)) unitScore.set(key, Math.floor(next() * 4));
        return unitScore.get(key)!;
      });
      const placements = placementsFromScores(scores);
      const base = placements.map((placement, i) => ({
        accountId: `p${i}`,
        rating: 600 + Math.floor(next() * 1200),
        team: teamOf[i]!,
        placement,
        leftAtFrame: null as number | null,
      }));
      const leaver = Math.floor(next() * count);
      const left = base.map((p, i) => (i === leaver ? { ...p, leftAtFrame: 50 } : p));
      const leaving = computeRatingChanges({ teams, players: left }).changes[leaver];
      if (leaving === undefined) continue;
      expect(leaving.delta).toBeLessThanOrEqual(0);

      // En chacun pour soi, partir n'est jamais mieux que rester à la même place.
      if (!teams) {
        const staying = computeRatingChanges({ teams, players: base }).changes[leaver]!;
        expect(leaving.delta).toBeLessThanOrEqual(staying.delta);
      }
    }
  });
});
