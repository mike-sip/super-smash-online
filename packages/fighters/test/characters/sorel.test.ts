import { M_NSPECIAL, M_ULTIMATE } from '@game/sim-core';
import { describe, expect, it } from 'vitest';
import { SOREL } from '../../src/characters/sorel.ts';
import { formatIssue, validateCharacter } from '../../src/validate.ts';
import { commonScenarios, duel } from './harness.ts';

describe('Sorel', () => {
  it('a des données valides', () => {
    expect(validateCharacter(SOREL).map(formatIssue)).toEqual([]);
  });

  it('lance un trait de vent, renuméroté dans la configuration du match', () => {
    const sim = duel(SOREL);
    const spawn = sim.config.fighters[0]!.moves[M_NSPECIAL]!.spawn!;
    expect(sim.config.entities![spawn.kind - 1]!.name).toBe('Trait de vent');
  });

  it('est invincible pendant toute son ultime', () => {
    const ult = SOREL.def.moves[M_ULTIMATE]!;
    expect(ult.intangible).toEqual({ start: 1, end: ult.totalFrames });
  });

  commonScenarios(SOREL);
});
