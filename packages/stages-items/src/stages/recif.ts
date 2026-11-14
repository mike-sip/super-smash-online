/** Récif Nocturne : un seul bloc, large et plat. Ni plateforme, ni échappatoire. */
import { fx, type StageDef } from '@game/sim-core';

export const RECIF: StageDef = {
  name: 'recif',
  spawns: [-50, 50, -17, 17, -70, 70, -34, 34].map((x) => ({ x: fx(x), y: fx(0) })),
  solids: [{ x1: fx(-85), y1: fx(-40), x2: fx(85), y2: fx(0) }],
  platforms: [],
  blast: { left: fx(-185), right: fx(185), top: fx(140), bottom: fx(-90) },
};
