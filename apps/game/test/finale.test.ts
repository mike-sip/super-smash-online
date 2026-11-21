import { describe, expect, it } from 'vitest';
import { isFinalKo, musicTension, type FinaleView } from '../src/finale.ts';

function view(stocks: number[], eliminated: number[] = [], team: number[] = []): FinaleView {
  return {
    players: stocks.length,
    teams: team.length > 0,
    stocks,
    team: team.length > 0 ? team : stocks.map(() => -1),
    eliminated: stocks.map((_, i) => eliminated[i] ?? 0),
  };
}

describe('coup final', () => {
  it('dernière vie du dernier duel : oui ; plus d’une vie ou plus de deux joueurs : non', () => {
    expect(isFinalKo(view([1, 2]), 0)).toBe(true);
    expect(isFinalKo(view([2, 1]), 0)).toBe(false);
    expect(isFinalKo(view([1, 1, 1]), 0)).toBe(false);
    expect(isFinalKo(view([1, 1, 0], [0, 0, 1]), 0)).toBe(true);
  });

  it('sans vies comptées (Temps, Endurance), pas de coup final', () => {
    expect(isFinalKo(view([-1, -1]), 0)).toBe(false);
  });

  it('en équipes : seulement si c’est le dernier debout de son camp', () => {
    expect(isFinalKo(view([1, 3, 2, 1], [], [0, 0, 1, 1]), 0)).toBe(false);
    expect(isFinalKo(view([1, 0, 2, 1], [0, 1, 0, 0], [0, 0, 1, 1]), 0)).toBe(true);
  });
});

describe('tension de la musique', () => {
  const base = (over: Partial<Parameters<typeof musicTension>[0]>) => ({
    ...view([2, 2]),
    timeLeft: -1,
    phase: 'playing',
    ...over,
  });
  it('monte à la dernière vie du dernier duel, dans les dernières secondes, en mort subite', () => {
    expect(musicTension(base({}))).toBe(0);
    expect(musicTension(base({ ...view([1, 3]) }))).toBe(1);
    expect(musicTension(base({ timeLeft: 25 }))).toBe(1);
    expect(musicTension(base({ timeLeft: 90 }))).toBe(0);
    expect(musicTension(base({ phase: 'sudden-death' }))).toBe(1);
    expect(musicTension(base({ ...view([1, 1]), phase: 'over' }))).toBe(0);
  });
});
