import { describe, expect, it } from 'vitest';
import {
  createMatchHud,
  formatClock,
  type MatchHudData,
  type MatchHudSink,
} from '../src/match-hud.ts';

function recorder(): MatchHudSink & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    setClock: (text) => calls.push(`clock ${text}`),
    setStocks: (p, n) => calls.push(`stocks ${p} ${n}`),
    setHp: (p, hp) => calls.push(`hp ${p} ${hp}`),
    setScore: (p, s) => calls.push(`score ${p} ${s}`),
    setMeter: (p, percent, ready) => calls.push(`meter ${p} ${percent} ${ready}`),
    setTeam: (p, team) => calls.push(`team ${p} ${team}`),
    setEliminated: (p, out) => calls.push(`out ${p} ${out}`),
    dispose: () => calls.push('dispose'),
  };
}

function data(overrides: Partial<MatchHudData> = {}): MatchHudData {
  return {
    players: 2,
    phase: 'playing',
    timeLeft: 125,
    showScore: false,
    meterEnabled: true,
    stocks: [3, 3],
    hp: [-1, -1],
    score: [0, 0],
    meter: [0, 0],
    ultimateReady: [0, 0],
    team: [-1, -1],
    eliminated: [0, 0],
    ...overrides,
  };
}

describe('HUD de match', () => {
  it('formate le chronomètre, la mort subite et la fin', () => {
    expect(formatClock(125, 'playing')).toBe('2:05');
    expect(formatClock(9, 'playing')).toBe('0:09');
    expect(formatClock(-1, 'playing')).toBe('');
    expect(formatClock(-1, 'sudden-death')).toBe('Mort subite');
    expect(formatClock(0, 'over')).toBe('Terminé');
  });

  it('écrit tout à la première mise à jour', () => {
    const sink = recorder();
    createMatchHud(2, sink).update(data());
    expect(sink.calls).toEqual([
      'clock 2:05',
      'stocks 0 3',
      'hp 0 -1',
      'score 0 null',
      'meter 0 0 false',
      'team 0 -1',
      'out 0 false',
      'stocks 1 3',
      'hp 1 -1',
      'score 1 null',
      'meter 1 0 false',
      'team 1 -1',
      'out 1 false',
    ]);
  });

  it('ne touche à rien quand rien ne change à l’affichage, image après image', () => {
    const sink = recorder();
    const hud = createMatchHud(2, sink);
    hud.update(data());
    sink.calls.length = 0;
    for (let f = 0; f < 600; f++) hud.update(data({ meter: [0.001 * (f % 9), 0] }));
    expect(sink.calls).toEqual([]);
  });

  it('n’écrit que ce qui change : seconde, vie, jauge au pour cent près', () => {
    const sink = recorder();
    const hud = createMatchHud(2, sink);
    hud.update(data());
    sink.calls.length = 0;
    hud.update(data({ timeLeft: 124, stocks: [2, 3], meter: [0, 0.426], ultimateReady: [0, 0] }));
    expect(sink.calls).toEqual(['clock 2:04', 'stocks 0 2', 'meter 1 42 false']);
    sink.calls.length = 0;
    hud.update(data({ timeLeft: 124, stocks: [2, 3], meter: [0, 1], ultimateReady: [0, 1] }));
    expect(sink.calls).toEqual(['meter 1 100 true']);
  });

  it('masque la jauge quand elle est désactivée, et affiche le score en mode Temps', () => {
    const sink = recorder();
    createMatchHud(1, sink).update(
      data({ players: 1, meterEnabled: false, showScore: true, stocks: [-1], score: [-2] }),
    );
    expect(sink.calls).toContain('meter 0 -1 false');
    expect(sink.calls).toContain('score 0 -2');
  });

  it('libère sa sortie', () => {
    const sink = recorder();
    createMatchHud(1, sink).dispose();
    expect(sink.calls).toEqual(['dispose']);
  });
});
