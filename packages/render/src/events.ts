/**
 * Consommation des événements de la simulation, sans doublon après un rollback.
 *
 * `sim-core` réémet les événements d'une frame chaque fois qu'elle est re-simulée. Le rendu ne
 * déclenche donc un effet que pour une frame dont le numéro dépasse le plus grand déjà vu.
 * Approximation acceptée (SPEC-render.md) : un effet déclenché par une frame ensuite corrigée
 * par un rollback aura été joué à tort.
 *
 * Une simulation recréée repart de la frame 0 : il lui faut un filtre neuf, donc un renderer neuf.
 */
export interface EventFilter {
  /** Plus grand numéro de frame déjà traité. */
  latest: number;
}

export function createEventFilter(): EventFilter {
  return { latest: -1 };
}

/** Vrai si les événements de `frame` n'ont pas encore été traités ; la frame est alors retenue. */
export function isNewFrame(filter: EventFilter, frame: number): boolean {
  if (frame <= filter.latest) return false;
  filter.latest = frame;
  return true;
}
