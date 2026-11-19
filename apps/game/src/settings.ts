/**
 * Réglages du joueur gardés dans le navigateur : son et affichage. Les commandes sont gardées par
 * `input` lui-même. Lecture tolérante : un champ illisible ou hors bornes reprend sa valeur par
 * défaut, une autre version ou un JSON cassé redonne tous les défauts, et l'absence de stockage
 * (navigation privée stricte) ne gêne jamais.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

import { QUALITIES, type QualitySetting } from '@game/render';

export type PixelRatioCap = 1 | 1.5 | 2;
export const PIXEL_RATIOS: readonly PixelRatioCap[] = [1, 1.5, 2];

/** Qualité graphique : automatique d'abord, puis du moins cher au plus cher. */
export const QUALITY_SETTINGS: readonly QualitySetting[] = ['auto', ...QUALITIES];

export interface AudioPrefs {
  readonly enabled: boolean;
  /** De 0 à 1. */
  readonly music: number;
  readonly effects: number;
  readonly menuSounds: boolean;
}

export interface DisplayPrefs {
  /** Densité de pixels du rendu, plafonnée (moins = plus rapide). */
  readonly pixelRatio: PixelRatioCap;
  /** Qualité graphique (SPEC-visuals.md) ; automatique par défaut. */
  readonly quality: QualitySetting;
  readonly largeText: boolean;
  readonly reducedMotion: boolean;
  readonly showFps: boolean;
}

export interface Settings {
  readonly version: 1;
  readonly audio: AudioPrefs;
  readonly display: DisplayPrefs;
}

export const SETTINGS_KEY = 'fracas.settings';

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  audio: { enabled: true, music: 0.6, effects: 0.8, menuSounds: true },
  display: {
    pixelRatio: 2,
    quality: 'auto',
    largeText: false,
    reducedMotion: false,
    showFps: false,
  },
};

type Bag = Record<string, unknown>;

const isBag = (v: unknown): v is Bag => typeof v === 'object' && v !== null && !Array.isArray(v);

function bool(bag: Bag, key: string, fallback: boolean): boolean {
  return typeof bag[key] === 'boolean' ? (bag[key] as boolean) : fallback;
}

function unit(bag: Bag, key: string, fallback: number): number {
  const v = bag[key];
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

export function loadSettings(storage: StorageLike | undefined): Settings {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(SETTINGS_KEY) ?? null;
  } catch {
    raw = null;
  }
  if (raw === null) return DEFAULT_SETTINGS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (!isBag(parsed) || parsed.version !== 1) return DEFAULT_SETTINGS;
  const a = isBag(parsed.audio) ? parsed.audio : {};
  const d = isBag(parsed.display) ? parsed.display : {};
  const da = DEFAULT_SETTINGS.audio;
  const dd = DEFAULT_SETTINGS.display;
  const ratio = PIXEL_RATIOS.find((r) => r === d.pixelRatio) ?? dd.pixelRatio;
  return {
    version: 1,
    audio: {
      enabled: bool(a, 'enabled', da.enabled),
      music: unit(a, 'music', da.music),
      effects: unit(a, 'effects', da.effects),
      menuSounds: bool(a, 'menuSounds', da.menuSounds),
    },
    display: {
      pixelRatio: ratio,
      quality: QUALITY_SETTINGS.find((q) => q === d.quality) ?? dd.quality,
      largeText: bool(d, 'largeText', dd.largeText),
      reducedMotion: bool(d, 'reducedMotion', dd.reducedMotion),
      showFps: bool(d, 'showFps', dd.showFps),
    },
  };
}

export function saveSettings(storage: StorageLike | undefined, settings: Settings): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Stockage plein ou interdit : le réglage vaut pour cette visite seulement.
  }
}
