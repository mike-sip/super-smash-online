/**
 * Configuration d'un match : ce que `lobby` transmettra à chaque pair, en JSON.
 *
 * Elle est validée à la réception (`validateMatchConfig`) : une valeur venue du réseau ou d'un
 * formulaire n'entre jamais dans la simulation sans être passée par là.
 */

export type MatchMode = 'stock' | 'time' | 'stamina';
export type ItemFrequency = 'low' | 'medium' | 'high';

export interface MatchPlayerConfig {
  /** Équipe de 0 à 3. Ignorée sans équipes. */
  readonly team: number;
}

export interface MatchConfig {
  readonly version: 1;
  readonly mode: MatchMode;
  /** Vies par joueur, de 1 à 99. Ignoré en Temps. */
  readonly stocks: number;
  /** Secondes ; 0 = sans limite (interdit en Temps). De 30 à 3 600 sinon. */
  readonly timeLimit: number;
  /** Points de vie en Endurance, de 1 à 999. */
  readonly stamina: number;
  readonly teams: boolean;
  /** Tir allié : les coéquipiers se blessent. */
  readonly teamAttack: boolean;
  /** Jauge d'attaque ultime active. */
  readonly ultimate: boolean;
  /** Transmis à `stages-items`, non interprété ici. */
  readonly items: { readonly enabled: boolean; readonly frequency: ItemFrequency };
  /** De 2 à 8 joueurs. */
  readonly players: readonly MatchPlayerConfig[];
}

export const MATCH_CONFIG_VERSION = 1;
export const MIN_PLAYERS = 2;
export const MAX_MATCH_PLAYERS = 8;
export const MAX_TEAMS = 4;
export const MAX_STOCKS = 99;
export const MAX_STAMINA = 999;
export const MIN_TIME_LIMIT = 30;
export const MAX_TIME_LIMIT = 3600;

const MODES: readonly MatchMode[] = ['stock', 'time', 'stamina'];
const FREQUENCIES: readonly ItemFrequency[] = ['low', 'medium', 'high'];
const KEYS = [
  'version',
  'mode',
  'stocks',
  'timeLimit',
  'stamina',
  'teams',
  'teamAttack',
  'ultimate',
  'items',
  'players',
] as const;

/** Configuration par défaut d'un mode (valeurs de la spec), équipes réparties en alternance. */
export function defaultMatchConfig(mode: MatchMode, players: number): MatchConfig {
  return {
    version: MATCH_CONFIG_VERSION,
    mode,
    stocks: mode === 'stamina' ? 1 : 3,
    timeLimit: mode === 'stock' ? 420 : mode === 'time' ? 180 : 0,
    stamina: 150,
    teams: false,
    teamAttack: false,
    ultimate: true,
    items: { enabled: true, frequency: 'medium' },
    players: Array.from({ length: players }, (_, i) => ({ team: i % 2 })),
  };
}

export type ValidationResult =
  | { readonly ok: true; readonly config: MatchConfig }
  | { readonly ok: false; readonly errors: string[] };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isIntIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

function unknownKeys(
  where: string,
  value: Record<string, unknown>,
  allowed: readonly string[],
  errors: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${where}${key} : champ inconnu.`);
  }
}

/**
 * Valide une valeur reçue. Renvoie une copie propre (aucune référence partagée avec l'entrée),
 * ou un message par erreur. N'accepte aucun champ inconnu.
 */
export function validateMatchConfig(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(value)) return { ok: false, errors: ['La configuration doit être un objet.'] };
  unknownKeys('', value, KEYS, errors);

  if (value.version !== MATCH_CONFIG_VERSION) {
    errors.push(`version : ${MATCH_CONFIG_VERSION} attendu.`);
  }
  const mode = value.mode;
  if (!MODES.includes(mode as MatchMode)) {
    errors.push(`mode : « stock », « time » ou « stamina » attendu.`);
  }
  if (!isIntIn(value.stocks, 1, MAX_STOCKS)) {
    errors.push(`stocks : entier de 1 à ${MAX_STOCKS} attendu.`);
  }
  const timeLimit = value.timeLimit;
  if (timeLimit !== 0 && !isIntIn(timeLimit, MIN_TIME_LIMIT, MAX_TIME_LIMIT)) {
    errors.push(`timeLimit : 0 ou entier de ${MIN_TIME_LIMIT} à ${MAX_TIME_LIMIT} attendu.`);
  } else if (timeLimit === 0 && mode === 'time') {
    errors.push('timeLimit : obligatoire en mode Temps.');
  }
  if (!isIntIn(value.stamina, 1, MAX_STAMINA)) {
    errors.push(`stamina : entier de 1 à ${MAX_STAMINA} attendu.`);
  }
  for (const key of ['teams', 'teamAttack', 'ultimate'] as const) {
    if (typeof value[key] !== 'boolean') errors.push(`${key} : booléen attendu.`);
  }

  const items = value.items;
  if (!isObject(items)) {
    errors.push('items : objet { enabled, frequency } attendu.');
  } else {
    unknownKeys('items.', items, ['enabled', 'frequency'], errors);
    if (typeof items.enabled !== 'boolean') errors.push('items.enabled : booléen attendu.');
    if (!FREQUENCIES.includes(items.frequency as ItemFrequency)) {
      errors.push('items.frequency : « low », « medium » ou « high » attendu.');
    }
  }

  const players = value.players;
  if (!Array.isArray(players)) {
    errors.push('players : liste attendue.');
  } else if (players.length < MIN_PLAYERS || players.length > MAX_MATCH_PLAYERS) {
    errors.push(`players : de ${MIN_PLAYERS} à ${MAX_MATCH_PLAYERS} joueurs attendus.`);
  } else {
    const before = errors.length;
    players.forEach((p: unknown, i) => {
      if (!isObject(p)) {
        errors.push(`players[${i}] : objet { team } attendu.`);
        return;
      }
      unknownKeys(`players[${i}].`, p, ['team'], errors);
      if (!isIntIn(p.team, 0, MAX_TEAMS - 1)) {
        errors.push(`players[${i}].team : entier de 0 à ${MAX_TEAMS - 1} attendu.`);
      }
    });
    if (errors.length === before && value.teams === true) {
      const distinct = new Set(players.map((p) => (p as MatchPlayerConfig).team));
      if (distinct.size < 2) errors.push('players : il faut au moins deux équipes différentes.');
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  const v = value as unknown as MatchConfig;
  return {
    ok: true,
    config: {
      version: MATCH_CONFIG_VERSION,
      mode: v.mode,
      stocks: v.stocks,
      timeLimit: v.timeLimit,
      stamina: v.stamina,
      teams: v.teams,
      teamAttack: v.teamAttack,
      ultimate: v.ultimate,
      items: { enabled: v.items.enabled, frequency: v.items.frequency },
      players: v.players.map((p) => ({ team: p.team })),
    },
  };
}
