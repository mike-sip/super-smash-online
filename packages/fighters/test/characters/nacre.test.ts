import { BTN_SPECIAL, MAX_ENTITIES, fx, step, type Sim } from '@game/sim-core';
import { describe, expect, it } from 'vitest';
import { NACRE } from '../../src/characters/nacre.ts';
import { formatIssue, validateCharacter } from '../../src/validate.ts';
import { NEUTRAL, commonScenarios, duel, stick } from './harness.ts';

/** Emplacement du premier projectile de Nacre (joueur 0), ou -1. */
function firstEntity(sim: Sim): number {
  for (let e = 0; e < MAX_ENTITIES; e++) {
    if (sim.state.eKind[e] !== 0 && sim.state.eOwner[e] === 1) return e;
  }
  return -1;
}

/** Nacre seule au centre (la cible est écartée), lance un spécial et laisse passer `frames`. */
function cast(input: number, frames: number): Sim {
  const sim = duel(NACRE);
  const s = sim.state;
  s.posX[0] = fx(-30);
  s.facing[0] = 1;
  s.posX[1] = fx(55);
  const inputs = new Uint32Array(2);
  inputs[0] = input;
  step(sim, inputs);
  inputs[0] = NEUTRAL;
  for (let f = 0; f < frames; f++) step(sim, inputs);
  return sim;
}

describe('Nacre', () => {
  it('a des données valides', () => {
    expect(validateCharacter(NACRE).map(formatIssue)).toEqual([]);
  });

  it('pose un corail qui reste immobile au sol', () => {
    const sim = cast(stick(0, -70, BTN_SPECIAL), 120);
    const e = firstEntity(sim);
    expect(e).toBeGreaterThanOrEqual(0);
    const s = sim.state;
    expect(sim.config.entities![s.eKind[e]! - 1]!.name).toBe('Corail');
    expect(s.eVelX[e]).toBe(0);
    expect(s.eVelY[e]).toBe(0);
    // Posé sur le bloc principal (dessus en y = 0), à son rayon au-dessus.
    expect(s.ePosY[e]).toBe(fx(2.2));
  });

  it('lance un galet en cloche qui rebondit', () => {
    const sim = duel(NACRE);
    const s = sim.state;
    s.posX[0] = fx(-55);
    s.facing[0] = 1;
    s.posX[1] = fx(55);
    const inputs = new Uint32Array(2);
    inputs[0] = stick(70, 0, BTN_SPECIAL);
    step(sim, inputs);
    inputs[0] = NEUTRAL;
    let rose = false;
    let bounced = false;
    let falling = false;
    for (let f = 0; f < 120; f++) {
      step(sim, inputs);
      const e = firstEntity(sim);
      if (e < 0) continue;
      const vy = s.eVelY[e]!;
      if (vy > 0 && !falling) rose = true;
      if (vy < 0) falling = true;
      if (falling && vy > 0) bounced = true;
    }
    expect(rose && bounced).toBe(true);
  });

  commonScenarios(NACRE);
});
