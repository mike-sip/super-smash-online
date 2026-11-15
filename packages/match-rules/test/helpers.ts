/** Outils pour écrire des scénarios de match avec le combattant et le stage de test. */
import {
  A_DEAD,
  EV_HIT,
  createFighterView,
  createSim,
  knockOut,
  readFighter,
  spawnEntity,
  step,
  fx,
  type Sim,
} from '@game/sim-core';
import { E_SHOT, testConfig } from '@game/sim-core/testing';
import {
  createMatchSimConfig,
  createMatchView,
  defaultMatchConfig,
  readMatch,
  type MatchConfig,
  type MatchMode,
  type MatchView,
} from '../src/index.ts';

/** Dégâts d'un tir du combattant de test, en pourcentage. */
export const SHOT_DAMAGE = 5;

export function config(
  mode: MatchMode,
  players: number,
  overrides: Partial<MatchConfig> = {},
): MatchConfig {
  return { ...defaultMatchConfig(mode, players), ...overrides };
}

/** Configuration en équipes : `teams[i]` est l'équipe du joueur i. */
export function teamConfig(
  mode: MatchMode,
  teams: readonly number[],
  overrides: Partial<MatchConfig> = {},
): MatchConfig {
  return config(mode, teams.length, {
    teams: true,
    players: teams.map((team) => ({ team })),
    ...overrides,
  });
}

export function newMatch(match: MatchConfig, seed = 1): Sim {
  const { stage, fighters, entities } = testConfig(match.players.length);
  return createSim(createMatchSimConfig(match, { stage, fighters, entities, seed }));
}

/** Joue `frames` frames, inputs neutres sauf ceux donnés (un par joueur). */
export function run(sim: Sim, frames: number, inputs: readonly number[] = []): void {
  const buf = new Uint32Array(sim.config.fighters.length);
  buf.set(inputs);
  for (let f = 0; f < frames; f++) step(sim, buf);
}

const fv = createFighterView();

export function fighter(sim: Sim, player: number) {
  readFighter(sim, player, fv);
  return { ...fv };
}

/**
 * `attacker` touche `victim` avec un tir posé juste à côté d'elle. Joue jusqu'au coup et
 * renvoie le nombre de frames jouées.
 */
export function hit(sim: Sim, attacker: number, victim: number): number {
  readFighter(sim, victim, fv);
  spawnEntity(sim, E_SHOT, attacker, fx(fv.x - 3), fx(fv.y + 6), fx(2), 0);
  for (let f = 1; f <= 10; f++) {
    run(sim, 1);
    for (let e = 0; e < sim.events.count; e++) {
      if (sim.events.type[e] === EV_HIT && sim.events.b[e] === victim) return f;
    }
  }
  throw new Error(`Le tir de ${attacker} n'a pas touché ${victim}.`);
}

/** Met `player` KO, puis joue une frame pour que les règles le constatent. */
export function ko(sim: Sim, ...players: number[]): void {
  for (const p of players) knockOut(sim, p);
  run(sim, 1);
}

/** Élimine `player` : KO répétés jusqu'à épuisement de ses vies. */
export function eliminate(sim: Sim, player: number): void {
  const v = view(sim);
  for (let guard = 0; guard < 5000 && v.eliminated[player] === 0; guard++) {
    if (fighter(sim, player).action !== A_DEAD) ko(sim, player);
    else run(sim, 1);
    readMatch(sim, v);
  }
}

const mv = createMatchView();

/** Vue du match à jour (objet partagé : copier ce qu'on veut garder). */
export function view(sim: Sim): MatchView {
  readMatch(sim, mv);
  return mv;
}
