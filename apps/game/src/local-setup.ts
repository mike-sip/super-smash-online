/**
 * État de la sélection du combat local (pur) : places rejointes par périphérique, personnage de
 * chaque place, « prêt » ; préréglages de règles ; derniers réglages gardés dans le navigateur.
 */
import { validateMatchConfig, type MatchConfig } from '@game/match-rules';
import { PALETTE_COUNT } from '@game/render';
import type { StorageLike } from './settings.ts';

export const RANDOM = 'random';
export const MAX_LOCAL = 4;
/** « Périphérique » d'une place tenue par l'ordinateur (SPEC-finition.md, phase 6). */
export const CPU_DEVICE = 'cpu';
/** Niveau de l'ordinateur par défaut. */
export const DEFAULT_CPU_LEVEL = 5;

export interface LocalSlot {
  device: string | null;
  fighter: string;
  /** Couleur alternative choisie (0 à 7). */
  palette: number;
  ready: boolean;
  /** Niveau de l'ordinateur (1 à 9), pour une place tenue par lui. */
  level: number;
}

export interface LocalSetup {
  readonly slots: LocalSlot[];
  /** Ordre de défilement : les personnages puis « Au hasard ». */
  readonly order: readonly string[];
}

export function createLocalSetup(
  roster: readonly string[],
  previous: readonly string[] = [],
): LocalSetup {
  const order = [...roster, RANDOM];
  return {
    order,
    slots: Array.from({ length: MAX_LOCAL }, (_, i) => ({
      device: null,
      fighter: order.includes(previous[i] ?? '') ? previous[i]! : roster[i % roster.length]!,
      palette: 0,
      ready: false,
      level: DEFAULT_CPU_LEVEL,
    })),
  };
}

export function slotOf(setup: LocalSetup, device: string): number {
  return setup.slots.findIndex((s) => s.device === device);
}

/** Place du périphérique (déjà rejointe, ou première libre), ou -1 s'il n'y en a plus. */
export function join(setup: LocalSetup, device: string): number {
  const existing = slotOf(setup, device);
  if (existing >= 0) return existing;
  let free = setup.slots.findIndex((s) => s.device === null);
  // Plus de place libre : un joueur humain prend celle d'un ordinateur.
  if (free < 0) free = lastCpu(setup);
  if (free < 0) return -1;
  setup.slots[free]!.device = device;
  setup.slots[free]!.ready = false;
  return free;
}

export const isCpu = (slot: LocalSlot): boolean => slot.device === CPU_DEVICE;

/** Dernière place tenue par l'ordinateur, ou -1. */
function lastCpu(setup: LocalSetup): number {
  for (let i = setup.slots.length - 1; i >= 0; i--) if (isCpu(setup.slots[i]!)) return i;
  return -1;
}

/** Nombre de places tenues par l'ordinateur. */
export function cpuCount(setup: LocalSetup): number {
  return setup.slots.filter(isCpu).length;
}

/**
 * Règle le nombre d'ordinateurs : ils prennent les places libres (les dernières d'abord libérées).
 * Les places des joueurs humains ne sont jamais touchées. Renvoie le nombre obtenu.
 */
export function setCpuCount(setup: LocalSetup, count: number, level: number): number {
  while (cpuCount(setup) > count) {
    const last = lastCpu(setup);
    setup.slots[last]!.device = null;
    setup.slots[last]!.ready = false;
  }
  while (cpuCount(setup) < count) {
    const free = setup.slots.findIndex((s) => s.device === null);
    if (free < 0) break;
    const s = setup.slots[free]!;
    s.device = CPU_DEVICE;
    s.ready = true;
    s.level = level;
  }
  return cpuCount(setup);
}

/** Niveau de tous les ordinateurs. */
export function setCpuLevel(setup: LocalSetup, level: number): void {
  for (const s of setup.slots) if (isCpu(s)) s.level = level;
}

export function leave(setup: LocalSetup, slot: number): void {
  const s = setup.slots[slot];
  if (s === undefined) return;
  s.device = null;
  s.ready = false;
}

export function joined(setup: LocalSetup): number {
  return setup.slots.filter((s) => s.device !== null).length;
}

export function cycleFighter(setup: LocalSetup, slot: number, delta: number): void {
  const s = setup.slots[slot];
  if (s === undefined) return;
  const at = Math.max(0, setup.order.indexOf(s.fighter));
  s.fighter = setup.order[(at + delta + setup.order.length) % setup.order.length]!;
  s.ready = isCpu(s);
}

/** Change la couleur alternative de la place (↑ ↓), en boucle sur les huit. */
export function cyclePalette(setup: LocalSetup, slot: number, delta: number): void {
  const s = setup.slots[slot];
  if (s === undefined) return;
  s.palette = (s.palette + delta + PALETTE_COUNT) % PALETTE_COUNT;
  s.ready = isCpu(s);
}

export function toggleReady(setup: LocalSetup, slot: number): void {
  const s = setup.slots[slot];
  // L'ordinateur est toujours prêt.
  if (s !== undefined && s.device !== null && !isCpu(s)) s.ready = !s.ready;
}

/** Au moins `min` joueurs, tous prêts. */
export function canContinue(setup: LocalSetup, min: number): boolean {
  const players = setup.slots.filter((s) => s.device !== null);
  return players.length >= min && players.every((s) => s.ready);
}

/** Joueurs rejoints, dans l'ordre des places, « Au hasard » tiré par `random` (0 ≤ x < 1). */
export function resolveFighters(
  setup: LocalSetup,
  roster: readonly string[],
  random: () => number,
): { slot: number; device: string; fighter: string; palette: number; cpu: number | null }[] {
  const out: {
    slot: number;
    device: string;
    fighter: string;
    palette: number;
    cpu: number | null;
  }[] = [];
  setup.slots.forEach((s, slot) => {
    if (s.device === null) return;
    const fighter =
      s.fighter === RANDOM
        ? roster[Math.min(roster.length - 1, Math.floor(random() * roster.length))]!
        : s.fighter;
    out.push({
      slot,
      device: s.device,
      fighter,
      palette: s.palette,
      cpu: isCpu(s) ? s.level : null,
    });
  });
  return out;
}

// --- Règles -------------------------------------------------------------------------------

/** Règles sans joueurs ni version : ce que l'écran des règles fait varier. */
export type LocalRules = Omit<MatchConfig, 'players' | 'version'>;

export const PRESETS: readonly { id: string; label: string; rules: LocalRules }[] = [
  {
    id: 'classic',
    label: 'Classique',
    rules: {
      mode: 'stock',
      stocks: 3,
      timeLimit: 420,
      stamina: 150,
      teams: false,
      teamAttack: false,
      ultimate: true,
      items: { enabled: true, frequency: 'normal' },
    },
  },
  {
    id: 'time',
    label: 'Chrono',
    rules: {
      mode: 'time',
      stocks: 3,
      timeLimit: 120,
      stamina: 150,
      teams: false,
      teamAttack: false,
      ultimate: true,
      items: { enabled: true, frequency: 'normal' },
    },
  },
  {
    id: 'stamina',
    label: 'Endurance',
    rules: {
      mode: 'stamina',
      stocks: 1,
      timeLimit: 0,
      stamina: 150,
      teams: false,
      teamAttack: false,
      ultimate: true,
      items: { enabled: false, frequency: 'normal' },
    },
  },
];

/** `MatchConfig` complète et validée par `match-rules` ; `teams` : l'équipe de chaque joueur. */
export function matchFromRules(
  rules: LocalRules,
  teams: readonly number[],
): { ok: true; match: MatchConfig } | { ok: false; errors: string[] } {
  const match = {
    version: 1,
    ...rules,
    players: teams.map((team) => ({ team })),
  } as MatchConfig;
  const valid = validateMatchConfig(match);
  if (!valid.ok) return { ok: false, errors: [...valid.errors] };
  if (rules.teams && new Set(teams).size < 2) {
    return { ok: false, errors: ['En équipes, il faut au moins deux équipes différentes.'] };
  }
  return { ok: true, match };
}

// --- Derniers réglages --------------------------------------------------------------------

export const LOCAL_PREFS_KEY = 'fracas.local';

export interface LocalPrefs {
  readonly fighters: readonly string[];
  readonly stage: string;
  readonly hazards: boolean;
  readonly rules: LocalRules;
}

export function loadLocalPrefs(storage: StorageLike | undefined): LocalPrefs | null {
  try {
    const raw = storage?.getItem(LOCAL_PREFS_KEY);
    if (raw === null || raw === undefined) return null;
    const v = JSON.parse(raw) as Partial<LocalPrefs>;
    if (!Array.isArray(v.fighters) || !v.fighters.every((f) => typeof f === 'string')) return null;
    if (typeof v.stage !== 'string' || typeof v.hazards !== 'boolean') return null;
    if (typeof v.rules !== 'object' || v.rules === null) return null;
    if (!matchFromRules(v.rules, [0, 1]).ok) return null;
    return { fighters: v.fighters, stage: v.stage, hazards: v.hazards, rules: v.rules };
  } catch {
    return null;
  }
}

export function saveLocalPrefs(storage: StorageLike | undefined, prefs: LocalPrefs): void {
  try {
    storage?.setItem(LOCAL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Rien de grave : les réglages valent pour cette visite.
  }
}
