/**
 * Belvédère des Brumes : le stage de référence. Un bloc principal et trois plateformes fines,
 * deux latérales et une centrale plus haute.
 */
import { fx, type StageDef } from '@game/sim-core';

export const BELVEDERE: StageDef = {
  name: 'belvedere',
  // Tous au sol, du centre vers les bords par paires : à 2 joueurs, ils se font face à distance.
  spawns: [-45, 45, -15, 15, -60, 60, -30, 30].map((x) => ({ x: fx(x), y: fx(0) })),
  solids: [{ x1: fx(-70), y1: fx(-30), x2: fx(70), y2: fx(0) }],
  platforms: [
    { x1: fx(-52), x2: fx(-22), y: fx(22) },
    { x1: fx(22), x2: fx(52), y: fx(22) },
    { x1: fx(-15), x2: fx(15), y: fx(44) },
  ],
  blast: { left: fx(-170), right: fx(170), top: fx(140), bottom: fx(-90) },
  itemSpawns: [{ x1: fx(-60), x2: fx(60), y: fx(80) }],
};
