import { describe, expect, it } from 'vitest';
import { STATE_BYTES, checksum, knockOut, loadState, saveState, step } from '@game/sim-core';
import { createMatchView, readMatch, type MatchPhase } from '../../src/index.ts';
import { Rng, createMatch, randomMatch, randomStep } from './harness.ts';

/**
 * Propriété exigée par le rollback (critère de succès n° 2), sur des matchs complets :
 * step×N → save → step×M → load → step×M (mêmes inputs, mêmes KO imposés) redonne le même état,
 * état de match compris, quelle que soit la phase au moment de la sauvegarde.
 */
describe('rollback de l’état de match', () => {
  // 500 matchs complets : quelques secondes sur un poste, plus de 10 s sur une machine de CI partagée.
  it('re-simule à l’identique sur 500 matchs tirés au hasard, dans toutes les phases', () => {
    const draw = new Rng(777);
    const snap = new Uint8Array(STATE_BYTES);
    const view = createMatchView();
    const phases = new Map<MatchPhase, number>();
    let respawning = 0;

    for (let t = 0; t < 500; t++) {
      const match = randomMatch(draw);
      const players = match.players.length;
      const sim = createMatch(match, draw.next());
      const rng = new Rng(draw.next());
      const inputs = new Uint32Array(players);
      const koEvery = 10 + draw.range(40);
      const n = draw.range(1500);
      const m = 1 + draw.range(40);

      // Un tirage sur trois sauvegarde peu après l'entrée en mort subite, phase brève qu'un
      // point de sauvegarde pris au hasard n'atteindrait presque jamais.
      const aimSudden = draw.range(3) === 0;
      const after = draw.range(20);
      let f = 0;
      for (; f < n || aimSudden; f++) {
        randomStep(sim, rng, inputs, koEvery);
        if (!aimSudden) continue;
        readMatch(sim, view);
        if (view.phase === 'over' || f > 20000) break;
        if (view.phase === 'sudden-death') {
          for (let k = 0; k < after; k++) randomStep(sim, rng, inputs, koEvery);
          break;
        }
      }
      saveState(sim, snap);
      readMatch(sim, view);
      phases.set(view.phase, (phases.get(view.phase) ?? 0) + 1);
      if (view.respawnIn.some((w) => w > 0)) respawning++;

      const recorded = new Uint32Array(m * players);
      const kos = new Int32Array(m);
      for (let f = 0; f < m; f++) {
        for (let i = 0; i < players; i++) if (rng.range(4) === 0) inputs[i] = rng.next();
        kos[f] = rng.range(koEvery) === 0 ? rng.range(players) : -1;
        recorded.set(inputs, f * players);
        if (kos[f]! >= 0) knockOut(sim, kos[f]!);
        step(sim, inputs);
      }
      const expected = checksum(sim);

      loadState(sim, snap);
      for (let f = 0; f < m; f++) {
        if (kos[f]! >= 0) knockOut(sim, kos[f]!);
        step(sim, recorded.subarray(f * players, (f + 1) * players));
      }
      if (checksum(sim) !== expected) {
        throw new Error(
          `Divergence au tirage ${t} : ${match.mode}, ${players} joueurs, N=${n}, M=${m}.`,
        );
      }
    }

    // Le tirage atteint bien chaque phase et des réapparitions en attente.
    expect(phases.get('playing') ?? 0).toBeGreaterThan(20);
    expect(phases.get('sudden-death') ?? 0).toBeGreaterThan(5);
    expect(phases.get('over') ?? 0).toBeGreaterThan(20);
    expect(respawning).toBeGreaterThan(20);
  }, 60_000);

  it('une re-simulation avec un KO différent change l’état de match', () => {
    const sim = createMatch(randomMatch(new Rng(5)), 1);
    const snap = new Uint8Array(STATE_BYTES);
    const inputs = new Uint32Array(sim.config.fighters.length);
    saveState(sim, snap);
    knockOut(sim, 0);
    step(sim, inputs);
    const expected = checksum(sim);
    loadState(sim, snap);
    knockOut(sim, 1);
    step(sim, inputs);
    expect(checksum(sim)).not.toBe(expected);
  });
});
