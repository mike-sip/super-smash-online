import { A_AIR, A_IDLE, A_SHIELD, A_SHIELD_BREAK, setAction } from './actions.ts';
import type { EntityDef, FighterDef, StageDef } from './defs.ts';
import { createEventQueue, type EventQueue } from './events.ts';
import { rngSeed } from './rng.ts';
import {
  FIGHTER_FIELDS,
  G_FRAME,
  G_PLAYERS,
  MAX_PLAYERS,
  createState,
  type SimState,
} from './state.ts';
import { checkBlast } from './systems/blast.ts';
import { updateBuffers } from './systems/buffer.ts';
import { compileStage, findSurface, integrate, type StageGeo } from './systems/collision.ts';
import { SHIELD_REGEN, tickDodgeStale } from './systems/defense.ts';
import { updateEntities } from './systems/entities.ts';
import { resolveGrabs } from './systems/grab.ts';
import { createHitScratch, resolveHits, type HitScratch } from './systems/hit.ts';
import { launch } from './systems/knockback.ts';
import { resolveLedges } from './systems/ledge.ts';
import { trackStick, updateMovement } from './systems/movement.ts';

/**
 * Règles de match branchées sur la simulation (module `match-rules`). Elles tournent dans
 * `step`, donc aussi pendant une re-simulation après rollback, et ne gardent leur état que dans
 * `rulesState(sim)`. Mêmes contraintes que `step` : aucune allocation, aucun non-déterminisme.
 */
export interface SimRules {
  /** Appelée une fois, à la fin de `createSim`, combattants placés. */
  init(sim: Sim): void;
  /** Appelée à la fin de chaque `step`, frame déjà avancée, événements de la frame lisibles. */
  afterStep(sim: Sim): void;
}

export interface SimConfig {
  readonly stage: StageDef;
  /** Un combattant par joueur, de 2 à 8. */
  readonly fighters: readonly FighterDef[];
  /** Types d'entités (projectiles, objets) utilisables pendant le combat. */
  readonly entities?: readonly EntityDef[];
  readonly seed: number;
  /**
   * Équipe de chaque joueur (entier positif ou nul), un par joueur. Absent : chacun pour soi.
   * Ajout demandé par `match-rules`.
   */
  readonly teams?: readonly number[];
  /** Tir allié : les coéquipiers se blessent et se saisissent. Vrai par défaut. */
  readonly teamAttack?: boolean;
  /** Règles de match. Absentes : combat sans fin, comme avant leur ajout. */
  readonly rules?: SimRules;
}

export interface Sim {
  readonly config: SimConfig;
  /** Tout ce qui évolue pendant le combat. Seule partie sauvegardée par un snapshot. */
  readonly state: SimState;
  /** Types d'entités, toujours défini (liste vide par défaut). */
  readonly entityDefs: readonly EntityDef[];
  /** Géométrie du stage, figée à la création. */
  readonly geo: StageGeo;
  /** Événements de la dernière frame. Hors snapshot : reconstruits à chaque `step`. */
  readonly events: EventQueue;
  /** Tableaux de travail internes à une frame. Hors snapshot. */
  readonly scratch: HitScratch;
  /** Équipe de chaque joueur, figée à la création (chacun la sienne sans équipes). */
  readonly team: Int32Array;
  /** Faux si les coéquipiers ne peuvent pas se toucher. */
  readonly teamAttack: boolean;
}

/** Pose le joueur sur son point d'apparition, dans un état neuf. */
function placeAtSpawn(sim: Sim, i: number): void {
  const s = sim.state;
  // L'input est conservé : sinon un bouton tenu pendant la réapparition compterait comme un appui.
  // L'autorisation de l'ultime appartient aux règles de match : une réapparition ne la retire pas.
  const input = s.input[i]!;
  const prevInput = s.prevInput[i]!;
  const ultimateReady = s.ultimateReady[i]!;
  for (let f = 0; f < FIGHTER_FIELDS.length; f++) s[FIGHTER_FIELDS[f]!][i] = 0;
  s.input[i] = input;
  s.prevInput[i] = prevInput;
  s.ultimateReady[i] = ultimateReady;

  const spawn = sim.config.stage.spawns[i]!;
  const surface = findSurface(sim.geo, spawn.x, spawn.y);
  s.posX[i] = spawn.x;
  s.posY[i] = spawn.y;
  s.facing[i] = spawn.x > 0 ? -1 : 1;
  s.grounded[i] = surface === 0 ? 0 : 1;
  s.surface[i] = surface;
  s.jumpsLeft[i] = sim.config.fighters[i]!.airJumps;
  s.shield[i] = sim.config.fighters[i]!.shieldMax;
  setAction(s, i, surface === 0 ? A_AIR : A_IDLE);
}

export function createSim(config: SimConfig): Sim {
  const players = config.fighters.length;
  if (players < 2 || players > MAX_PLAYERS) {
    throw new Error(`Il faut de 2 à 8 joueurs, reçu ${players}.`);
  }
  if (config.stage.spawns.length < players) {
    throw new Error(
      `Le stage « ${config.stage.name} » n'a que ${config.stage.spawns.length} points d'apparition pour ${players} joueurs.`,
    );
  }
  const team = new Int32Array(MAX_PLAYERS);
  for (let i = 0; i < MAX_PLAYERS; i++) team[i] = i;
  if (config.teams !== undefined) {
    if (config.teams.length !== players) {
      throw new Error(`Il faut une équipe par joueur : ${config.teams.length} pour ${players}.`);
    }
    for (let i = 0; i < players; i++) {
      const t = config.teams[i]!;
      if (!Number.isInteger(t) || t < 0) throw new Error(`Joueur ${i} : équipe invalide (${t}).`);
      team[i] = t;
    }
  }
  const sim: Sim = {
    config,
    state: createState(),
    entityDefs: config.entities ?? [],
    geo: compileStage(config.stage),
    events: createEventQueue(),
    scratch: createHitScratch(),
    team,
    teamAttack: config.teamAttack ?? true,
  };
  sim.state.g[G_PLAYERS] = players;
  rngSeed(sim.state, config.seed);
  for (let i = 0; i < players; i++) placeAtSpawn(sim, i);
  config.rules?.init(sim);
  return sim;
}

/**
 * Fait réapparaître un joueur. À appeler entre deux `step` ou depuis `SimRules.afterStep`, de
 * façon identique chez tous les pairs : c'est une modification de l'état comme une autre.
 * `invincibleFrames` : durée de l'invincibilité de réapparition (0 = aucune, comme avant).
 */
export function respawn(sim: Sim, player: number, invincibleFrames = 0): void {
  placeAtSpawn(sim, player);
  sim.state.invincible[player] = invincibleFrames;
}

/**
 * Avance la simulation d'une frame. `inputs[i]` est l'InputFrame du joueur i.
 *
 * Contraintes (SPEC-sim-core.md) : aucune allocation, aucune source de non-déterminisme,
 * joueurs toujours traités par index croissant.
 */
export function step(sim: Sim, inputs: Uint32Array): void {
  const s = sim.state;
  const frozen = sim.scratch.frozen;
  const players = s.g[G_PLAYERS]!;
  sim.events.count = 0;

  // 1. Inputs : mémorisés et mis en tampon pour tous, même gelés par le hitlag.
  for (let i = 0; i < players; i++) {
    s.prevInput[i] = s.input[i]!;
    s.input[i] = inputs[i]!;
    updateBuffers(sim, i);
    trackStick(sim, i);
  }

  // 2. Décisions. Un combattant en hitlag est gelé ; une victime est éjectée quand il se termine.
  for (let i = 0; i < players; i++) {
    const hitlag = s.hitlag[i]!;
    if (hitlag > 0) {
      frozen[i] = 1;
      s.hitlag[i] = hitlag - 1;
      if (hitlag === 1 && s.launchPending[i] === 1) launch(sim, i);
    } else {
      frozen[i] = 0;
      updateMovement(sim, i);
    }
  }

  // 3. Déplacement et collisions avec le décor.
  for (let i = 0; i < players; i++) {
    if (frozen[i] === 0) integrate(sim, i);
  }

  resolveLedges(sim);
  updateEntities(sim);

  // 4. Coups, sur les positions à jour.
  resolveHits(sim);
  resolveGrabs(sim);

  // 5. Zones limites.
  for (let i = 0; i < players; i++) checkBlast(sim, i);

  // 6. Compteurs et avance des actions. Une attaque en cours de charge reste sur sa frame.
  for (let i = 0; i < players; i++) {
    // L'invincibilité de réapparition se compte en temps réel, hitlag compris.
    if (s.invincible[i]! > 0) s.invincible[i] = s.invincible[i]! - 1;
    if (frozen[i] === 1) continue;
    tickDodgeStale(sim, i);
    if (s.intangible[i]! > 0) s.intangible[i] = s.intangible[i]! - 1;
    if (s.ledgeCooldown[i]! > 0) s.ledgeCooldown[i] = s.ledgeCooldown[i]! - 1;
    const action = s.action[i]!;
    if (action < A_SHIELD || action > A_SHIELD_BREAK) {
      const shield = s.shield[i]! + SHIELD_REGEN;
      const max = sim.config.fighters[i]!.shieldMax;
      s.shield[i] = shield > max ? max : shield;
    }
    if (s.chargeHold[i] === 1) s.chargeHold[i] = 0;
    else s.actionFrame[i] = s.actionFrame[i]! + 1;
  }
  s.g[G_FRAME] = s.g[G_FRAME]! + 1;

  // 7. Règles de match.
  const rules = sim.config.rules;
  if (rules !== undefined) rules.afterStep(sim);
}
