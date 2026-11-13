import { describe, expect, it } from 'vitest';
import {
  A_HITSTUN,
  A_IDLE,
  A_SHIELDSTUN,
  BTN_ATTACK,
  EV_GRAB,
  EV_HIT,
  EV_KO,
  EV_LEDGE,
  EV_PARRY,
  EV_SHIELD,
  EV_SHIELD_BREAK,
  createFighterView,
  createSim,
  encodeInput,
  fx,
  loadState,
  saveState,
  step,
  STATE_BYTES,
  type FighterView,
} from '@game/sim-core';
import { testConfig } from '@game/sim-core/testing';
import {
  FX_DISC,
  FX_RING,
  createEffectPool,
  effectProgress,
  hitShake,
  liveEffects,
  spawnEffect,
  spawnForEvent,
} from '../src/effects.ts';
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

describe('réserve d’effets', () => {
  it('fait vivre un effet de sa naissance à la fin de sa durée', () => {
    const pool = createEffectPool(4);
    spawnEffect(pool, FX_RING, 1, 2, 3, 10, 0xffffff, 100);
    expect(liveEffects(pool, 100)).toBe(1);
    expect(effectProgress(pool, 0, 100)).toBe(0);
    expect(effectProgress(pool, 0, 105)).toBe(0.5);
    expect(effectProgress(pool, 0, 109.5)).toBeCloseTo(0.95, 9);
    expect(effectProgress(pool, 0, 110)).toBe(-1);
    expect(liveEffects(pool, 110)).toBe(0);
    // Un emplacement jamais utilisé n'est pas vivant.
    expect(effectProgress(pool, 1, 100)).toBe(-1);
  });

  it('a une taille fixe : au-delà, le plus ancien est remplacé', () => {
    const pool = createEffectPool(4);
    for (let n = 0; n < 6; n++) spawnEffect(pool, FX_DISC, n, 0, 1, 100, 0, 0);
    expect(liveEffects(pool, 1)).toBe(4);
    expect(Array.from(pool.x)).toEqual([4, 5, 2, 3]);
  });

  it('ne montre pas un effet né après l’instant affiché', () => {
    const pool = createEffectPool(2);
    spawnEffect(pool, FX_DISC, 0, 0, 1, 10, 0, 50);
    expect(effectProgress(pool, 0, 49)).toBe(-1);
  });
});

describe('effets des événements', () => {
  const heights = Float64Array.from([12, 12]);
  function views(): FighterView[] {
    const a = createFighterView();
    const b = createFighterView();
    a.x = -10;
    b.x = 10;
    b.y = 4;
    b.hitlag = 8;
    return [a, b];
  }

  it('place l’impact d’un coup sur la victime, du côté de l’attaquant', () => {
    const pool = createEffectPool(8);
    spawnForEvent(pool, EV_HIT, 0, 1, views(), heights, 30);
    expect(liveEffects(pool, 30)).toBe(2);
    expect(pool.x[0]).toBeLessThan(10);
    expect(pool.x[0]).toBeGreaterThan(0);
    expect(pool.y[0]).toBeCloseTo(4 + 6, 6);
    expect(new Set([pool.shape[0], pool.shape[1]])).toEqual(new Set([FX_DISC, FX_RING]));
  });

  it('grossit l’impact avec la force du coup', () => {
    const weak = createEffectPool(8);
    const strong = createEffectPool(8);
    const v = views();
    v[1]!.hitlag = 4;
    spawnForEvent(weak, EV_HIT, 0, 1, v, heights, 0);
    v[1]!.hitlag = 18;
    spawnForEvent(strong, EV_HIT, 0, 1, v, heights, 0);
    expect(strong.size[0]).toBeGreaterThan(weak.size[0]!);
  });

  it('gère un coup porté par une entité sans propriétaire', () => {
    const pool = createEffectPool(8);
    spawnForEvent(pool, EV_HIT, -1, 1, views(), heights, 0);
    expect(liveEffects(pool, 0)).toBe(2);
    expect(pool.x[0]).toBeCloseTo(10, 6);
  });

  it('donne un effet distinct à chaque événement', () => {
    const signatures = new Set<string>();
    for (const type of [EV_HIT, EV_SHIELD, EV_PARRY, EV_SHIELD_BREAK, EV_KO, EV_GRAB, EV_LEDGE]) {
      const pool = createEffectPool(8);
      // Pour EV_KO, EV_SHIELD_BREAK et EV_LEDGE, `a` est le joueur concerné.
      spawnForEvent(pool, type, 1, type === EV_LEDGE ? 0 : 1, views(), heights, 0);
      const count = liveEffects(pool, 0);
      expect(count).toBeGreaterThan(0);
      let signature = '';
      for (let i = 0; i < count; i++) {
        signature += `${pool.shape[i]}:${pool.color[i]}:${pool.life[i]}:${pool.size[i]};`;
      }
      signatures.add(signature);
    }
    expect(signatures.size).toBe(7);
  });

  it('ignore un type d’événement inconnu ou un joueur hors limites', () => {
    const pool = createEffectPool(8);
    spawnForEvent(pool, 99, 0, 1, views(), heights, 0);
    spawnForEvent(pool, EV_KO, 5, 0, views(), heights, 0);
    expect(liveEffects(pool, 0)).toBe(0);
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
