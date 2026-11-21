/**
 * File d'attente de la partie rapide (SPEC-lobby.md, « Matchmaking rapide ») : une file par
 * région, groupes de `groupSize` joueurs tout de suite, ou de tous ceux qui attendent (au moins
 * `minPlayers`) quand le plus ancien attend depuis `maxWaitMs`. Logique pure, instant en paramètre.
 */
import type { Outcome } from './room.ts';

export interface QueueSettings {
  readonly regions: readonly string[];
  readonly groupSize: number;
  readonly minPlayers: number;
  readonly maxWaitMs: number;
  /** Aller-retour au-delà duquel l'entrée est refusée. */
  readonly maxRttMs: number;
}

export interface QueueEntry {
  readonly id: string;
  readonly fighter: string;
  readonly region: string;
  readonly since: number;
}

export interface Matchmaker {
  /** `rttMs` : aller-retour mesuré, ou `null` s'il ne l'est pas encore. */
  join(id: string, region: string, fighter: string, rttMs: number | null, now: number): Outcome;
  leave(id: string): boolean;
  entry(id: string): QueueEntry | undefined;
  waiting(region: string): number;
  /** Groupes formés à cet instant ; leurs joueurs sortent de la file. */
  poll(now: number): QueueEntry[][];
}

export function createMatchmaker(settings: QueueSettings): Matchmaker {
  const queues = new Map<string, QueueEntry[]>(settings.regions.map((r) => [r, []]));
  const byId = new Map<string, QueueEntry>();

  return {
    join(id, region, fighter, rttMs, now) {
      const queue = queues.get(region);
      if (queue === undefined) {
        return { ok: false, code: 'invalid_region', message: 'Cette région n’est pas ouverte.' };
      }
      if (rttMs !== null && rttMs > settings.maxRttMs) {
        return {
          ok: false,
          code: 'high_latency',
          message: `Votre connexion est trop lente pour la partie rapide (${Math.round(rttMs)} ms d’aller-retour, ${settings.maxRttMs} au plus).`,
        };
      }
      if (byId.has(id)) this.leave(id);
      const entry = { id, fighter, region, since: now };
      queue.push(entry);
      byId.set(id, entry);
      return { ok: true };
    },

    leave(id) {
      const entry = byId.get(id);
      if (entry === undefined) return false;
      byId.delete(id);
      const queue = queues.get(entry.region)!;
      queue.splice(queue.indexOf(entry), 1);
      return true;
    },

    entry: (id) => byId.get(id),

    waiting: (region) => queues.get(region)?.length ?? 0,

    poll(now) {
      const groups: QueueEntry[][] = [];
      for (const queue of queues.values()) {
        while (queue.length >= settings.groupSize) groups.push(queue.splice(0, settings.groupSize));
        if (queue.length >= settings.minPlayers && now - queue[0]!.since >= settings.maxWaitMs) {
          groups.push(queue.splice(0, queue.length));
        }
      }
      for (const group of groups) for (const e of group) byId.delete(e.id);
      return groups;
    },
  };
}
