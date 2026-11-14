/**
 * Assemblage d'une configuration de match.
 *
 * `SpawnDef.kind` désigne un index dans la liste globale `SimConfig.entities`. Chaque personnage
 * numérote ses projectiles à partir de 1 ; ici, on concatène les projectiles des personnages
 * présents après les entités du stage et des objets, et on renumérote les `kind` dans une copie
 * des `FighterDef`. Les données d'origine ne sont jamais modifiées.
 */
import type { EntityDef, FighterDef, MoveDef, SimConfig, StageDef } from '@game/sim-core';
import type { Character, FighterId } from './character.ts';
import { character } from './roster.ts';

export interface MatchOptions {
  readonly stage: StageDef;
  /** Un personnage par joueur, par identifiant du roster ou directement. */
  readonly players: readonly (FighterId | Character)[];
  /** Entités du stage et des objets, placées en tête de la liste. */
  readonly entities?: readonly EntityDef[];
  readonly seed: number;
}

/** Copie de `def` dont les projectiles pointent `offset` plus loin dans la liste globale. */
function shiftSpawns(def: FighterDef, offset: number): FighterDef {
  if (offset === 0) return def;
  const moves = def.moves.map((m): MoveDef | undefined =>
    m?.spawn === undefined ? m : { ...m, spawn: { ...m.spawn, kind: m.spawn.kind + offset } },
  );
  return { ...def, moves };
}

export function buildMatchConfig(options: MatchOptions): SimConfig {
  const entities: EntityDef[] = [...(options.entities ?? [])];
  // Un personnage choisi par plusieurs joueurs n'apporte ses projectiles qu'une fois.
  const placed = new Map<Character, FighterDef>();
  const fighters = options.players.map((p) => {
    const c = typeof p === 'string' ? character(p) : p;
    let def = placed.get(c);
    if (def === undefined) {
      def = shiftSpawns(c.def, entities.length);
      entities.push(...c.entities);
      placed.set(c, def);
    }
    return def;
  });
  return { stage: options.stage, fighters, entities, seed: options.seed };
}
