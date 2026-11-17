/**
 * Contenu du jeu : noms et descriptions affichés, et construction d'une partie à partir
 * d'identifiants. `buildSimConfig` sert au combat local comme en ligne : deux navigateurs qui
 * reçoivent les mêmes identifiants, la même `MatchConfig` et la même graine simulent la même
 * partie au bit près.
 */
import { ROSTER, buildMatchConfig, character, isFighterId, type Character } from '@game/fighters';
import { createMatchSimConfig, type MatchConfig } from '@game/match-rules';
import type { SimConfig } from '@game/sim-core';
import {
  STAGES,
  applyItems,
  applyStage,
  isStageId,
  stageById,
  type StageInfo,
} from '@game/stages-items';

export const RANDOM = 'random';

const ARCHETYPES: Readonly<Record<Character['archetype'], string>> = {
  polyvalent: 'Polyvalent',
  rapide: 'Rapide',
  lourd: 'Lourd',
  zoneur: 'Zoneur',
};

/** Présentation de chaque personnage dans les écrans de sélection. */
const SUMMARIES: Readonly<Record<string, string>> = {
  sorel: 'Équilibré et sûr : de bons coups dans toutes les situations. Idéal pour débuter.',
  zephine: 'Vive et légère : enchaîne vite, se déplace partout, mais s’envole tôt.',
  ferroc: 'Massif : frappe très fort et encaisse longtemps, au prix de la vitesse.',
  nacre: 'Garde ses distances : projectiles et contrôle de l’espace.',
};

export interface FighterInfo {
  readonly id: string;
  readonly name: string;
  readonly archetype: string;
  readonly summary: string;
  /** Couleur principale `#rrggbb`, pour les cartes. */
  readonly color: string;
}

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

export const FIGHTER_INFO: Readonly<Record<string, FighterInfo>> = Object.fromEntries(
  ROSTER.map((c) => [
    c.id,
    {
      id: c.id,
      name: c.name,
      archetype: ARCHETYPES[c.archetype],
      summary: SUMMARIES[c.id] ?? '',
      color: hex(c.look.primary),
    },
  ]),
);

export const STAGE_INFO: Readonly<Record<string, StageInfo>> = Object.fromEntries(
  STAGES.map((s) => [s.id, s]),
);

export function fighterName(id: string | null): string {
  if (id === null) return '—';
  if (id === RANDOM) return 'Au hasard';
  return FIGHTER_INFO[id]?.name ?? id;
}

export function stageName(id: string | null): string {
  if (id === null) return '—';
  if (id === RANDOM) return 'Au hasard';
  return STAGE_INFO[id]?.name ?? id;
}

/** Apparence d'un personnage pour le rendu, ou `undefined` (mannequin standard). */
export function lookOf(id: string): Character['look'] | undefined {
  return isFighterId(id) ? character(id).look : undefined;
}

export interface MatchChoice {
  readonly stage: string;
  /** Un personnage par joueur, dans l'ordre de `MatchConfig.players`. */
  readonly fighters: readonly string[];
  readonly seed: number;
  /** Dangers du stage ; actifs par défaut. */
  readonly hazards?: boolean;
}

/** Configuration de simulation d'un match. Lève sur un identifiant inconnu. */
export function buildSimConfig(match: MatchConfig, choice: MatchChoice): SimConfig {
  if (!isStageId(choice.stage)) throw new Error(`Stage inconnu : « ${choice.stage} ».`);
  const fighters = choice.fighters.map((id) => {
    if (!isFighterId(id)) throw new Error(`Personnage inconnu : « ${id} ».`);
    return id;
  });
  const base = buildMatchConfig({
    stage: stageById(choice.stage).def,
    players: fighters,
    seed: choice.seed,
  });
  const staged = applyStage(base, choice.stage, { hazards: choice.hazards ?? true });
  const withItems = applyItems(staged, {
    frequency: match.items.enabled ? match.items.frequency : 'off',
  });
  return createMatchSimConfig(match, {
    stage: withItems.stage,
    fighters: withItems.fighters,
    entities: withItems.entities,
    items: withItems.items,
    seed: choice.seed,
  });
}
