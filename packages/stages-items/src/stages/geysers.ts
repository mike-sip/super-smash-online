/**
 * Bassin des Geysers : deux évents jaillissent à tour de rôle sous les plateformes basses. Le
 * bouillonnement annonce chaque jet une seconde et demie à l'avance.
 */
import { ENTITY_PASS, fx, type EntityDef, type HazardDef, type StageDef } from '@game/sim-core';

/** Jet de geyser : colonne qui part du sol et traverse la plateforme au-dessus. */
export const GEYSER_JET: EntityDef = {
  name: 'geyser',
  radius: fx(6),
  height: fx(52),
  gravity: fx(0),
  // Remplacée par `HazardDef.duration` à la création ; sert de garde-fou.
  lifetime: 50,
  stageCollision: ENTITY_PASS,
  hit: { damage: fx(14), angle: 90, baseKnockback: fx(42), knockbackGrowth: fx(1.15) },
  destroyOnHit: false,
};

/** Cycle de 12 s ; l'évent droit jaillit 6 s après le gauche. Premier jet à 5,5 s de jeu. */
const VENT = { y: fx(0), period: 720, duration: 50, warning: 90 } as const;

/** Évents, sans type d'entité : `applyStage` le renseigne d'après la configuration. */
export const GEYSER_VENTS: readonly HazardDef[] = [
  { ...VENT, x: fx(-44), kind: 0, phase: 330 },
  { ...VENT, x: fx(44), kind: 0, phase: 690 },
];

export const GEYSERS: StageDef = {
  name: 'geysers',
  spawns: [-25, 25, -10, 10, -62, 62, -33, 33].map((x) => ({ x: fx(x), y: fx(0) })),
  solids: [{ x1: fx(-75), y1: fx(-30), x2: fx(75), y2: fx(0) }],
  platforms: [
    { x1: fx(-58), x2: fx(-30), y: fx(20) },
    { x1: fx(30), x2: fx(58), y: fx(20) },
  ],
  blast: { left: fx(-175), right: fx(175), top: fx(150), bottom: fx(-90) },
  itemSpawns: [{ x1: fx(-60), x2: fx(60), y: fx(75) }],
  hazards: GEYSER_VENTS,
};
