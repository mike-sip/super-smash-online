/**
 * Registre de contenu de la démo : identifiant (transmis par le lobby) → définition `sim-core`.
 * Seul endroit à compléter quand `fighters` et `stages-items` seront fusionnés.
 */
import type { FighterDef, StageDef } from '@game/sim-core';
import { TEST_FIGHTER, TEST_HEAVY, TEST_STAGE } from '@game/sim-core/testing';
import { CONTENT_IDS } from './content-ids.ts';

export const FIGHTERS: Readonly<Record<string, { name: string; def: FighterDef }>> = {
  mannequin: { name: 'Mannequin', def: TEST_FIGHTER },
  colosse: { name: 'Colosse', def: TEST_HEAVY },
};

export const STAGES: Readonly<Record<string, { name: string; def: StageDef }>> = {
  'arene-test': { name: 'Arène de test', def: TEST_STAGE },
};

for (const id of CONTENT_IDS.fighters) {
  if (FIGHTERS[id] === undefined) throw new Error(`Personnage sans définition : ${id}`);
}
for (const id of CONTENT_IDS.stages) {
  if (STAGES[id] === undefined) throw new Error(`Stage sans définition : ${id}`);
}

export function fighterName(id: string | null): string {
  if (id === null) return '—';
  if (id === 'random') return 'Au hasard';
  return FIGHTERS[id]?.name ?? id;
}

export function stageName(id: string): string {
  if (id === 'random') return 'Au hasard';
  return STAGES[id]?.name ?? id;
}
