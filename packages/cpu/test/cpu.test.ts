import { buildMatchConfig } from '@game/fighters';
import { checksum, createSim, inputButtons, inputStickX, inputStickY } from '@game/sim-core';
import { stageById } from '@game/stages-items';
import { describe, expect, it } from 'vitest';
import { analyzeMoves, createBot, levelParams } from '../src/index.ts';
import { runDuel } from './harness.ts';

const FIGHTERS = ['sorel', 'zephine', 'ferroc', 'nacre'] as const;

describe('niveaux et coups', () => {
  it('les niveaux vont du plus lent au plus vif, bornés de 1 à 9', () => {
    for (let l = 2; l <= 9; l++) {
      const a = levelParams(l - 1);
      const b = levelParams(l);
      expect(b.reaction).toBeLessThanOrEqual(a.reaction);
      expect(b.accuracy).toBeGreaterThan(a.accuracy);
      expect(b.defense).toBeGreaterThanOrEqual(a.defense);
    }
    expect(levelParams(1).reaction).toBe(30);
    expect(levelParams(9).reaction).toBe(4);
    expect(levelParams(42).level).toBe(9);
    expect(levelParams(-3).level).toBe(1);
  });

  it('lit portée et démarrage des coups dans les données des personnages', () => {
    for (const id of FIGHTERS) {
      const config = buildMatchConfig({
        stage: stageById('belvedere').def,
        players: [id, id],
        seed: 1,
      });
      const moves = analyzeMoves(config.fighters[0]!);
      expect(moves.length).toBeGreaterThan(8);
      for (const m of moves) {
        expect(m.startup).toBeGreaterThan(0);
        expect(m.maxX).toBeGreaterThan(m.minX);
      }
    }
  });

  it('ne fait que lire la simulation et rend des inputs valides', () => {
    const config = buildMatchConfig({
      stage: stageById('belvedere').def,
      players: ['sorel', 'nacre'],
      seed: 1,
    });
    const sim = createSim(config);
    const bot = createBot(sim, 0, { level: 9, fighter: 'sorel' });
    const before = checksum(sim);
    for (let n = 0; n < 50; n++) {
      const input = bot.next(sim);
      expect(Math.abs(inputStickX(input))).toBeLessThanOrEqual(127);
      expect(Math.abs(inputStickY(input))).toBeLessThanOrEqual(127);
      expect(inputButtons(input)).toBeLessThan(1 << 10);
    }
    expect(checksum(sim)).toBe(before);
  });
});

describe('matchs ordinateur contre ordinateur (SPEC-finition.md, phase 6)', () => {
  it('est déterministe : même graine, même match', () => {
    const a = runDuel({ fighters: ['sorel', 'ferroc'], levels: [7, 4], seed: 3 });
    const b = runDuel({ fighters: ['sorel', 'ferroc'], levels: [7, 4], seed: 3 });
    expect(b.frames).toBe(a.frames);
    expect(b.checksum).toBe(a.checksum);
  });

  it('le niveau 9 bat le niveau 1 dans au moins 95 % des matchs', () => {
    let wins = 0;
    let total = 0;
    for (const id of FIGHTERS) {
      for (let seed = 1; seed <= 5; seed++) {
        const r = runDuel({ fighters: [id, id], levels: [9, 1], seed });
        total++;
        if (r.result?.winners.length === 1 && r.result.winners[0] === 0) wins++;
      }
    }
    expect(wins / total).toBeGreaterThanOrEqual(0.95);
  });

  it('ne se jette jamais hors du stage à partir du niveau 3', () => {
    let selfDestructs = 0;
    for (const id of FIGHTERS) {
      for (const [a, b] of [
        [3, 3],
        [6, 4],
        [9, 7],
      ] as const) {
        const r = runDuel({ fighters: [id, id], levels: [a, b], seed: a * 10 + b });
        selfDestructs += r.selfDestructs[0] + r.selfDestructs[1];
      }
    }
    expect(selfDestructs).toBe(0);
  });
});
