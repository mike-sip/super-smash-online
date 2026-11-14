/** API publique de `stages-items`. Tout ce qui n'est pas exporté ici est un détail interne. */
export { applyStage } from './config.ts';
export { STAGES, isStageId, stageById, type StageId, type StageInfo } from './stages/registry.ts';
export { MIN_SPAWN_GAP, REACH_SIDE, REACH_UP, validateStage } from './validate.ts';
