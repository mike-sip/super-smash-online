/**
 * Canal des Lanternes : le terrain change de forme. Une barge traverse le stage d'un bord à
 * l'autre, deux nacelles montent et descendent sur les côtés, en opposition.
 */
import { fx, type StageDef } from '@game/sim-core';

export const CANAL: StageDef = {
  name: 'canal',
  spawns: [-45, 45, -15, 15, -60, 60, -30, 30].map((x) => ({ x: fx(x), y: fx(0) })),
  solids: [{ x1: fx(-75), y1: fx(-30), x2: fx(75), y2: fx(0) }],
  platforms: [
    // Barge : de x = -45..-15 à x = 15..45, aller-retour en 8 s.
    {
      x1: fx(-45),
      x2: fx(-15),
      y: fx(24),
      motion: { dx: fx(60), dy: fx(0), period: 480, phase: 0 },
    },
    // Nacelles : de 16 à 48 de haut en 6 s, la droite en haut quand la gauche est en bas.
    {
      x1: fx(-70),
      x2: fx(-52),
      y: fx(16),
      motion: { dx: fx(0), dy: fx(32), period: 360, phase: 0 },
    },
    {
      x1: fx(52),
      x2: fx(70),
      y: fx(16),
      motion: { dx: fx(0), dy: fx(32), period: 360, phase: 180 },
    },
  ],
  blast: { left: fx(-175), right: fx(175), top: fx(150), bottom: fx(-90) },
  itemSpawns: [{ x1: fx(-60), x2: fx(60), y: fx(75) }],
};
