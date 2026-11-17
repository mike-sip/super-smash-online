/** API publique de `sim-core`. Tout ce qui n'est pas exporté ici est un détail interne. */
import { G_FRAME, STATE_BYTES, checksumState, loadInto, saveFrom } from './state.ts';
import type { EventQueue } from './events.ts';
import type { Fx } from './fixed.ts';
import { koFighter } from './systems/blast.ts';
import type { Sim } from './step.ts';

export { fx, fxToFloat, FX_ONE, type Fx } from './fixed.ts';
export type {
  CancelDef,
  CapsuleDef,
  ChargeDef,
  DodgeDef,
  EntityDef,
  EntityHitDef,
  FighterDef,
  GrabDef,
  HazardDef,
  HitDef,
  ItemDef,
  ItemSpawnDef,
  ItemZoneDef,
  MoveDef,
  PlatformDef,
  PlatformMotionDef,
  SolidDef,
  SpawnDef,
  StageDef,
  ThrowDef,
  Vec2,
} from './defs.ts';
export * from './moves.ts';
export {
  A_IDLE,
  A_WALK,
  A_DASH,
  A_RUN,
  A_BRAKE,
  A_TURN,
  A_CROUCH,
  A_JUMPSQUAT,
  A_AIR,
  A_LAND,
  A_DEAD,
  A_ATTACK,
  A_HITSTUN,
  A_TUMBLE,
  A_TECH,
  A_DOWN,
  A_SHIELD,
  A_SHIELDSTUN,
  A_SHIELD_DROP,
  A_SHIELD_BREAK,
  A_SPOTDODGE,
  A_ROLL,
  A_AIRDODGE,
  A_GRAB,
  A_GRABBING,
  A_GRABBED,
  A_THROW,
  A_GRAB_RELEASE,
  A_LEDGE,
  A_LEDGE_GETUP,
  A_LEDGE_ROLL,
  A_ITEM_THROW,
  A_ITEM_SWING,
} from './actions.ts';
export {
  EV_GRAB,
  EV_HEAL,
  EV_HIT,
  EV_ITEM_BREAK,
  EV_ITEM_PICKUP,
  EV_ITEM_SPAWN,
  EV_ITEM_THROW,
  EV_KO,
  EV_LEDGE,
  EV_PARRY,
  EV_SHIELD,
  EV_SHIELD_BREAK,
  EV_ULTIMATE,
  MAX_EVENTS,
  type EventQueue,
} from './events.ts';
export {
  BTN_ATTACK,
  BTN_SPECIAL,
  BTN_JUMP,
  BTN_SHIELD,
  BTN_GRAB,
  BTN_CSTICK_UP,
  BTN_CSTICK_DOWN,
  BTN_CSTICK_LEFT,
  BTN_CSTICK_RIGHT,
  BTN_TAUNT,
  STICK_MAX,
  encodeInput,
  inputStickX,
  inputStickY,
  inputButtons,
  inputPressed,
  type InputFrame,
} from './input.ts';
export { MAX_PLAYERS, MAX_ENTITIES, RULES_WORDS, STATE_BYTES } from './state.ts';
export { createSim, respawn, step, type Sim, type SimConfig, type SimRules } from './step.ts';
export {
  createEntityView,
  createFighterView,
  readEntity,
  readFighter,
  readPlatform,
  type EntityView,
  type FighterView,
  type PlatformView,
} from './view.ts';
export {
  ENTITY_BOUNCE,
  ENTITY_DESTROY,
  ENTITY_PASS,
  destroyEntity,
  spawnEntity,
} from './systems/entities.ts';
export {
  ITEM_MODE_FREE,
  ITEM_MODE_HELD,
  ITEM_MODE_THROWN,
  ITEM_THROW_FRAMES,
  ITEM_THROW_RELEASE,
  THROW_BACK,
  THROW_DOWN,
  THROW_FORWARD,
  THROW_UP,
} from './systems/items.ts';

function checkSize(buf: Uint8Array): void {
  if (buf.length < STATE_BYTES) {
    throw new Error(`Le tampon doit faire au moins STATE_BYTES (${STATE_BYTES}) octets.`);
  }
}

/** Copie l'état complet dans `out` (au moins `STATE_BYTES` octets). */
export function saveState(sim: Sim, out: Uint8Array): void {
  checkSize(out);
  saveFrom(sim.state, out);
}

/** Remplace l'état complet par celui de `from`, produit par `saveState`. */
export function loadState(sim: Sim, from: Uint8Array): void {
  checkSize(from);
  loadInto(sim.state, from);
}

/** Empreinte de l'état sur 32 bits, pour détecter les désynchronisations. */
export function checksum(sim: Sim): number {
  return checksumState(sim.state);
}

/** Événements émis pendant la dernière frame. La file est réutilisée : la lire avant le `step` suivant. */
export function events(sim: Sim): EventQueue {
  return sim.events;
}

/**
 * Zone de l'état réservée aux règles de match (`RULES_WORDS` mots), toujours la même vue.
 * La simulation ne la lit jamais ; `saveState`, `loadState` et `checksum` la couvrent.
 */
export function rulesState(sim: Sim): Int32Array {
  return sim.state.rules;
}

/**
 * Met un joueur KO sur place (règles de match : points de vie épuisés en Endurance). Émet
 * `EV_KO` dans la file de la frame en cours. Sans effet sur un joueur déjà KO.
 */
export function knockOut(sim: Sim, player: number): void {
  koFighter(sim, player);
}

/** Impose les dégâts d'un joueur, en virgule fixe (règles de match : mort subite). */
export function setDamage(sim: Sim, player: number, damage: Fx | number): void {
  sim.state.damage[player] = damage | 0;
}

/**
 * Autorise ou non l'attaque ultime du joueur (règles de match). Autorisée, le prochain spécial
 * neutre lance `M_ULTIMATE` si le combattant en a une, retire l'autorisation et émet `EV_ULTIMATE`.
 */
export function setUltimateReady(sim: Sim, player: number, ready: boolean): void {
  sim.state.ultimateReady[player] = ready ? 1 : 0;
}

/** Nombre de frames simulées depuis la création. */
export function frame(sim: Sim): number {
  return sim.state.g[G_FRAME]!;
}
