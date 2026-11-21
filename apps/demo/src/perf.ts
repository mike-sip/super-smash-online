/** Outils du scénario de performance : entités maintenues en nombre, et sonde de temps par image. */
import {
  MAX_ENTITIES,
  createEntityView,
  fx,
  readEntity,
  spawnEntity,
  type Sim,
} from '@game/sim-core';

/** Type d'entité lancé : la balle rebondissante du contenu de test, celle qui vit le plus longtemps. */
const FEED_KIND = 2;

export interface EntityFeeder {
  /** À appeler entre deux `step` : relance des entités jusqu'à en avoir `target` en vie. */
  feed(sim: Sim): void;
}

/**
 * Maintient `target` entités en vie, en les lançant au-dessus du stage. C'est une modification de
 * l'état comme une autre, faite par la démo et non par le rendu. Les tirages sont reproductibles.
 */
export function createEntityFeeder(target: number, seed: number): EntityFeeder {
  const view = createEntityView();
  let state = seed >>> 0 || 1;
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return {
    feed(sim) {
      if (target <= 0) return;
      let alive = 0;
      for (let slot = 0; slot < MAX_ENTITIES; slot++) if (readEntity(sim, slot, view)) alive++;
      for (; alive < target; alive++) {
        const x = -50 + random() * 100;
        const slot = spawnEntity(
          sim,
          FEED_KIND,
          -1,
          fx(x),
          fx(45 + random() * 25),
          fx(random() * 2 - 1),
          fx(random()),
        );
        if (slot < 0) return;
      }
    },
  };
}

export interface PerfReport {
  /** Écart entre deux images affichées, en millisecondes. */
  intervals: number[];
  /** Temps passé à simuler puis à dessiner chaque image, en millisecondes. */
  simulate: number[];
  draw: number[];
}

export interface PerfProbe {
  start(): void;
  /** Enregistre une image : horodatage de l'affichage, temps de simulation, temps de dessin. */
  record(timestamp: number, simulate: number, draw: number): void;
  stop(): PerfReport;
}

/** Sonde à tampons fixes : enregistrer une image n'alloue rien et ne fausse donc pas la mesure. */
export function createPerfProbe(capacity = 4096): PerfProbe {
  const intervals = new Float32Array(capacity);
  const simulate = new Float32Array(capacity);
  const draw = new Float32Array(capacity);
  let active = false;
  let count = 0;
  let previous = 0;
  return {
    start() {
      active = true;
      count = 0;
      previous = 0;
    },
    record(timestamp, simulateMs, drawMs) {
      if (!active || count >= capacity) return;
      // La première image n'a pas de précédente : elle ne sert que de repère.
      if (previous !== 0) {
        intervals[count] = timestamp - previous;
        simulate[count] = simulateMs;
        draw[count] = drawMs;
        count++;
      }
      previous = timestamp;
    },
    stop() {
      active = false;
      return {
        intervals: Array.from(intervals.subarray(0, count)),
        simulate: Array.from(simulate.subarray(0, count)),
        draw: Array.from(draw.subarray(0, count)),
      };
    },
  };
}
