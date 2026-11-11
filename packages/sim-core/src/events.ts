/**
 * Événements émis pendant la dernière frame, pour le rendu, l'audio et les règles de match.
 *
 * La file ne fait pas partie de l'état : elle est vidée au début de chaque `step` et se
 * reconstruit à l'identique quand une frame est re-simulée après un rollback. C'est donc au
 * consommateur de ne pas rejouer deux fois un son ou un effet pour la même frame.
 */
export const MAX_EVENTS = 64;

/** Un joueur a franchi une zone limite. `a` = index du joueur. */
export const EV_KO = 1;
/** Un coup a porté. `a` = attaquant, `b` = victime. */
export const EV_HIT = 2;

export interface EventQueue {
  count: number;
  readonly type: Int32Array;
  readonly a: Int32Array;
  readonly b: Int32Array;
}

export function createEventQueue(): EventQueue {
  return {
    count: 0,
    type: new Int32Array(MAX_EVENTS),
    a: new Int32Array(MAX_EVENTS),
    b: new Int32Array(MAX_EVENTS),
  };
}

/** Ajoute un événement. Au-delà de `MAX_EVENTS` par frame, les suivants sont ignorés. */
export function emit(q: EventQueue, type: number, a: number, b: number): void {
  const n = q.count;
  if (n >= MAX_EVENTS) return;
  q.type[n] = type;
  q.a[n] = a;
  q.b[n] = b;
  q.count = n + 1;
}
