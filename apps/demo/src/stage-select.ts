/**
 * Choix du terrain de la démo : stage, et plus tard objets et dangers. Ce n'est pas l'écran de
 * sélection du jeu (module `lobby`) : juste de quoi essayer chaque stage.
 *
 * Le choix est repris de l'adresse (`?stage=canal`) et y est réécrit, pour qu'un rechargement ou
 * un lien partagé retombe sur la même configuration.
 */
import { applyStage, isStageId, STAGES, type StageId } from '@game/stages-items';
import type { SimConfig } from '@game/sim-core';

/** `test` : le stage minimal de `sim-core`, gardé pour comparer avec ses scénarios. */
export type DemoStage = StageId | 'test';

export interface MatchSetup {
  stage: DemoStage;
}

export const DEFAULT_STAGE: DemoStage = 'belvedere';

/** Lit le choix dans les paramètres d'adresse ; une valeur inconnue retombe sur le défaut. */
export function readSetup(params: URLSearchParams): MatchSetup {
  const stage = params.get('stage') ?? '';
  return { stage: stage === 'test' || isStageId(stage) ? stage : DEFAULT_STAGE };
}

/** Applique le choix à une configuration (combattants, entités, graine) qui reste inchangée. */
export function applySetup(config: SimConfig, setup: MatchSetup): SimConfig {
  return setup.stage === 'test' ? config : applyStage(config, setup.stage);
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
  const select = doc.createElement('select');
  select.dataset.control = 'stage';
  select.title = 'Stage';
  for (const [value, label] of [
    ...STAGES.map((stage) => [stage.id, stage.name] as const),
    ['test', 'Stage de test'] as const,
  ]) {
    const option = doc.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  select.value = setup.stage;
  select.addEventListener('change', () => {
    setup.stage = select.value as DemoStage;
    const url = new URL(doc.location.href);
    url.searchParams.set('stage', setup.stage);
    doc.defaultView?.history.replaceState(null, '', url);
    // Sinon les flèches du clavier changeraient de stage au lieu de déplacer le joueur.
    select.blur();
    onChange();
  });
  toolbar.prepend(select);
}
