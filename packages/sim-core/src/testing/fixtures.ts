/** Contenu minimal pour tester la simulation sans dépendre des modules `fighters` et `stages-items`. */
import type { FighterDef, StageDef } from '../defs.ts';
import { fx } from '../fixed.ts';
import type { SimConfig } from '../step.ts';

export const TEST_FIGHTER: FighterDef = {
  name: 'test',
  gravity: fx(0.09),
  maxFallSpeed: fx(1.6),
  fastFallSpeed: fx(2.56),
};

/** Sol plat au niveau y = 0, huit points d'apparition symétriques. */
export const TEST_STAGE: StageDef = {
  name: 'test',
  spawns: [-35, 35, -15, 15, -55, 55, -25, 25].map((x) => ({ x: fx(x), y: fx(0) })),
};

export function testConfig(players: number, seed = 1): SimConfig {
  return {
    stage: TEST_STAGE,
    fighters: Array.from({ length: players }, () => TEST_FIGHTER),
    seed,
  };
}
