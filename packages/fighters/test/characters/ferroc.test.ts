import { A_ATTACK, BTN_ATTACK, BTN_SPECIAL, M_SSPECIAL, fx, step } from '@game/sim-core';
import { describe, expect, it } from 'vitest';
import { FERROC } from '../../src/characters/ferroc.ts';
import { formatIssue, validateCharacter } from '../../src/validate.ts';
import { NEUTRAL, commonScenarios, duel, press, stick } from './harness.ts';

describe('Ferroc', () => {
  it('a des données valides', () => {
    expect(validateCharacter(FERROC).map(formatIssue)).toEqual([]);
  });

  it('encaisse un jab pendant le Rempart sans être interrompu', () => {
    const sim = duel(FERROC);
    const s = sim.state;
    s.posX[0] = fx(0);
    s.facing[0] = 1;
    s.posX[1] = fx(8);
    s.facing[1] = -1;
    const inputs = new Uint32Array(2);
    inputs[0] = stick(70, 0, BTN_SPECIAL);
    inputs[1] = press(BTN_ATTACK);
    step(sim, inputs);
    inputs[0] = NEUTRAL;
    inputs[1] = NEUTRAL;
    for (let f = 0; f < 4; f++) step(sim, inputs);
    // Le jab du combattant de test (3 %, frames 3 et 4) a touché Ferroc pendant son armure.
    expect(s.damage[0]).toBe(fx(3));
    expect(s.action[0]).toBe(A_ATTACK);
    expect(s.move[0]).toBe(M_SSPECIAL);
  });

  commonScenarios(FERROC);
});
