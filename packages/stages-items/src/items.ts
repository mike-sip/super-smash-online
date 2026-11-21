/**
 * Les 5 objets de la v1, et l'explosion du pétard. Valeurs en unités lisibles, converties par
 * `fx()`. Réglages de ressenti regroupés ici, pour être faciles à retoucher.
 */
import { ENTITY_PASS, fx, type EntityDef, type HitDef } from '@game/sim-core';

export type ItemId = 'galet' | 'baton' | 'petard' | 'baie' | 'fiole';

export interface ItemInfo {
  readonly id: ItemId;
  /** Nom affiché, en français. */
  readonly name: string;
  readonly category: 'lancer' | 'frapper' | 'explosif' | 'soin';
  /** Poids dans le tirage des apparitions. */
  readonly weight: number;
}

/** Un objet non ramassé disparaît au bout de 20 s. */
const ITEM_LIFETIME = 1200;
const ITEM_GRAVITY = fx(0.1);

/** Explosion du pétard : blesse tout le monde dans son rayon, lanceur compris (pas de propriétaire). */
export const EXPLOSION: EntityDef = {
  name: 'explosion',
  radius: fx(13),
  gravity: fx(0),
  lifetime: 8,
  stageCollision: ENTITY_PASS,
  hit: { damage: fx(18), angle: 70, baseKnockback: fx(50), knockbackGrowth: fx(1) },
  destroyOnHit: false,
};

const GALET: EntityDef = {
  name: 'galet',
  radius: fx(1.6),
  gravity: ITEM_GRAVITY,
  lifetime: ITEM_LIFETIME,
  stageCollision: ENTITY_PASS,
  hit: { damage: fx(8), angle: 40, baseKnockback: fx(12), knockbackGrowth: fx(0.35) },
  destroyOnHit: false,
  item: { throwSpeed: fx(3.2), breakOnHit: true, breakOnContact: false },
};

/** Coup de bâton : plus ample que les attaques de base, un peu plus lent. */
const BATON_SWING: HitDef = {
  start: 7,
  end: 10,
  x1: fx(3),
  y1: fx(8),
  x2: fx(13),
  y2: fx(6),
  radius: fx(3),
  group: 0,
  damage: fx(12),
  angle: 40,
  baseKnockback: fx(30),
  knockbackGrowth: fx(0.9),
};

const BATON: EntityDef = {
  name: 'baton',
  radius: fx(2),
  gravity: ITEM_GRAVITY,
  lifetime: ITEM_LIFETIME,
  stageCollision: ENTITY_PASS,
  hit: { damage: fx(9), angle: 45, baseKnockback: fx(20), knockbackGrowth: fx(0.5) },
  destroyOnHit: false,
  item: {
    throwSpeed: fx(2.6),
    breakOnHit: false,
    breakOnContact: false,
    swing: { name: 'coup de bâton', totalFrames: 26, hits: [BATON_SWING], cancels: [] },
  },
};

/** Pétard, sans le type de son explosion : `petardFor` le complète d'après la configuration. */
const PETARD_BASE: EntityDef = {
  name: 'petard',
  radius: fx(2.2),
  gravity: ITEM_GRAVITY,
  // Sa mèche : il explose au bout de 10 s s'il traîne.
  lifetime: 600,
  stageCollision: ENTITY_PASS,
  destroyOnHit: false,
  item: { throwSpeed: fx(2.6), breakOnHit: false, breakOnContact: true },
};

const BAIE: EntityDef = {
  name: 'baie',
  radius: fx(2),
  gravity: ITEM_GRAVITY,
  lifetime: ITEM_LIFETIME,
  stageCollision: ENTITY_PASS,
  destroyOnHit: false,
  item: { heal: fx(12), throwSpeed: fx(0), breakOnHit: false, breakOnContact: false },
};

const FIOLE: EntityDef = {
  name: 'fiole',
  radius: fx(2),
  gravity: ITEM_GRAVITY,
  lifetime: ITEM_LIFETIME,
  stageCollision: ENTITY_PASS,
  destroyOnHit: false,
  item: { heal: fx(35), throwSpeed: fx(0), breakOnHit: false, breakOnContact: false },
};

export const ITEMS: readonly ItemInfo[] = [
  { id: 'galet', name: 'Galet', category: 'lancer', weight: 30 },
  { id: 'baton', name: 'Bâton', category: 'frapper', weight: 20 },
  { id: 'petard', name: 'Pétard', category: 'explosif', weight: 14 },
  { id: 'baie', name: 'Baie', category: 'soin', weight: 30 },
  { id: 'fiole', name: 'Fiole de sève', category: 'soin', weight: 6 },
];

const FIXED_DEFS: Readonly<Record<Exclude<ItemId, 'petard'>, EntityDef>> = {
  galet: GALET,
  baton: BATON,
  baie: BAIE,
  fiole: FIOLE,
};

/** Un seul pétard par type d'explosion, pour que deux appels donnent le même objet. */
const petards = new Map<number, EntityDef>();
function petardFor(burst: number): EntityDef {
  let def = petards.get(burst);
  if (def === undefined) {
    def = { ...PETARD_BASE, item: { ...PETARD_BASE.item!, burst } };
    petards.set(burst, def);
  }
  return def;
}

/** Définition de l'objet `id` ; `burst` est le type de l'explosion dans la configuration. */
export function itemDef(id: ItemId, burst: number): EntityDef {
  return id === 'petard' ? petardFor(burst) : FIXED_DEFS[id];
}

const IDS = new Set<string>(ITEMS.map((item) => item.id));

/** Objet représenté par une définition d'entité, d'après son nom. */
export function itemIdOf(def: EntityDef | undefined): ItemId | undefined {
  if (def?.item === undefined || !IDS.has(def.name)) return undefined;
  return def.name as ItemId;
}
