/** Contenu minimal pour tester la simulation sans dépendre des modules `fighters` et `stages-items`. */
import type { FighterDef, StageDef } from '../defs.ts';
import { fx } from '../fixed.ts';
import type { SimConfig } from '../step.ts';

export const TEST_FIGHTER: FighterDef = {
  name: 'test',
  halfWidth: fx(3),
  height: fx(12),
  walkSpeed: fx(1.1),
  walkAccel: fx(0.1),
  friction: fx(0.1),
  dashSpeed: fx(1.9),
  dashFrames: 11,
  runSpeed: fx(1.7),
  runAccel: fx(0.1),
  brakeFrames: 8,
  turnFrames: 6,
  jumpSquatFrames: 3,
  jumpVelocity: fx(2.5),
  shortHopVelocity: fx(1.6),
  doubleJumpVelocity: fx(2.4),
  airJumps: 1,
  airSpeed: fx(1.2),
  airAccel: fx(0.07),
  airFriction: fx(0.015),
  gravity: fx(0.09),
  maxFallSpeed: fx(1.6),
  fastFallSpeed: fx(2.56),
  landFrames: 2,
};

/**
 * Bloc principal de x = -60 à 60, dessus en y = 0 ; deux plateformes latérales en y = 20,
 * une plateforme centrale en y = 40.
 */
export const TEST_STAGE: StageDef = {
  name: 'test',
  spawns: [-35, 35, -15, 15, -55, 55, -25, 25].map((x) => ({ x: fx(x), y: fx(0) })),
  solids: [{ x1: fx(-60), y1: fx(-20), x2: fx(60), y2: fx(0) }],
  platforms: [
    { x1: fx(-40), x2: fx(-15), y: fx(20) },
    { x1: fx(15), x2: fx(40), y: fx(20) },
    { x1: fx(-12), x2: fx(12), y: fx(40) },
  ],
  blast: { left: fx(-150), right: fx(150), top: fx(120), bottom: fx(-80) },
};

export function testConfig(players: number, seed = 1): SimConfig {
  return {
    stage: TEST_STAGE,
    fighters: Array.from({ length: players }, () => TEST_FIGHTER),
    seed,
  };
}
