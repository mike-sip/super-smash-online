/** Personnages construits à partir des combattants de test de `sim-core`, pour tester l'outillage. */
import { TEST_ENTITIES, TEST_FIGHTER, TEST_HEAVY } from '@game/sim-core/testing';
import { STANDARD_BUILD, defineCharacter, type Character } from '../src/character.ts';

const LOOK = { primary: 0x888888, secondary: 0x444444, build: STANDARD_BUILD, parts: [] };

/** Le combattant de test : son spécial neutre crée le projectile 1 (`shot`). */
export const TEST_CHAR: Character = defineCharacter({
  id: 'test',
  name: 'Test',
  archetype: 'polyvalent',
  def: TEST_FIGHTER,
  entities: TEST_ENTITIES,
  look: LOOK,
});

/** Le lourd de test : aucun projectile. */
export const TEST_HEAVY_CHAR: Character = defineCharacter({
  id: 'heavy',
  name: 'Lourd de test',
  archetype: 'lourd',
  def: TEST_HEAVY,
  entities: [],
  look: LOOK,
});
