/** Liste ordonnée des stages de la v1. */
import type { StageDef } from '@game/sim-core';
import { BELVEDERE } from './belvedere.ts';
import { CANAL } from './canal.ts';
import { GEYSERS } from './geysers.ts';
import { RECIF } from './recif.ts';

export type StageId = 'belvedere' | 'recif' | 'canal' | 'geysers';

export interface StageInfo {
  readonly id: StageId;
  /** Nom affiché, en français. */
  readonly name: string;
  readonly description: string;
  /**
   * Géométrie du stage. Ses dangers n'ont pas encore de type d'entité (`kind` à 0, donc inactifs) :
   * passer par `applyStage`, qui les branche sur la configuration.
   */
  readonly def: StageDef;
  /** Vrai si le stage a des dangers qu'on peut désactiver. */
  readonly hasHazards: boolean;
}

/** Les stages de la v1, dans l'ordre d'affichage. */
export const STAGES: readonly StageInfo[] = [
  {
    id: 'belvedere',
    name: 'Belvédère des Brumes',
    description:
      'Une terrasse de grès au-dessus des nuages, trois plateformes. Le stage de référence.',
    def: BELVEDERE,
    hasHazards: false,
  },
  {
    id: 'recif',
    name: 'Récif Nocturne',
    description: 'Une dalle de basalte au milieu du lagon, sans plateforme : le duel au sol.',
    def: RECIF,
    hasHazards: false,
  },
  {
    id: 'canal',
    name: 'Canal des Lanternes',
    description:
      'Un quai au crépuscule, une barge qui traverse et deux nacelles qui montent et descendent.',
    def: CANAL,
    hasHazards: false,
  },
  {
    id: 'geysers',
    name: 'Bassin des Geysers',
    description: 'Des terrasses minérales et deux évents qui jaillissent à tour de rôle.',
    def: GEYSERS,
    hasHazards: true,
  },
];

export function stageById(id: StageId): StageInfo {
  const found = STAGES.find((stage) => stage.id === id);
  if (found === undefined) throw new Error(`Stage inconnu : « ${id} ».`);
  return found;
}

/** Vrai si `id` désigne un stage de la v1 (pour valider une saisie, un paramètre d'adresse). */
export function isStageId(id: string): id is StageId {
  return STAGES.some((stage) => stage.id === id);
}
