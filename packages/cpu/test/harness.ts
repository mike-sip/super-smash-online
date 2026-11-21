/** Matchs ordinateur contre ordinateur, sans rendu, pour tester et régler les niveaux. */
import { buildMatchConfig } from '@game/fighters';
import {
  createMatchSimConfig,
  createMatchView,
  defaultMatchConfig,
  matchResult,
  readMatch,
  type MatchResult,
} from '@game/match-rules';
import { checksum, createSim, step, type Sim } from '@game/sim-core';
import { applyStage, stageById, type StageId } from '@game/stages-items';
import { createBot } from '../src/index.ts';

export interface Duel {
  readonly fighters: readonly [string, string];
  readonly levels: readonly [number, number];
  readonly stage?: StageId;
  readonly seed?: number;
  readonly stocks?: number;
  /** Secondes ; 0 pour aucune limite (borne de sécurité à 10 minutes). */
  readonly seconds?: number;
}

export interface DuelResult {
  readonly result: MatchResult | null;
  readonly frames: number;
  readonly checksum: number;
  /** Chutes sans KO crédité à l'adversaire (autodestructions), par joueur. */
  readonly selfDestructs: readonly [number, number];
  readonly sim: Sim;
}

export function runDuel(duel: Duel): DuelResult {
  const stage = duel.stage ?? 'belvedere';
  const seed = duel.seed ?? 1;
  const base = buildMatchConfig({
    stage: stageById(stage).def,
    players: [...duel.fighters] as never,
    seed,
  });
  const staged = applyStage(base, stage, { hazards: false });
  const match = {
    ...defaultMatchConfig('stock', 2),
    stocks: duel.stocks ?? 2,
    timeLimit: duel.seconds ?? 240,
    items: { enabled: false, frequency: 'normal' as const },
  };
  const sim = createSim(
    createMatchSimConfig(match, {
      stage: staged.stage,
      fighters: staged.fighters,
      entities: staged.entities,
      seed,
    }),
  );
  const bots = [0, 1].map((p) =>
    createBot(sim, p, { level: duel.levels[p]!, fighter: duel.fighters[p], seed: seed * 31 + p }),
  );
  const inputs = new Uint32Array(2);
  const view = createMatchView();
  let frames = 0;
  const limit = 60 * 600;
  while (frames < limit) {
    inputs[0] = bots[0]!.next(sim);
    inputs[1] = bots[1]!.next(sim);
    step(sim, inputs);
    frames++;
    if (frames % 30 === 0) {
      readMatch(sim, view);
      if (view.phase === 'over') break;
    }
  }
  const result = matchResult(sim);
  const sd = (p: number): number => result?.players[p]?.selfDestructs ?? 0;
  return { result, frames, checksum: checksum(sim), selfDestructs: [sd(0), sd(1)], sim };
}
