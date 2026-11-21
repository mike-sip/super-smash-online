/**
 * Déterminisme et rollback sur les vrais stages, objets à « high », 8 joueurs (critère n° 4).
 * Les KO réapparaissent aussitôt, comme le feront les règles de match, pour que la partie dure.
 */
import {
  EV_KO,
  STATE_BYTES,
  checksum,
  createSim,
  loadState,
  respawn,
  saveState,
  step,
  type Sim,
} from '@game/sim-core';
import { describe, expect, it } from 'vitest';
import { STAGES, applyItems, applyStage, type StageId } from '../src/index.ts';
import { baseConfig, lcg, randomInputs } from './helpers.ts';

function sim(id: StageId, players: number, seed: number): Sim {
  return createSim(applyItems(applyStage(baseConfig(players, seed), id), { frequency: 'high' }));
}

function stepWithRespawn(s: Sim, inputs: Uint32Array): void {
  step(s, inputs);
  for (let e = 0; e < s.events.count; e++) {
    if (s.events.type[e] === EV_KO) respawn(s, s.events.a[e]!);
  }
}

describe('déterminisme', () => {
  it('10 minutes à 8 joueurs se rejouent au bit près sur chaque stage', () => {
    for (const stage of STAGES) {
      const play = (): number => {
        const s = sim(stage.id, 8, 31);
        const next = lcg(310);
        const inputs = new Uint32Array(8);
        for (let f = 0; f < 36_000; f++) {
          randomInputs(next, inputs);
          stepWithRespawn(s, inputs);
        }
        return checksum(s);
      };
      expect(play(), stage.id).toBe(play());
    }
  }, 120_000);

  it('re-simule à l’identique après restauration, sur 200 tirages', () => {
    const draw = lcg(2026);
    const snap = new Uint8Array(STATE_BYTES);
    for (let t = 0; t < 200; t++) {
      const stage = STAGES[draw() % STAGES.length]!;
      const players = 2 + (draw() % 7);
      // Assez loin pour que des objets soient apparus (5 à 9 s à « high »).
      const n = draw() % 1200;
      const m = 1 + (draw() % 12);
      const s = sim(stage.id, players, draw());
      const next = lcg(draw());
      const inputs = new Uint32Array(players);
      for (let f = 0; f < n; f++) {
        randomInputs(next, inputs);
        stepWithRespawn(s, inputs);
      }
      saveState(s, snap);
      const recorded = new Uint32Array(m * players);
      for (let f = 0; f < m; f++) {
        randomInputs(next, inputs);
        recorded.set(inputs, f * players);
        stepWithRespawn(s, inputs);
      }
      const expected = checksum(s);
      loadState(s, snap);
      for (let f = 0; f < m; f++)
        stepWithRespawn(s, recorded.subarray(f * players, (f + 1) * players));
      if (checksum(s) !== expected) {
        throw new Error(
          `Divergence au tirage ${t} : ${stage.id}, ${players} joueurs, N=${n}, M=${m}.`,
        );
      }
    }
  }, 120_000);
});
