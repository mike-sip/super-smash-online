import { describe, expect, it } from 'vitest';
import { BTN_ATTACK, BTN_JUMP, checksum, createSim, encodeInput, step } from '@game/sim-core';
import { testConfig } from '@game/sim-core/testing';
import { createRendererWith } from '../src/renderer.ts';
import { fakeBackend } from './helpers.ts';

describe('non-ingérence', () => {
  it('laisse le checksum de la simulation intact après capture et draw', () => {
    const config = testConfig(4);
    const sim = createSim(config);
    const backend = fakeBackend();
    const renderer = createRendererWith(config, backend);
    renderer.resize(1280, 720, 1);

    const inputs = new Uint32Array(4);
    for (let f = 0; f < 240; f++) {
      inputs[0] = encodeInput(127, 0, f % 40 < 3 ? BTN_JUMP : 0);
      inputs[1] = encodeInput(-127, 0, f % 25 === 0 ? BTN_ATTACK : 0);
      inputs[2] = encodeInput(0, f % 60 < 30 ? -127 : 0, 0);
      step(sim, inputs);

      const before = checksum(sim);
      renderer.capture(sim);
      renderer.draw(0);
      renderer.draw(0.5);
      renderer.draw(1);
      expect(checksum(sim)).toBe(before);
    }
    expect(backend.draws).toBe(720);
  });

  it('donne le même combat avec ou sans rendu', () => {
    const run = (withRender: boolean): number => {
      const config = testConfig(2);
      const sim = createSim(config);
      const renderer = withRender ? createRendererWith(config, fakeBackend()) : undefined;
      const inputs = new Uint32Array(2);
      for (let f = 0; f < 300; f++) {
        inputs[0] = encodeInput(127, 0, f % 30 === 0 ? BTN_ATTACK : 0);
        step(sim, inputs);
        renderer?.capture(sim);
        renderer?.draw(0.5);
      }
      return checksum(sim);
    };
    expect(run(true)).toBe(run(false));
  });

  it('dessine sans capture préalable et libère son backend', () => {
    const backend = fakeBackend();
    const renderer = createRendererWith(testConfig(2), backend);
    renderer.draw(0);
    expect(backend.draws).toBe(1);
    renderer.dispose();
    expect(backend.disposed).toBe(true);
  });
});
