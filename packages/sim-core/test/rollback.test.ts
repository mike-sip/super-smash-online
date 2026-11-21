import { describe, expect, it } from 'vitest';
import { STATE_BYTES, checksum, createSim, loadState, saveState, step } from '../src/index.ts';
import { testConfig } from '../src/testing/fixtures.ts';
import { InputStream } from './determinism/harness.ts';

/**
 * Propriété exigée par le rollback (critère de succès n° 2) :
 * step×N → save → step×M → load → step×M (mêmes inputs) redonne le même état.
 */
describe('rollback', () => {
  it('re-simule à l’identique après restauration, sur 1 000 tirages', () => {
    const draw = new InputStream(4242);
    const snap = new Uint8Array(STATE_BYTES);

    for (let t = 0; t < 1000; t++) {
      const players = 2 + draw.range(7);
      const n = draw.range(120);
      const m = 1 + draw.range(12);
      const sim = createSim(testConfig(players, draw.next()));
      const stream = new InputStream(draw.next());
      const inputs = new Uint32Array(players);

      for (let f = 0; f < n; f++) {
        stream.fill(inputs);
        step(sim, inputs);
      }
      saveState(sim, snap);

      const recorded = new Uint32Array(m * players);
      for (let f = 0; f < m; f++) {
        stream.fill(inputs);
        recorded.set(inputs, f * players);
        step(sim, inputs);
      }
      const expected = checksum(sim);

      loadState(sim, snap);
      for (let f = 0; f < m; f++) {
        step(sim, recorded.subarray(f * players, (f + 1) * players));
      }

      if (checksum(sim) !== expected) {
        throw new Error(`Divergence au tirage ${t} : ${players} joueurs, N=${n}, M=${m}.`);
      }
    }
  });

  it('détecte une re-simulation avec des inputs différents', () => {
    const sim = createSim(testConfig(2));
    const snap = new Uint8Array(STATE_BYTES);
    saveState(sim, snap);
    step(sim, new Uint32Array([1, 2]));
    const expected = checksum(sim);
    loadState(sim, snap);
    step(sim, new Uint32Array([1, 3]));
    expect(checksum(sim)).not.toBe(expected);
  });
});
