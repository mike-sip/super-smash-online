import { describe, expect, it } from 'vitest';
import {
  A_HITSTUN,
  A_IDLE,
  A_SHIELDSTUN,
  BTN_ATTACK,
  createSim,
  encodeInput,
  fx,
  loadState,
  saveState,
  step,
  STATE_BYTES,
} from '@game/sim-core';
import { testConfig } from '@game/sim-core/testing';
import { hitShake } from '../src/effects.ts';
import { createEventFilter, isNewFrame } from '../src/events.ts';
import { createRendererWith } from '../src/renderer.ts';
import { fakeBackend } from './helpers.ts';

describe('filtre d’événements', () => {
  it('accepte chaque frame une seule fois', () => {
    const filter = createEventFilter();
    expect(isNewFrame(filter, 1)).toBe(true);
    expect(isNewFrame(filter, 1)).toBe(false);
    expect(isNewFrame(filter, 2)).toBe(true);
  });

  it('refuse les frames rejouées après un retour en arrière, puis reprend', () => {
    const filter = createEventFilter();
    for (let f = 1; f <= 10; f++) expect(isNewFrame(filter, f)).toBe(true);
    // Rollback de quatre frames : 7 à 10 sont re-simulées, 11 est nouvelle.
    for (let f = 7; f <= 10; f++) expect(isNewFrame(filter, f)).toBe(false);
    expect(isNewFrame(filter, 11)).toBe(true);
  });

  it('accepte une frame après un saut en avant', () => {
    const filter = createEventFilter();
    expect(isNewFrame(filter, 5)).toBe(true);
    expect(isNewFrame(filter, 9)).toBe(true);
    expect(isNewFrame(filter, 8)).toBe(false);
  });

  it('repart de zéro avec un filtre neuf, pour une simulation neuve', () => {
    const old = createEventFilter();
    for (let f = 1; f <= 500; f++) isNewFrame(old, f);
    expect(isNewFrame(old, 1)).toBe(false);
    expect(isNewFrame(createEventFilter(), 1)).toBe(true);
  });
});

describe('tremblement de la victime', () => {
  it('secoue une victime en hitlag, d’un côté puis de l’autre', () => {
    const a = hitShake(A_HITSTUN, 6);
    const b = hitShake(A_HITSTUN, 5);
    expect(a).not.toBe(0);
    expect(b).toBe(-a);
    expect(Math.abs(a)).toBeLessThan(1);
    expect(hitShake(A_SHIELDSTUN, 3)).not.toBe(0);
  });

  it('laisse en place l’attaquant et tout combattant hors hitlag', () => {
    expect(hitShake(A_HITSTUN, 0)).toBe(0);
    expect(hitShake(A_IDLE, 6)).toBe(0);
  });
});

describe('effets du renderer', () => {
  /** Le joueur 0 frappe le joueur 1, placé à portée de jab. */
  function fight() {
    const config = testConfig(2);
    const sim = createSim(config);
    sim.state.posX[1] = fx(-27);
    const renderer = createRendererWith(config, fakeBackend());
    return { sim, renderer, inputs: new Uint32Array(2) };
  }

  it('déclenche un effet à la frame du coup, et un seul après re-simulation', () => {
    const t = fight();
    const saved = new Uint8Array(STATE_BYTES);
    t.inputs[0] = encodeInput(0, 0, BTN_ATTACK);
    step(t.sim, t.inputs);
    t.renderer.capture(t.sim);
    t.inputs[0] = 0;
    saveState(t.sim, saved);
    expect(t.renderer.effectCount()).toBe(0);

    for (let f = 0; f < 4; f++) {
      step(t.sim, t.inputs);
      t.renderer.capture(t.sim);
    }
    const afterHit = t.renderer.effectCount();
    expect(afterHit).toBeGreaterThan(0);

    // Rollback : les mêmes frames sont re-simulées, leurs événements réémis.
    loadState(t.sim, saved);
    for (let f = 0; f < 4; f++) {
      step(t.sim, t.inputs);
      t.renderer.capture(t.sim);
    }
    expect(t.renderer.effectCount()).toBe(afterHit);
  });

  it('laisse les effets s’éteindre', () => {
    const t = fight();
    t.inputs[0] = encodeInput(0, 0, BTN_ATTACK);
    step(t.sim, t.inputs);
    t.renderer.capture(t.sim);
    t.inputs[0] = 0;
    for (let f = 0; f < 120; f++) {
      step(t.sim, t.inputs);
      t.renderer.capture(t.sim);
    }
    expect(t.renderer.effectCount()).toBe(0);
  });

  it('montre les effets d’une simulation neuve avec un renderer neuf', () => {
    const first = fight();
    for (let f = 0; f < 300; f++) {
      step(first.sim, first.inputs);
      first.renderer.capture(first.sim);
    }
    first.renderer.dispose();

    const t = fight();
    t.inputs[0] = encodeInput(0, 0, BTN_ATTACK);
    for (let f = 0; f < 5; f++) {
      step(t.sim, t.inputs);
      t.renderer.capture(t.sim);
      t.inputs[0] = 0;
    }
    expect(t.renderer.effectCount()).toBeGreaterThan(0);
  });
});
