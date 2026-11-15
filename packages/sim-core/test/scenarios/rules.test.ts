/** Crochet de règles et zone d'état réservée (ajouts demandés par `match-rules`). */
import { describe, expect, it } from 'vitest';
import {
  EV_KO,
  RULES_WORDS,
  STATE_BYTES,
  checksum,
  createSim,
  frame,
  loadState,
  rulesState,
  saveState,
  step,
  type Sim,
  type SimRules,
} from '../../src/index.ts';
import { testConfig } from '../../src/testing/fixtures.ts';
import { NEUTRAL, hold, stick } from './helpers.ts';

function recorder(): SimRules & { inits: number; frames: number[]; kos: number } {
  const r = {
    inits: 0,
    frames: [] as number[],
    kos: 0,
    init(sim: Sim) {
      r.inits++;
      rulesState(sim)[0] = 7;
    },
    afterStep(sim: Sim) {
      r.frames.push(frame(sim));
      for (let e = 0; e < sim.events.count; e++) if (sim.events.type[e] === EV_KO) r.kos++;
    },
  };
  return r;
}

describe('crochet de règles', () => {
  it('appelle init à la création, puis afterStep après chaque frame, frame déjà avancée', () => {
    const rules = recorder();
    const sim = createSim({ ...testConfig(2), rules });
    expect(rules.inits).toBe(1);
    expect(rulesState(sim)[0]).toBe(7);
    hold(sim, NEUTRAL, 3);
    expect(rules.frames).toEqual([1, 2, 3]);
  });

  it('voit les événements de la frame qui vient d’être jouée', () => {
    const rules = recorder();
    const sim = createSim({ ...testConfig(2), rules });
    // Le joueur 0 marche hors du stage et tombe sous la zone limite basse.
    for (let f = 0; f < 600 && rules.kos === 0; f++) hold(sim, stick(127), 1);
    expect(rules.kos).toBe(1);
  });

  it('sans crochet, la zone réservée reste à zéro et la simulation est inchangée', () => {
    const a = createSim(testConfig(3, 9));
    const b = createSim({ ...testConfig(3, 9), rules: { init() {}, afterStep() {} } });
    const inputs = new Uint32Array([stick(127), stick(-60, 0, 1), NEUTRAL]);
    for (let f = 0; f < 200; f++) {
      step(a, inputs);
      step(b, inputs);
    }
    expect(checksum(a)).toBe(checksum(b));
    expect(rulesState(a).every((w) => w === 0)).toBe(true);
  });
});

describe('zone d’état réservée', () => {
  it('fait RULES_WORDS mots, survit à saveState/loadState et compte dans le checksum', () => {
    const sim = createSim(testConfig(2));
    const r = rulesState(sim);
    expect(r.length).toBe(RULES_WORDS);
    expect(rulesState(sim)).toBe(r);

    const snap = new Uint8Array(STATE_BYTES);
    saveState(sim, snap);
    const before = checksum(sim);
    r[RULES_WORDS - 1] = 123;
    expect(checksum(sim)).not.toBe(before);

    loadState(sim, snap);
    expect(r[RULES_WORDS - 1]).toBe(0);
    expect(checksum(sim)).toBe(before);
  });
});
