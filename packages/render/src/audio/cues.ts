/**
 * Indices sonores : quel son jouer, et où, pour chaque frame nouvelle de la simulation.
 *
 * Deux sources : les événements de `sim-core` (coups, bouclier, KO…) et les changements d'état
 * entre deux frames nouvelles (saut, atterrissage, entités), que `sim-core` ne signale pas.
 * Les frames re-simulées après un rollback sont écartées par le filtre d'événements du rendu ;
 * la mémoire des changements d'état n'avance qu'avec les frames nouvelles.
 *
 * Logique pure, sans Web Audio : testable dans Node. Rien n'est alloué par frame.
 */
import {
  A_DEAD,
  A_JUMPSQUAT,
  A_LEDGE,
  A_LEDGE_GETUP,
  A_LEDGE_ROLL,
  EV_GRAB,
  EV_HIT,
  EV_KO,
  EV_LEDGE,
  EV_PARRY,
  EV_SHIELD,
  EV_SHIELD_BREAK,
  MAX_ENTITIES,
  MAX_EVENTS,
  MAX_PLAYERS,
  createEntityView,
  createFighterView,
  events,
  frame,
  readEntity,
  readFighter,
  type FighterView,
  type Sim,
} from '@game/sim-core';
import { isNewEntity } from '../entities.ts';
import { createEventFilter, isNewFrame, type EventFilter } from '../events.ts';

export const SND_HIT_WEAK = 0;
export const SND_HIT_MEDIUM = 1;
export const SND_HIT_STRONG = 2;
export const SND_SHIELD = 3;
export const SND_PARRY = 4;
export const SND_SHIELD_BREAK = 5;
export const SND_KO = 6;
export const SND_GRAB = 7;
export const SND_LEDGE = 8;
export const SND_JUMP = 9;
export const SND_DOUBLE_JUMP = 10;
export const SND_LAND = 11;
export const SND_ENTITY_SPAWN = 12;
export const SND_ENTITY_BREAK = 13;
/** Nombre de sons ; les identifiants vont de 0 à `SOUND_COUNT - 1`. */
export const SOUND_COUNT = 14;

/** Nom de chaque son, dans l'ordre des identifiants : planche d'écoute, messages. */
export const SOUND_NAMES: readonly string[] = [
  'Coup faible',
  'Coup moyen',
  'Coup fort',
  'Coup bloqué',
  'Parade',
  'Bris de bouclier',
  'KO',
  'Saisie',
  'Accroche au rebord',
  'Saut',
  'Double saut',
  'Atterrissage',
  'Apparition d’entité',
  'Destruction d’entité',
];

/**
 * Seuils de force d'un coup, en frames de hitlag de la victime. `sim-core` donne 4 frames plus une
 * par tranche de 3 % de dégâts : moyen à partir de 12 %, fort à partir de 24 %.
 */
export const HIT_MEDIUM_LAG = 8;
export const HIT_STRONG_LAG = 12;

export function hitSound(hitlag: number): number {
  if (hitlag >= HIT_STRONG_LAG) return SND_HIT_STRONG;
  if (hitlag >= HIT_MEDIUM_LAG) return SND_HIT_MEDIUM;
  return SND_HIT_WEAK;
}

/** Sons d'une frame : identifiant et position horizontale de leur auteur, en unités de jeu. */
export interface CueQueue {
  count: number;
  readonly sound: Int32Array;
  readonly x: Float32Array;
}

/** Assez pour tout ce qu'une frame peut produire : événements, trois sons par combattant, deux par entité. */
export const MAX_CUES = MAX_EVENTS + MAX_PLAYERS * 3 + MAX_ENTITIES * 2;

export function createCueQueue(capacity = MAX_CUES): CueQueue {
  return { count: 0, sound: new Int32Array(capacity), x: new Float32Array(capacity) };
}

function push(queue: CueQueue, sound: number, x: number): void {
  const n = queue.count;
  if (n >= queue.sound.length) return;
  queue.sound[n] = sound;
  queue.x[n] = x;
  queue.count = n + 1;
}

/**
 * Ajoute à `queue` le son de l'événement `type` (`a` et `b` comme dans `sim-core`). `views` donne
 * l'état des combattants à la frame de l'événement. Un événement inconnu ou un joueur hors
 * limites ne donne rien.
 */
export function pushEventCue(
  queue: CueQueue,
  type: number,
  a: number,
  b: number,
  views: readonly FighterView[],
  players: number,
): void {
  // Pour ces événements, `b` est la victime ou le défenseur ; pour les autres, `a` est le joueur.
  const target = type === EV_HIT || type === EV_SHIELD || type === EV_PARRY || type === EV_GRAB;
  const who = target ? b : a;
  if (who < 0 || who >= players) return;
  const view = views[who]!;
  switch (type) {
    case EV_HIT:
      push(queue, hitSound(view.hitlag), view.x);
      return;
    case EV_SHIELD:
      push(queue, SND_SHIELD, view.x);
      return;
    case EV_PARRY:
      push(queue, SND_PARRY, view.x);
      return;
    case EV_SHIELD_BREAK:
      push(queue, SND_SHIELD_BREAK, view.x);
      return;
    case EV_KO:
      push(queue, SND_KO, view.x);
      return;
    case EV_GRAB:
      push(queue, SND_GRAB, view.x);
      return;
    case EV_LEDGE:
      push(queue, SND_LEDGE, view.x);
      return;
    default:
  }
}

/** Vrai si arriver au sol depuis l'action `prevAction` ne fait pas de bruit d'atterrissage. */
function silentLanding(prevAction: number): boolean {
  return (
    prevAction === A_DEAD ||
    prevAction === A_LEDGE ||
    prevAction === A_LEDGE_GETUP ||
    prevAction === A_LEDGE_ROLL
  );
}

/**
 * Ajoute les sons déduits du passage de l'état précédent (`prevAction`, `prevGrounded`,
 * `prevJumps`) à l'état `view` d'un combattant.
 */
export function pushFighterCues(
  queue: CueQueue,
  prevAction: number,
  prevGrounded: boolean,
  prevJumps: number,
  view: FighterView,
): void {
  if (prevAction === A_JUMPSQUAT && !view.grounded) {
    push(queue, SND_JUMP, view.x);
  } else if (!prevGrounded && !view.grounded && view.jumpsLeft < prevJumps) {
    push(queue, SND_DOUBLE_JUMP, view.x);
  }
  if (!prevGrounded && view.grounded && !silentLanding(prevAction)) {
    push(queue, SND_LAND, view.x);
  }
}

/**
 * Mémoire du suivi : la simulation suivie, le filtre de ses frames, et l'état des combattants et
 * des entités à la dernière frame nouvelle.
 */
export interface CueTracker {
  readonly queue: CueQueue;
  sim: Sim | null;
  filter: EventFilter;
  readonly views: FighterView[];
  readonly prevAction: Int32Array;
  readonly prevGrounded: Uint8Array;
  readonly prevJumps: Int32Array;
  readonly entityKind: Int32Array;
  readonly entityLife: Int32Array;
  readonly entityX: Float32Array;
}

export function createCueTracker(): CueTracker {
  return {
    queue: createCueQueue(),
    sim: null,
    filter: createEventFilter(),
    views: Array.from({ length: MAX_PLAYERS }, createFighterView),
    prevAction: new Int32Array(MAX_PLAYERS),
    prevGrounded: new Uint8Array(MAX_PLAYERS),
    prevJumps: new Int32Array(MAX_PLAYERS),
    entityKind: new Int32Array(MAX_ENTITIES),
    entityLife: new Int32Array(MAX_ENTITIES),
    entityX: new Float32Array(MAX_ENTITIES),
  };
}

const entityView = createEntityView();

/**
 * Lit la frame courante de `sim` et remplit `tracker.queue` de ses sons. Une frame déjà vue
 * (re-simulée après un rollback) n'en produit aucun et laisse la mémoire intacte. Une autre
 * simulation que la précédente repart d'un filtre neuf ; sa première frame sert de référence et
 * ne produit que les sons de ses événements. Renvoie le nombre de sons.
 */
export function collectCues(tracker: CueTracker, sim: Sim): number {
  const queue = tracker.queue;
  queue.count = 0;
  const fresh = tracker.sim !== sim;
  if (fresh) {
    tracker.sim = sim;
    tracker.filter = createEventFilter();
  }
  if (!isNewFrame(tracker.filter, frame(sim))) return 0;

  const players = sim.config.fighters.length;
  const views = tracker.views;
  for (let i = 0; i < players; i++) {
    const view = views[i]!;
    readFighter(sim, i, view);
    if (!fresh) {
      pushFighterCues(
        queue,
        tracker.prevAction[i]!,
        tracker.prevGrounded[i] === 1,
        tracker.prevJumps[i]!,
        view,
      );
    }
    tracker.prevAction[i] = view.action;
    tracker.prevGrounded[i] = view.grounded ? 1 : 0;
    tracker.prevJumps[i] = view.jumpsLeft;
  }

  const queued = events(sim);
  for (let e = 0; e < queued.count; e++) {
    pushEventCue(queue, queued.type[e]!, queued.a[e]!, queued.b[e]!, views, players);
  }

  for (let slot = 0; slot < MAX_ENTITIES; slot++) {
    const prevKind = fresh ? 0 : tracker.entityKind[slot]!;
    const prevLife = tracker.entityLife[slot]!;
    const occupied = readEntity(sim, slot, entityView);
    const replaced =
      occupied &&
      prevKind !== 0 &&
      isNewEntity(prevKind, prevLife, entityView.kind, entityView.life);
    // Une entité qui s'éteint au bout de sa vie a été vue à 1 frame restante : elle n'éclate pas.
    if (prevKind !== 0 && (!occupied || replaced) && prevLife > 1) {
      push(queue, SND_ENTITY_BREAK, tracker.entityX[slot]!);
    }
    if (occupied && (prevKind === 0 || replaced) && !fresh) {
      push(queue, SND_ENTITY_SPAWN, entityView.x);
    }
    tracker.entityKind[slot] = occupied ? entityView.kind : 0;
    tracker.entityLife[slot] = occupied ? entityView.life : 0;
    tracker.entityX[slot] = occupied ? entityView.x : 0;
  }
  return queue.count;
}
