import { describe, expect, it } from 'vitest';
import {
  A_AIR,
  A_DEAD,
  A_JUMPSQUAT,
  A_LEDGE,
  BTN_ATTACK,
  BTN_JUMP,
  EV_GRAB,
  EV_HIT,
  EV_KO,
  EV_LEDGE,
  EV_PARRY,
  EV_SHIELD,
  EV_SHIELD_BREAK,
  STATE_BYTES,
  STICK_MAX,
  createFighterView,
  createSim,
  destroyEntity,
  encodeInput,
  fx,
  loadState,
  respawn,
  saveState,
  spawnEntity,
  step,
  type FighterView,
  type Sim,
} from '@game/sim-core';
import { E_BALL, E_SHOT, testConfig } from '@game/sim-core/testing';
import {
  HIT_MEDIUM_LAG,
  HIT_STRONG_LAG,
  SND_DOUBLE_JUMP,
  SND_ENTITY_BREAK,
  SND_ENTITY_SPAWN,
  SND_GRAB,
  SND_HIT_MEDIUM,
  SND_HIT_STRONG,
  SND_HIT_WEAK,
  SND_JUMP,
  SND_KO,
  SND_LAND,
  SND_LEDGE,
  SND_PARRY,
  SND_SHIELD,
  SND_SHIELD_BREAK,
  SOUND_COUNT,
  SOUND_NAMES,
  collectCues,
  createCueQueue,
  createCueTracker,
  hitSound,
  pushEventCue,
  pushFighterCues,
  type CueTracker,
} from '../src/audio/cues.ts';

/** Sons produits par la frame courante, par identifiant. */
function sounds(tracker: CueTracker, sim: Sim): number[] {
  const count = collectCues(tracker, sim);
  return Array.from(tracker.queue.sound.subarray(0, count));
}

/** Avance de `frames` frames en collectant les sons de chacune. */
function run(tracker: CueTracker, sim: Sim, inputs: Uint32Array, frames: number): number[] {
  const all: number[] = [];
  for (let f = 0; f < frames; f++) {
    step(sim, inputs);
    all.push(...sounds(tracker, sim));
  }
  return all;
}

function setup(players = 2) {
  const sim = createSim(testConfig(players));
  const tracker = createCueTracker();
  collectCues(tracker, sim);
  return { sim, tracker, inputs: new Uint32Array(players) };
}

describe('sons des événements', () => {
  function views(): FighterView[] {
    const a = createFighterView();
    const b = createFighterView();
    a.x = -10;
    b.x = 12;
    b.hitlag = 6;
    return [a, b];
  }

  it('donne trois forces de coup selon le hitlag de la victime', () => {
    expect(hitSound(4)).toBe(SND_HIT_WEAK);
    expect(hitSound(HIT_MEDIUM_LAG - 1)).toBe(SND_HIT_WEAK);
    expect(hitSound(HIT_MEDIUM_LAG)).toBe(SND_HIT_MEDIUM);
    expect(hitSound(HIT_STRONG_LAG)).toBe(SND_HIT_STRONG);
    expect(hitSound(20)).toBe(SND_HIT_STRONG);
  });

  it('associe à chaque événement son son, placé sur le joueur concerné', () => {
    const cases: [type: number, a: number, b: number, sound: number, x: number][] = [
      [EV_HIT, 0, 1, SND_HIT_WEAK, 12],
      [EV_SHIELD, 0, 1, SND_SHIELD, 12],
      [EV_PARRY, 0, 1, SND_PARRY, 12],
      [EV_GRAB, 0, 1, SND_GRAB, 12],
      [EV_SHIELD_BREAK, 0, 0, SND_SHIELD_BREAK, -10],
      [EV_KO, 1, 0, SND_KO, 12],
      [EV_LEDGE, 0, 1, SND_LEDGE, -10],
    ];
    for (const [type, a, b, sound, x] of cases) {
      const queue = createCueQueue();
      pushEventCue(queue, type, a, b, views(), 2);
      expect([queue.count, queue.sound[0], queue.x[0]]).toEqual([1, sound, x]);
    }
  });

  it('gère un coup porté par une entité sans propriétaire', () => {
    const queue = createCueQueue();
    pushEventCue(queue, EV_HIT, -1, 1, views(), 2);
    expect([queue.count, queue.sound[0]]).toEqual([1, SND_HIT_WEAK]);
  });

  it('ignore un événement inconnu ou un joueur hors limites', () => {
    const queue = createCueQueue();
    pushEventCue(queue, 99, 0, 1, views(), 2);
    pushEventCue(queue, EV_KO, 5, 0, views(), 2);
    pushEventCue(queue, EV_HIT, 0, 2, views(), 2);
    expect(queue.count).toBe(0);
  });

  it('a un nom par son', () => {
    expect(SOUND_NAMES).toHaveLength(SOUND_COUNT);
    expect(new Set(SOUND_NAMES).size).toBe(SOUND_COUNT);
  });

  it('ne déborde pas une file pleine', () => {
    const queue = createCueQueue(1);
    pushEventCue(queue, EV_KO, 0, 0, views(), 2);
    pushEventCue(queue, EV_KO, 1, 0, views(), 2);
    expect(queue.count).toBe(1);
  });
});

describe('sons déduits des changements d’état', () => {
  function fighter(action: number, grounded: boolean, jumpsLeft = 1): FighterView {
    const view = createFighterView();
    view.action = action;
    view.grounded = grounded;
    view.jumpsLeft = jumpsLeft;
    return view;
  }

  function cues(prevAction: number, prevGrounded: boolean, prevJumps: number, view: FighterView) {
    const queue = createCueQueue();
    pushFighterCues(queue, prevAction, prevGrounded, prevJumps, view);
    return Array.from(queue.sound.subarray(0, queue.count));
  }

  it('reconnaît saut, double saut et atterrissage', () => {
    expect(cues(A_JUMPSQUAT, true, 1, fighter(A_AIR, false))).toEqual([SND_JUMP]);
    expect(cues(A_AIR, false, 1, fighter(A_AIR, false, 0))).toEqual([SND_DOUBLE_JUMP]);
    expect(cues(A_AIR, false, 1, fighter(A_AIR, true))).toEqual([SND_LAND]);
  });

  it('se tait à la sortie d’un rebord et à la réapparition', () => {
    expect(cues(A_LEDGE, false, 1, fighter(A_AIR, true))).toEqual([]);
    expect(cues(A_DEAD, false, 1, fighter(A_AIR, true))).toEqual([]);
  });

  it('ne prend pas un saut aérien rendu (rebord, éjection) pour un double saut', () => {
    expect(cues(A_AIR, false, 0, fighter(A_AIR, false, 1))).toEqual([]);
  });
});

describe('sons d’une vraie simulation', () => {
  it('fait entendre saut, double saut puis atterrissage', () => {
    const { sim, tracker, inputs } = setup();
    inputs[0] = encodeInput(0, 0, BTN_JUMP);
    const rise = run(tracker, sim, inputs, 12);
    expect(rise.filter((s) => s === SND_JUMP)).toHaveLength(1);
    // Relâcher puis appuyer de nouveau en l'air : double saut.
    inputs[0] = 0;
    run(tracker, sim, inputs, 2);
    inputs[0] = encodeInput(0, 0, BTN_JUMP);
    const second = run(tracker, sim, inputs, 2);
    expect(second).toEqual([SND_DOUBLE_JUMP]);
    inputs[0] = 0;
    const fall = run(tracker, sim, inputs, 200);
    expect(fall).toEqual([SND_LAND]);
  });

  it('fait entendre un short hop comme un saut', () => {
    const { sim, tracker, inputs } = setup();
    inputs[0] = encodeInput(0, 0, BTN_JUMP);
    const first = run(tracker, sim, inputs, 1);
    inputs[0] = 0;
    const rest = run(tracker, sim, inputs, 120);
    expect([...first, ...rest]).toEqual([SND_JUMP, SND_LAND]);
  });

  it('fait entendre un coup porté, une seule fois', () => {
    const { sim, tracker, inputs } = setup();
    sim.state.posX[1] = fx(-27);
    inputs[0] = encodeInput(0, 0, BTN_ATTACK);
    const heard = run(tracker, sim, inputs, 1);
    inputs[0] = 0;
    heard.push(...run(tracker, sim, inputs, 30));
    expect(heard.filter((s) => s <= SND_HIT_STRONG)).toEqual([SND_HIT_WEAK]);
  });

  it('fait entendre l’accroche au rebord, mais pas d’atterrissage en remontant', () => {
    const { sim, tracker, inputs } = setup();
    sim.state.posX[0] = fx(-66);
    sim.state.posY[0] = fx(-5);
    sim.state.grounded[0] = 0;
    sim.state.surface[0] = 0;
    sim.state.action[0] = A_AIR;
    const hang = run(tracker, sim, inputs, 60);
    expect(hang).toContain(SND_LEDGE);
    expect(hang).not.toContain(SND_LAND);
    // Stick vers le stage : remontée.
    inputs[0] = encodeInput(STICK_MAX, 0, 0);
    const climb = run(tracker, sim, inputs, 60);
    expect(sim.state.grounded[0]).toBe(1);
    expect(climb).not.toContain(SND_LAND);
  });

  it('fait entendre un KO, sans atterrissage à la réapparition', () => {
    const { sim, tracker, inputs } = setup();
    sim.state.posX[0] = fx(140);
    sim.state.posY[0] = fx(30);
    sim.state.grounded[0] = 0;
    sim.state.surface[0] = 0;
    sim.state.action[0] = A_AIR;
    sim.state.velX[0] = fx(5);
    const heard = run(tracker, sim, inputs, 10);
    expect(heard).toContain(SND_KO);
    respawn(sim, 0);
    step(sim, inputs);
    expect(sounds(tracker, sim)).toEqual([]);
  });

  it('fait entendre l’apparition et la destruction anticipée d’une entité, pas son extinction', () => {
    const { sim, tracker, inputs } = setup();
    const shot = spawnEntity(sim, E_SHOT, -1, fx(0), fx(80), fx(0), fx(0));
    const ball = spawnEntity(sim, E_BALL, -1, fx(30), fx(80), fx(0), fx(0));
    expect(run(tracker, sim, inputs, 1)).toEqual([SND_ENTITY_SPAWN, SND_ENTITY_SPAWN]);
    destroyEntity(sim, ball);
    expect(run(tracker, sim, inputs, 1)).toEqual([SND_ENTITY_BREAK]);
    // Le tir immobile, en l'air, s'éteint au bout de ses 60 frames sans éclater.
    expect(run(tracker, sim, inputs, 70)).toEqual([]);
    expect(shot).toBeGreaterThanOrEqual(0);
  });
});

describe('rollback', () => {
  /** Joueur 0 : saute puis frappe le joueur 1 à portée ; une entité apparaît. */
  function scenario() {
    const t = setup();
    t.sim.state.posX[1] = fx(-27);
    const saved = new Uint8Array(STATE_BYTES);
    saveState(t.sim, saved);
    const script = (f: number): number =>
      f === 0 ? encodeInput(0, 0, BTN_ATTACK) : f === 40 ? encodeInput(0, 0, BTN_JUMP) : 0;
    return { ...t, saved, script };
  }

  function play(t: ReturnType<typeof scenario>, from: number, to: number): number[] {
    const heard: number[] = [];
    for (let f = from; f < to; f++) {
      t.inputs[0] = t.script(f);
      if (f === 20) spawnEntity(t.sim, E_SHOT, -1, fx(0), fx(80), fx(0), fx(0));
      step(t.sim, t.inputs);
      heard.push(...sounds(t.tracker, t.sim));
    }
    return heard;
  }

  it('ne rejoue aucun son des frames re-simulées, puis reprend à la première frame nouvelle', () => {
    const t = scenario();
    const first = play(t, 0, 60);
    expect(first).toContain(SND_HIT_WEAK);
    expect(first).toContain(SND_JUMP);
    expect(first).toContain(SND_ENTITY_SPAWN);

    // Rollback au début : les 60 mêmes frames sont re-simulées, leurs événements réémis.
    loadState(t.sim, t.saved);
    expect(play(t, 0, 60)).toEqual([]);

    // La suite est nouvelle : l'atterrissage du saut s'entend, une fois.
    expect(play(t, 60, 200).filter((s) => s === SND_LAND)).toEqual([SND_LAND]);
  });

  it('entend autant de sons avec un rollback partiel que sans', () => {
    const straight = scenario();
    const reference = play(straight, 0, 120);

    const t = scenario();
    const heard = play(t, 0, 30);
    const mid = new Uint8Array(STATE_BYTES);
    saveState(t.sim, mid);
    heard.push(...play(t, 30, 50));
    loadState(t.sim, mid);
    heard.push(...play(t, 30, 120));
    expect(heard).toEqual(reference);
  });

  it('repart de zéro pour une nouvelle simulation', () => {
    const old = scenario();
    play(old, 0, 60);
    const sim = createSim(testConfig(2));
    sim.state.posX[1] = fx(-27);
    // Même suivi, autre simulation : sa frame 0 sert de référence, puis ses sons s'entendent.
    expect(sounds(old.tracker, sim)).toEqual([]);
    old.inputs[0] = encodeInput(0, 0, BTN_ATTACK);
    step(sim, old.inputs);
    old.inputs[0] = 0;
    expect(run(old.tracker, sim, old.inputs, 10)).toContain(SND_HIT_WEAK);
  });
});

describe('budget', () => {
  it('lit une frame à 8 combattants et 16 entités en moins de 0,1 ms', () => {
    const { sim, tracker } = setup(8);
    const inputs = new Uint32Array(8);
    let seed = 1;
    const next = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    for (let n = 0; n < 16; n++) spawnEntity(sim, E_BALL, -1, fx(n * 6 - 45), fx(60), 0, 0);
    const frames = 2000;
    let spent = 0;
    for (let f = 0; f < frames; f++) {
      for (let p = 0; p < 8; p++) {
        const r = next();
        inputs[p] = encodeInput(
          ((r & 0xff) % 255) - 127,
          ((r >>> 8) % 255) - 127,
          (r >>> 16) & 0x1f,
        );
      }
      step(sim, inputs);
      const started = performance.now();
      collectCues(tracker, sim);
      spent += performance.now() - started;
    }
    const perFrame = spent / frames;
    process.stdout.write(
      `\nLecture des sons d'une frame à 8 combattants : ${(perFrame * 1000).toFixed(1)} µs\n`,
    );
    expect(perFrame).toBeLessThan(0.1);
  });
});
