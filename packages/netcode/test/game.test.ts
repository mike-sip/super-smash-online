import { describe, expect, it } from 'vitest';
import {
  A_DEAD,
  STATE_BYTES,
  checksum,
  createFighterView,
  createSim,
  readFighter,
  saveState,
} from '@game/sim-core';
import { testConfig } from '@game/sim-core/testing';
import { RESPAWN_FRAMES, simGame, stepWithRespawn } from '../src/game.ts';
import { HumanInputs, testGame } from './helpers.ts';

describe('simGame', () => {
  it('expose la simulation : joueurs, taille, sauvegarde, restauration, empreinte', () => {
    const sim = createSim(testConfig(3, 7));
    const game = simGame(sim);
    expect(game.players).toBe(3);
    expect(game.stateBytes).toBe(STATE_BYTES);
    expect(game.checksum()).toBe(checksum(sim));

    const saved = new Uint8Array(game.stateBytes);
    game.save(saved);
    const direct = new Uint8Array(STATE_BYTES);
    saveState(sim, direct);
    expect(saved).toEqual(direct);

    const before = game.checksum();
    game.step(new Uint32Array([0xffff_ffff, 0, 0]));
    expect(game.checksum()).not.toBe(before);
    game.load(saved);
    expect(game.checksum()).toBe(before);
  });

  it('utilise la fonction d’avance fournie', () => {
    const sim = createSim(testConfig(2));
    let calls = 0;
    const game = simGame(sim, () => calls++);
    game.step(new Uint32Array(2));
    expect(calls).toBe(1);
  });
});

describe('stepWithRespawn', () => {
  it('fait réapparaître un joueur KO après RESPAWN_FRAMES frames, d’après l’état seul', () => {
    const { sim, game } = testGame(2);
    // Joueur 0 : stick à fond vers la gauche jusqu'à sortir du stage.
    const left = new Uint32Array([0x0000_0081 /* stick X = -127 */, 0]);
    const view = createFighterView();
    let deadAt = -1;
    for (let f = 0; f < 2000 && deadAt < 0; f++) {
      game.step(left);
      readFighter(sim, 0, view);
      if (view.action === A_DEAD) deadAt = f;
    }
    expect(deadAt).toBeGreaterThan(0);
    const idle = new Uint32Array(2);
    for (let f = 0; f < RESPAWN_FRAMES - 1; f++) {
      game.step(idle);
      readFighter(sim, 0, view);
      expect(view.action).toBe(A_DEAD);
    }
    game.step(idle);
    readFighter(sim, 0, view);
    expect(view.action).not.toBe(A_DEAD);
  });

  it('reste juste après une sauvegarde et une restauration', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { game } = testGame(4, seed);
      const humans = [0, 1, 2, 3].map((p) => new HumanInputs(seed * 10 + p));
      const frames: Uint32Array[] = [];
      for (let f = 0; f < 1500; f++) frames.push(Uint32Array.from(humans, (h) => h.next()));
      const split = 600 + seed * 13;
      for (let f = 0; f < split; f++) game.step(frames[f]!);
      const saved = new Uint8Array(game.stateBytes);
      game.save(saved);
      for (let f = split; f < frames.length; f++) game.step(frames[f]!);
      const straight = game.checksum();
      game.load(saved);
      for (let f = split; f < frames.length; f++) game.step(frames[f]!);
      expect(game.checksum()).toBe(straight);
    }
  });

  it('est la règle utilisée par les deux côtés d’une comparaison directe', () => {
    const a = createSim(testConfig(2));
    const b = createSim(testConfig(2));
    const inputs = new Uint32Array([0x81, 0x7f]);
    for (let f = 0; f < 900; f++) {
      stepWithRespawn(a, inputs);
      stepWithRespawn(b, inputs);
    }
    expect(checksum(a)).toBe(checksum(b));
  });
});
