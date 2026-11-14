/**
 * Choix du terrain de la démo : stage, fréquence des objets, dangers. Ce n'est pas l'écran de
 * sélection du jeu (module `lobby`) : juste de quoi essayer chaque stage et chaque objet.
 *
 * Le choix est repris de l'adresse (`?stage=canal&items=high&hazards=off`) et y est réécrit, pour
 * qu'un rechargement ou un lien partagé retombe sur la même configuration.
 */
import {
  applyItems,
  applyStage,
  isStageId,
  STAGES,
  type ItemFrequency,
  type StageId,
} from '@game/stages-items';
import type { SimConfig } from '@game/sim-core';

/** `test` : le stage minimal de `sim-core`, gardé pour comparer avec ses scénarios. */
export type DemoStage = StageId | 'test';

export interface MatchSetup {
  stage: DemoStage;
  items: ItemFrequency;
  hazards: boolean;
}

export const DEFAULT_STAGE: DemoStage = 'belvedere';

const FREQUENCIES: readonly (readonly [ItemFrequency, string])[] = [
  ['off', 'Objets : aucun'],
  ['low', 'Objets : rares'],
  ['normal', 'Objets : normaux'],
  ['high', 'Objets : fréquents'],
];

const isFrequency = (value: string): value is ItemFrequency =>
  FREQUENCIES.some(([frequency]) => frequency === value);

/** Lit le choix dans les paramètres d'adresse ; une valeur inconnue retombe sur le défaut. */
export function readSetup(params: URLSearchParams): MatchSetup {
  const stage = params.get('stage') ?? '';
  const items = params.get('items') ?? '';
  return {
    stage: stage === 'test' || isStageId(stage) ? stage : DEFAULT_STAGE,
    items: isFrequency(items) ? items : 'off',
    hazards: params.get('hazards') !== 'off',
  };
}

/** Applique le choix à une configuration (combattants, entités, graine) qui reste inchangée. */
export function applySetup(config: SimConfig, setup: MatchSetup): SimConfig {
  const staged =
    setup.stage === 'test' ? config : applyStage(config, setup.stage, { hazards: setup.hazards });
  // Le stage de test n'a pas de zone d'apparition : les objets n'y tombent pas.
  return applyItems(staged, { frequency: setup.items });
}

function select(
  doc: Document,
  control: string,
  title: string,
  options: readonly (readonly [string, string])[],
  value: string,
): HTMLSelectElement {
  const element = doc.createElement('select');
  element.dataset.control = control;
  element.title = title;
  for (const [optionValue, label] of options) {
    const option = doc.createElement('option');
    option.value = optionValue;
    option.textContent = label;
    element.append(option);
  }
  element.value = value;
  return element;
}

/**
 * Construit les listes de choix en tête de `toolbar`. `onChange` est appelé après chaque
 * modification, avec le choix déjà mis à jour.
 */
export function createStageSelect(
  toolbar: HTMLElement,
  setup: MatchSetup,
  onChange: () => void,
): void {
  const doc = toolbar.ownerDocument;
  const stage = select(
    doc,
    'stage',
    'Stage',
    [...STAGES.map((info) => [info.id, info.name] as const), ['test', 'Stage de test'] as const],
    setup.stage,
  );
  const items = select(doc, 'items', 'Fréquence des objets', FREQUENCIES, setup.items);
  const hazards = select(
    doc,
    'hazards',
    'Dangers du stage',
    [
      ['on', 'Dangers : oui'],
      ['off', 'Dangers : non'],
    ],
    setup.hazards ? 'on' : 'off',
  );

  const refresh = (): void => {
    // Seuls les Geysers ont des dangers à couper.
    hazards.disabled = !(STAGES.find((info) => info.id === setup.stage)?.hasHazards ?? false);
  };
  const changed = (element: HTMLSelectElement): void => {
    setup.stage = stage.value as DemoStage;
    setup.items = items.value as ItemFrequency;
    setup.hazards = hazards.value === 'on';
    const url = new URL(doc.location.href);
    url.searchParams.set('stage', setup.stage);
    url.searchParams.set('items', setup.items);
    url.searchParams.set('hazards', hazards.value);
    doc.defaultView?.history.replaceState(null, '', url);
    refresh();
    // Sinon les flèches du clavier changeraient la sélection au lieu de déplacer le joueur.
    element.blur();
    onChange();
  };
  for (const element of [stage, items, hazards]) {
    element.addEventListener('change', () => changed(element));
  }
  refresh();
  toolbar.prepend(stage, items, hazards);
}
