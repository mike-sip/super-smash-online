import { describe, expect, it } from 'vitest';
import { createRollback, type Rollback } from '../src/rollback.ts';
import { HumanInputs, Rng, directChecksums, testGame } from './helpers.ts';

interface Scenario {
  players: number;
  seed: number;
  inputDelay: number;
  maxPrediction: number;
  checksumInterval: number;
  localSlots: number[];
  frames: number;
  /** Inputs définitifs (confirmés par le serveur) : `final[f][p]`. */
  final: Uint32Array[];
  /** Inputs lus localement : diffèrent parfois des définitifs (input remplacé par le serveur). */
  local: Uint32Array[];
}

function makeScenario(rng: Rng): Scenario {
  const players = 2 + rng.range(7);
  const inputDelay = rng.range(4);
  const frames = 120 + rng.range(240);
  const slots = Array.from({ length: players }, (_, p) => p);
  const localSlots: number[] = [];
  const localCount = 1 + rng.range(Math.min(4, players));
  while (localSlots.length < localCount) {
    const slot = slots.splice(rng.range(slots.length), 1)[0]!;
    localSlots.push(slot);
  }
  const humans = Array.from({ length: players }, () => new HumanInputs(rng.next()));
  const final: Uint32Array[] = [];
  const local: Uint32Array[] = [];
  const overrideRate = rng.range(3) === 0 ? 0.05 : 0;
  for (let f = 0; f < frames + inputDelay + 1; f++) {
    const row = new Uint32Array(players);
    const mine = new Uint32Array(players);
    for (let p = 0; p < players; p++) {
      const v = f < inputDelay ? 0 : humans[p]!.next();
      row[p] = v;
      mine[p] = v;
      if (f >= inputDelay && rng.float() < overrideRate) row[p] = rng.next();
    }
    final.push(row);
    local.push(mine);
  }
  return {
    players,
    seed: 1 + rng.range(1000),
    inputDelay,
    maxPrediction: 1 + rng.range(15),
    checksumInterval: 1 + rng.range(20),
    localSlots,
    frames,
    final,
    local,
  };
}

/** Livre au joueur `p` un bloc d'inputs définitifs qui part un peu avant sa frontière. */
function deliver(r: Rollback, s: Scenario, rng: Rng, p: number, upTo: number): void {
  const known = r.timeline.known[p]!;
  // Parfois un bloc qui laisse un trou : il doit être ignoré.
  const gap = rng.range(10) === 0 ? 1 + rng.range(3) : 0;
  const start = Math.max(0, known - rng.range(4)) + gap;
  const end = Math.min(upTo, start + 1 + rng.range(12));
  if (end <= start) return;
  const block = new Uint32Array(end - start + 2);
  for (let f = start; f < end; f++) block[f - start + 2] = s.final[f]![p]!;
  r.confirm(p, start, block, 2, end - start);
}

function run(s: Scenario, rng: Rng): void {
  const { game } = testGame(s.players, s.seed);
  const reported: [number, number][] = [];
  const r = createRollback({
    game,
    localSlots: s.localSlots,
    inputDelay: s.inputDelay,
    maxPrediction: s.maxPrediction,
    checksumInterval: s.checksumInterval,
    onChecksum: (frame, value) => reported.push([frame, value]),
  });
  const local = new Uint32Array(s.localSlots.length);
  const deliveryRate = 0.2 + rng.float() * 0.6;
  let newFrames = 0;
  let guard = 0;
  while (r.frame() < s.frames) {
    if (++guard > 100_000) throw new Error('le scénario ne progresse plus');
    for (let p = 0; p < s.players; p++) {
      if (rng.float() < deliveryRate) deliver(r, s, rng, p, s.final.length);
    }
    if (rng.range(3) === 0) r.reconcile();
    const steps = rng.range(4);
    for (let k = 0; k < steps && r.frame() < s.frames; k++) {
      const n = r.frame();
      for (let i = 0; i < s.localSlots.length; i++) {
        local[i] = s.local[n + s.inputDelay]![s.localSlots[i]!]!;
      }
      if (r.advance(local)) newFrames++;
      else expect(r.frame() - r.confirmedFrame()).toBe(s.maxPrediction);
      expect(r.frame() - r.confirmedFrame()).toBeLessThanOrEqual(s.maxPrediction);
    }
  }
  // Fin : tout est livré, la dernière correction est faite.
  for (let p = 0; p < s.players; p++) {
    while (r.timeline.known[p]! < s.frames) deliver(r, s, rng, p, s.frames);
  }
  r.reconcile();

  const direct = directChecksums(
    s.players,
    s.seed,
    s.final.slice(0, s.frames).map((row) => row),
  );
  expect(newFrames).toBe(s.frames);
  expect(game.checksum()).toBe(direct[s.frames]);
  const expected: [number, number][] = [];
  for (let f = s.checksumInterval; f <= s.frames; f += s.checksumInterval) {
    expected.push([f, direct[f]!]);
  }
  expect(reported).toEqual(expected);
}

describe('moteur de rollback', () => {
  it('égale une simulation directe, quels que soient l’ordre et le retard des confirmations (1 000 tirages)', () => {
    const rng = new Rng(20261113);
    for (let i = 0; i < 1000; i++) {
      const s = makeScenario(rng);
      try {
        run(s, rng);
      } catch (error) {
        const shape = { ...s, final: undefined, local: undefined };
        throw new Error(`tirage ${i} : ${JSON.stringify(shape)}\n${String(error)}`, {
          cause: error,
        });
      }
    }
  }, 120_000);

  it('n’avance pas au-delà de la fenêtre de prédiction', () => {
    const { game } = testGame(2);
    const r = createRollback({
      game,
      localSlots: [0],
      inputDelay: 2,
      maxPrediction: 5,
      checksumInterval: 15,
    });
    const local = new Uint32Array(1);
    // Frontière à 2 (frames 0 et 1 confirmées d'office) : 7 frames possibles.
    for (let k = 0; k < 7; k++) expect(r.advance(local)).toBe(true);
    expect(r.advance(local)).toBe(false);
    expect(r.frame()).toBe(7);
    expect(r.canAdvance()).toBe(false);
    r.confirm(1, 2, new Uint32Array(1), 0, 1);
    r.confirm(0, 2, new Uint32Array(1), 0, 1);
    expect(r.canAdvance()).toBe(true);
  });

  it('re-simule depuis la première frame mal prédite et compte la profondeur', () => {
    const { game } = testGame(2);
    const r = createRollback({
      game,
      localSlots: [0],
      inputDelay: 0,
      maxPrediction: 10,
      checksumInterval: 100,
    });
    const local = new Uint32Array(1);
    for (let k = 0; k < 8; k++) r.advance(local);
    // Le joueur 1 avait poussé son stick à la frame 3 : la prédiction (0) était fausse.
    const real = Uint32Array.from([0, 0, 0, 0x7f, 0x7f]);
    r.confirm(1, 0, real, 0, 5);
    expect(r.reconcile()).toBe(5);
    expect(r.stats).toEqual({ rollbacks: 1, resimulated: 5, maxRollback: 5 });
    expect(r.reconcile()).toBe(0);
    // Une confirmation conforme à la prédiction (répétition de 0x7f) ne coûte rien.
    r.confirm(1, 5, Uint32Array.from([0x7f, 0x7f, 0x7f]), 0, 3);
    expect(r.reconcile()).toBe(0);
  });
});
