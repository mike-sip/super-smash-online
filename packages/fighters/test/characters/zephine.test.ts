import { BTN_JUMP, step } from '@game/sim-core';
import { describe, expect, it } from 'vitest';
import { ZEPHINE } from '../../src/characters/zephine.ts';
import { formatIssue, validateCharacter } from '../../src/validate.ts';
import { NEUTRAL, commonScenarios, duel, press } from './harness.ts';

describe('Zéphine', () => {
  it('a des données valides', () => {
    expect(validateCharacter(ZEPHINE).map(formatIssue)).toEqual([]);
  });

  it('enchaîne deux sauts aériens', () => {
    const sim = duel(ZEPHINE);
    const s = sim.state;
    const inputs = new Uint32Array(2);
    const play = (input: number, n: number) => {
      inputs[0] = input;
      for (let f = 0; f < n; f++) step(sim, inputs);
    };
    play(press(BTN_JUMP), 1);
    play(NEUTRAL, 20);
    expect(s.grounded[0]).toBe(0);
    for (let jump = 0; jump < 2; jump++) {
      const before = s.jumpsLeft[0]!;
      play(press(BTN_JUMP), 1);
      expect(s.jumpsLeft[0]).toBe(before - 1);
      expect(s.velY[0]).toBeGreaterThan(0);
      play(NEUTRAL, 12);
    }
    expect(s.jumpsLeft[0]).toBe(0);
  });

  commonScenarios(ZEPHINE);
});
