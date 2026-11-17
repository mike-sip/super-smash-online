import { STATE_BYTES, checksum, loadState, saveState } from '@game/sim-core';
import { describe, expect, it } from 'vitest';
import { fingerprint } from '../src/fingerprint.ts';
import { ROSTER } from '../src/roster.ts';
import { AutoMatch, Rng, mixedConfig } from './sim-helpers.ts';

function playFrames(seed: number, frames: number): number {
  const match = new AutoMatch(mixedConfig(8, seed), seed * 31);
  for (let f = 0; f < frames; f++) {
    match.draw();
    match.play();
  }
  return checksum(match.sim);
}

describe('déterminisme avec les quatre personnages', () => {
  it('donne le même checksum à deux exécutions de 3 600 frames à 8 joueurs', () => {
    expect(playFrames(7, 3600)).toBe(playFrames(7, 3600));
    expect(playFrames(7, 3600)).not.toBe(playFrames(8, 3600));
  });

  it('re-simule à l’identique après restauration, sur 200 tirages', () => {
    const draw = new Rng(99);
    const snap = new Uint8Array(STATE_BYTES);
    for (let t = 0; t < 200; t++) {
      const players = 2 + draw.range(7);
      const match = new AutoMatch(mixedConfig(players, draw.next()), draw.next());
      const n = draw.range(300);
      const m = 1 + draw.range(12);
      for (let f = 0; f < n; f++) {
        match.draw();
        match.play();
      }
      saveState(match.sim, snap);
      const recorded: Uint32Array[] = [];
      for (let f = 0; f < m; f++) {
        match.draw(false);
        recorded.push(match.inputs.slice());
        match.play(match.inputs, false);
      }
      const expected = checksum(match.sim);
      loadState(match.sim, snap);
      for (const inputs of recorded) match.play(inputs, false);
      expect(checksum(match.sim)).toBe(expected);
    }
  });

  it('donne une empreinte distincte à chaque personnage', () => {
    expect(new Set(ROSTER.map(fingerprint)).size).toBe(ROSTER.length);
  });
});
