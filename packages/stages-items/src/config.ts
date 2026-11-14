/**
 * Assemblage d'une configuration de simulation : stage, objets, dangers. Ce sont les seules
 * fonctions dont le module `match-rules` a besoin pour régler un match.
 */
import type { SimConfig } from '@game/sim-core';
import { stageById, type StageId } from './stages/registry.ts';

/** Renvoie une copie de `config` qui se joue sur le stage `id`. */
export function applyStage(config: SimConfig, id: StageId): SimConfig {
  return { ...config, stage: stageById(id).def };
}
