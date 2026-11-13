/** Test de contrat du saut au stick : son effet dans la vraie simulation, activé puis désactivé. */
import { describe, expect, it } from 'vitest';
import { A_ATTACK, M_UTILT, createFighterView, createSim, readFighter, step } from '@game/sim-core';
import { testConfig } from '@game/sim-core/testing';
import { KEYBOARD_ID, createInput } from '../src/index.ts';
import { fakeWindow } from './helpers.ts';

function rig(tapJump: boolean) {
  const sim = createSim(testConfig(2));
  const fake = fakeWindow();
  const input = createInput({ target: fake.window, players: 1 });
  input.assign(0, KEYBOARD_ID);
  input.setTapJump(0, tapJump);
  const inputs = new Uint32Array(2);
  const view = createFighterView();
  const frame = (count = 1) => {
    for (let f = 0; f < count; f++) {
      input.sample(inputs);
      step(sim, inputs);
    }
    readFighter(sim, 0, view);
    return view;
  };
  return { sim, fake, frame };
}

describe('contrat : saut au stick', () => {
  it('fait sauter en poussant le stick vers le haut quand l’option est activée', () => {
    const t = rig(true);
    t.fake.keyDown('ArrowUp');
    expect(t.frame(12).grounded).toBe(false);
  });

  it('laisse le combattant au sol quand elle est désactivée', () => {
    const t = rig(false);
    t.fake.keyDown('ArrowUp');
    for (let f = 0; f < 30; f++) expect(t.frame().grounded).toBe(true);
  });

  it('laisse l’attaque dirigée vers le haut possible, option activée', () => {
    const t = rig(true);
    t.fake.keyDown('ShiftLeft');
    t.fake.keyDown('ArrowUp');
    expect(t.frame(6).grounded).toBe(true);
    t.fake.keyDown('KeyX');
    t.frame();
    expect([t.sim.state.action[0], t.sim.state.move[0]]).toEqual([A_ATTACK, M_UTILT]);
  });
});
