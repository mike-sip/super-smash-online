/**
 * Règles d'un salon (SPEC-lobby.md, « Salons privés », « Sélection », « Matchmaking rapide ») :
 * membres, hôte, prêt, sélection, réglages, expulsion, conditions de lancement. Logique pure : ni
 * socket, ni horloge (l'instant est passé en paramètre), ni aléa (injecté). Une action refusée
 * renvoie un refus typé plutôt que de lever.
 */
import { validateMatchConfig, type MatchConfig } from '@game/match-rules';
import {
  MAX_TEAMS,
  RANDOM,
  type Identity,
  type LobbyErrorCode,
  type MatchEndView,
  type MatchPlayerInfo,
  type RoomKind,
  type RoomPhase,
  type RoomRules,
  type RoomView,
} from './protocol.ts';

export interface LobbyContent {
  readonly fighters: readonly string[];
  readonly stages: readonly string[];
}

export interface Member extends Identity {
  /** Pseudo à jour (il peut changer entre deux connexions). */
  name: string;
  fighter: string | null;
  team: number;
  ready: boolean;
  connected: boolean;
  /** Instant de la déconnexion, ou `NaN`. */
  disconnectedAt: number;
  rttMs: number | null;
}

export interface Room {
  readonly code: string | null;
  readonly kind: RoomKind;
  readonly region: string;
  host: string | null;
  phase: RoomPhase;
  capacity: number;
  locked: boolean;
  rules: RoomRules;
  stage: string;
  /** Dans l'ordre d'arrivée. */
  readonly members: Map<string, Member>;
  /** Expulsés : ne peuvent plus revenir. */
  readonly banned: Set<string>;
  gameId: string | null;
  lastEnd: MatchEndView | null;
}

export type Outcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: LobbyErrorCode; readonly message: string };

const OK: Outcome = { ok: true };

function refuse(code: LobbyErrorCode, message: string): Outcome {
  return { ok: false, code, message };
}

export function createRoom(init: {
  code: string | null;
  kind: RoomKind;
  region: string;
  capacity: number;
  rules: RoomRules;
  stage: string;
}): Room {
  return {
    code: init.code,
    kind: init.kind,
    region: init.region,
    host: null,
    phase: 'lobby',
    capacity: init.capacity,
    locked: false,
    rules: init.rules,
    stage: init.stage,
    members: new Map(),
    banned: new Set(),
    gameId: null,
    lastEnd: null,
  };
}

/** Fait entrer un compte. Le premier arrivé d'un salon privé en devient l'hôte. */
export function join(room: Room, who: Identity): Outcome {
  if (room.members.has(who.id)) return refuse('already_in_room', 'Vous êtes déjà dans ce salon.');
  if (room.banned.has(who.id)) return refuse('banned', 'Vous avez été expulsé de ce salon.');
  if (room.phase !== 'lobby')
    return refuse('wrong_phase', 'Une partie est en cours dans ce salon.');
  if (room.locked) return refuse('locked', 'Ce salon est verrouillé par son hôte.');
  if (room.members.size >= room.capacity) return refuse('full', 'Ce salon est complet.');
  const counts = new Array<number>(MAX_TEAMS).fill(0);
  for (const m of room.members.values()) counts[m.team]!++;
  const team = counts.indexOf(Math.min(...counts));
  room.members.set(who.id, {
    id: who.id,
    name: who.name,
    guest: who.guest,
    fighter: null,
    team,
    ready: false,
    connected: true,
    disconnectedAt: Number.NaN,
    rttMs: null,
  });
  if (room.kind === 'private' && room.host === null) room.host = who.id;
  return OK;
}

/** Désigne l'hôte : le plus ancien membre connecté, sinon le plus ancien membre. */
function promoteHost(room: Room): void {
  if (room.kind !== 'private') return;
  let first: string | null = null;
  for (const m of room.members.values()) {
    if (m.connected) {
      room.host = m.id;
      return;
    }
    first ??= m.id;
  }
  room.host = first;
}

/** Retire un membre ; passe la main s'il était l'hôte. */
export function leave(room: Room, id: string): { hostChanged: boolean; empty: boolean } {
  room.members.delete(id);
  const wasHost = room.host === id;
  if (wasHost) {
    room.host = null;
    promoteHost(room);
  }
  return { hostChanged: wasHost, empty: room.members.size === 0 };
}

/**
 * Connexion perdue ou retrouvée. Un hôte déconnecté le reste jusqu'à la fin de son délai de
 * grâce (`leave`) : son départ, lui, passe la main.
 */
export function setConnected(room: Room, id: string, connected: boolean, now: number): void {
  const m = room.members.get(id);
  if (m === undefined) return;
  m.connected = connected;
  m.disconnectedAt = connected ? Number.NaN : now;
  if (!connected) m.rttMs = null;
}

function member(room: Room, id: string): Member | Outcome {
  return room.members.get(id) ?? refuse('not_in_room', 'Vous n’êtes pas dans ce salon.');
}

function isOutcome(x: Member | Outcome): x is Outcome {
  return 'ok' in x;
}

export function setFighter(
  room: Room,
  id: string,
  fighter: string,
  content: LobbyContent,
): Outcome {
  const m = member(room, id);
  if (isOutcome(m)) return m;
  if (room.phase === 'playing') return refuse('wrong_phase', 'La partie est en cours.');
  if (fighter !== RANDOM && !content.fighters.includes(fighter)) {
    return refuse('invalid_fighter', 'Ce personnage n’existe pas.');
  }
  m.fighter = fighter;
  return OK;
}

export function setTeam(room: Room, id: string, team: number): Outcome {
  const m = member(room, id);
  if (isOutcome(m)) return m;
  if (room.phase === 'playing') return refuse('wrong_phase', 'La partie est en cours.');
  if (!Number.isInteger(team) || team < 0 || team >= MAX_TEAMS) {
    return refuse('bad_request', 'Équipe invalide.');
  }
  m.team = team;
  return OK;
}

export function setReady(room: Room, id: string, ready: boolean): Outcome {
  const m = member(room, id);
  if (isOutcome(m)) return m;
  if (room.phase !== 'lobby') return refuse('wrong_phase', 'Ce n’est plus le moment.');
  m.ready = ready;
  return OK;
}

/** La `MatchConfig` d'un salon pour `players` joueurs, avec les équipes de ses membres. */
function configFor(room: Room, rules: RoomRules, teams: readonly number[]): MatchConfig {
  return { version: 1, ...rules, players: teams.map((team) => ({ team })) };
}

function memberTeams(room: Room): number[] {
  return [...room.members.values()].map((m) => m.team);
}

export interface SettingsChange {
  readonly rules?: RoomRules;
  readonly stage?: string;
  readonly capacity?: number;
  readonly locked?: boolean;
}

/** Réglages de l'hôte. Changer les règles ou le stage remet tout le monde à « pas prêt ». */
export function setRules(
  room: Room,
  by: string,
  change: SettingsChange,
  content: LobbyContent,
): Outcome {
  if (room.kind !== 'private' || room.host !== by) {
    return refuse('not_host', 'Seul l’hôte peut régler le salon.');
  }
  if (room.phase !== 'lobby') return refuse('wrong_phase', 'Ce n’est plus le moment.');
  if (change.rules !== undefined) {
    // Validé pour le nombre de membres actuel (au moins 2) : les bornes de chaque champ.
    const teams = memberTeams(room);
    while (teams.length < 2) teams.push(teams.length);
    const checked = validateMatchConfig(configFor(room, change.rules, teams));
    if (!checked.ok) return refuse('invalid_rules', checked.errors.join(' '));
  }
  if (
    change.stage !== undefined &&
    change.stage !== RANDOM &&
    !content.stages.includes(change.stage)
  ) {
    return refuse('invalid_stage', 'Ce stage n’existe pas.');
  }
  if (change.capacity !== undefined && change.capacity < room.members.size) {
    return refuse('bad_request', 'La capacité ne peut pas descendre sous le nombre de membres.');
  }
  let reset = false;
  if (change.rules !== undefined) {
    room.rules = change.rules;
    reset = true;
  }
  if (change.stage !== undefined) {
    if (change.stage !== room.stage) reset = true;
    room.stage = change.stage;
  }
  if (change.capacity !== undefined) room.capacity = change.capacity;
  if (change.locked !== undefined) room.locked = change.locked;
  if (reset) for (const m of room.members.values()) m.ready = false;
  return OK;
}

export function kick(room: Room, by: string, target: string): Outcome {
  if (room.kind !== 'private' || room.host !== by) {
    return refuse('not_host', 'Seul l’hôte peut expulser.');
  }
  if (room.phase !== 'lobby') return refuse('wrong_phase', 'Pas pendant une partie.');
  if (target === by || !room.members.has(target)) return refuse('bad_request', 'Joueur inconnu.');
  leave(room, target);
  room.banned.add(target);
  return OK;
}

/**
 * Le salon peut-il partir ? Salon privé : à la demande de l'hôte (`by`). Salon rapide : `by`
 * vaut `null` et tous les membres doivent être prêts.
 */
export function canStart(room: Room, by: string | null): Outcome {
  if (room.kind === 'private' && room.host !== by) {
    return refuse('not_host', 'Seul l’hôte peut lancer la partie.');
  }
  if (room.phase !== 'lobby') return refuse('wrong_phase', 'Ce n’est plus le moment.');
  if (room.members.size < 2) return refuse('not_ready', 'Il faut au moins deux joueurs.');
  for (const m of room.members.values()) {
    if (!m.connected) return refuse('not_ready', `${m.name} est déconnecté.`);
    if (m.fighter === null) return refuse('not_ready', `${m.name} n’a pas choisi de personnage.`);
    if (m.id !== room.host && !m.ready) return refuse('not_ready', `${m.name} n’est pas prêt.`);
  }
  const teams = memberTeams(room);
  const checked = validateMatchConfig(configFor(room, room.rules, teams));
  if (!checked.ok) return refuse('invalid_rules', checked.errors.join(' '));
  if (room.rules.teams && new Set(teams).size < 2) {
    return refuse('invalid_rules', 'Il faut au moins deux équipes.');
  }
  return OK;
}

export interface Launch {
  readonly config: MatchConfig;
  readonly stage: string;
  /** Une entrée par place, dans l'ordre d'arrivée des membres. */
  readonly players: readonly MatchPlayerInfo[];
}

/** Fige les choix : configuration finale, places, tirage des « au hasard ». */
export function buildLaunch(
  room: Room,
  content: LobbyContent,
  random: (max: number) => number,
): Launch {
  const pick = (list: readonly string[]): string => list[random(list.length)]!;
  const members = [...room.members.values()];
  const players = members.map((m) => ({
    id: m.id,
    name: m.name,
    guest: m.guest,
    fighter: m.fighter === null || m.fighter === RANDOM ? pick(content.fighters) : m.fighter,
  }));
  const stage = room.stage === RANDOM ? pick(content.stages) : room.stage;
  return { config: configFor(room, room.rules, memberTeams(room)), stage, players };
}

export function roomView(room: Room): RoomView {
  return {
    code: room.code,
    kind: room.kind,
    phase: room.phase,
    host: room.host,
    capacity: room.capacity,
    locked: room.locked,
    region: room.region,
    rules: room.rules,
    stage: room.stage,
    members: [...room.members.values()].map((m) => ({
      id: m.id,
      name: m.name,
      guest: m.guest,
      fighter: m.fighter,
      team: m.team,
      ready: m.ready,
      connected: m.connected,
      rttMs: m.rttMs,
    })),
    gameId: room.gameId,
    lastEnd: room.lastEnd,
  };
}
