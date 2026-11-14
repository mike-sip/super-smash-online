/**
 * Assemblage d'une configuration de simulation : stage, objets, dangers. Ce sont les seules
 * fonctions dont le module `match-rules` a besoin pour régler un match.
 *
 * Les types d'entités nécessaires (jet de geyser, objets, explosion) sont ajoutés après ceux de
 * la configuration reçue : les numéros des projectiles des personnages ne changent pas. Une
 * entité déjà présente est réutilisée, ce qui permet d'appeler ces fonctions dans n'importe
 * quel ordre, ou plusieurs fois.
 */
import type { EntityDef, SimConfig } from '@game/sim-core';
import { GEYSER_JET } from './stages/geysers.ts';
import { stageById, type StageId } from './stages/registry.ts';

export interface StageOptions {
  /** Dangers actifs ; vrai par défaut. Désactivés, les évents restent un simple décor. */
  readonly hazards?: boolean;
}

/** Types d'entités créés par les dangers des stages. */
const HAZARD_ENTITIES: readonly EntityDef[] = [GEYSER_JET];

/**
 * Renvoie `entities` complété de `def` s'il n'y figure pas, et le type (index + 1) de `def`.
 * `entities` n'est jamais modifié.
 */
export function withEntity(
  entities: readonly EntityDef[],
  def: EntityDef,
): { entities: readonly EntityDef[]; kind: number } {
  const index = entities.indexOf(def);
  if (index >= 0) return { entities, kind: index + 1 };
  return { entities: [...entities, def], kind: entities.length + 1 };
}

/** Renvoie une copie de `config` qui se joue sur le stage `id`. */
export function applyStage(config: SimConfig, id: StageId, options: StageOptions = {}): SimConfig {
  const def = stageById(id).def;
  const hazards = def.hazards ?? [];
  if (hazards.length === 0 || options.hazards === false) {
    const stage = { ...def };
    delete stage.hazards;
    return { ...config, stage };
  }
  let entities = config.entities ?? [];
  const wired = hazards.map((hazard) => {
    // Un seul type de danger pour la v1 : le jet de geyser.
    const added = withEntity(entities, GEYSER_JET);
    entities = added.entities;
    return { ...hazard, kind: added.kind };
  });
  return { ...config, entities, stage: { ...def, hazards: wired } };
}

/** Vrai si le type d'entité `kind` de `config` est créé par un danger de stage. */
export function isHazardEntity(config: SimConfig, kind: number): boolean {
  const def = config.entities?.[kind - 1];
  return def !== undefined && HAZARD_ENTITIES.includes(def);
}
