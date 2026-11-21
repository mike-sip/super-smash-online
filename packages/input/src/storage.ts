/**
 * Enregistrement des dispositions et des réglages dans le navigateur. Logique pure : le stockage
 * est fourni par l'appelant, et rien ici ne lève d'erreur.
 *
 * Tout ce qui est relu est considéré comme douteux (ancienne version, édition à la main, données
 * tronquées) : chaque partie est vérifiée séparément, et remplacée par sa valeur par défaut si
 * elle ne convient pas.
 */
import { ACTIONS } from './actions.ts';
import {
  DEFAULT_KEYBOARD,
  validateBindings,
  type Bindings,
  type DeviceKind,
  type PhysicalInput,
} from './bindings.ts';
import { DEFAULT_ANALOG, type AnalogSettings } from './gamepad.ts';

export const STORAGE_KEY = 'game.input';
/** À augmenter quand le format change ; des données d'une autre version sont ignorées. */
export const STORAGE_VERSION = 1;

const PLAYER_SLOTS = 4;
/** Bornes des réglages analogiques : au-delà, la manette devient injouable. */
const MAX_DEADZONE = 0.6;
const MIN_THRESHOLD = 0.1;

export interface Settings {
  keyboard: Bindings;
  /** Dispositions des manettes, par nom de modèle : deux manettes identiques la partagent. */
  gamepads: Record<string, Bindings>;
  analog: AnalogSettings;
  /** Saut en poussant le stick vers le haut, par emplacement de joueur. */
  tapJump: boolean[];
}

/** Ce que le module attend d'un stockage : `localStorage` convient. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function defaultSettings(): Settings {
  return {
    keyboard: DEFAULT_KEYBOARD,
    gamepads: {},
    analog: DEFAULT_ANALOG,
    tapJump: new Array<boolean>(PLAYER_SLOTS).fill(false),
  };
}

/** Ramène des réglages analogiques dans des bornes jouables. */
export function cleanAnalog(analog: AnalogSettings): AnalogSettings {
  const deadzone = Number.isFinite(analog.deadzone) ? analog.deadzone : DEFAULT_ANALOG.deadzone;
  const threshold = Number.isFinite(analog.threshold) ? analog.threshold : DEFAULT_ANALOG.threshold;
  return {
    deadzone: Math.min(MAX_DEADZONE, Math.max(0, deadzone)),
    threshold: Math.min(1, Math.max(MIN_THRESHOLD, threshold)),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Copie d'une commande réduite à ses champs connus. */
function cleanInput(input: PhysicalInput): PhysicalInput {
  if (input.type === 'key') return { type: 'key', code: input.code };
  if (input.type === 'button') return { type: 'button', index: input.index };
  return { type: 'axis', index: input.index, direction: input.direction };
}

/** Disposition relue, ou `null` si elle n'est pas utilisable pour ce type de périphérique. */
function decodeBindings(kind: DeviceKind, value: unknown): Bindings | null {
  if (!isRecord(value)) return null;
  const candidate = value as unknown as Bindings;
  if (validateBindings(kind, candidate) !== null) return null;
  const clean = {} as Record<(typeof ACTIONS)[number], PhysicalInput[]>;
  for (const action of ACTIONS) clean[action] = candidate[action].map(cleanInput);
  return clean;
}

/** Relit des réglages. Ne lève jamais d'erreur : ce qui ne convient pas reprend sa valeur par défaut. */
export function decodeSettings(text: string | null): Settings {
  const settings = defaultSettings();
  if (text === null) return settings;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return settings;
  }
  if (!isRecord(data) || data.version !== STORAGE_VERSION) return settings;

  settings.keyboard = decodeBindings('keyboard', data.keyboard) ?? DEFAULT_KEYBOARD;
  if (isRecord(data.gamepads)) {
    for (const [label, value] of Object.entries(data.gamepads)) {
      const bindings = decodeBindings('gamepad', value);
      if (bindings !== null) settings.gamepads[label] = bindings;
    }
  }
  if (
    isRecord(data.analog) &&
    typeof data.analog.deadzone === 'number' &&
    typeof data.analog.threshold === 'number'
  ) {
    settings.analog = cleanAnalog({
      deadzone: data.analog.deadzone,
      threshold: data.analog.threshold,
    });
  }
  if (Array.isArray(data.tapJump)) {
    for (let p = 0; p < PLAYER_SLOTS; p++) settings.tapJump[p] = data.tapJump[p] === true;
  }
  return settings;
}

export function encodeSettings(settings: Settings): string {
  return JSON.stringify({ version: STORAGE_VERSION, ...settings });
}

/** Relit les réglages enregistrés ; sans stockage, ou s'il refuse la lecture : valeurs par défaut. */
export function loadSettings(storage: StorageLike | undefined): Settings {
  if (storage === undefined) return defaultSettings();
  try {
    return decodeSettings(storage.getItem(STORAGE_KEY));
  } catch {
    return defaultSettings();
  }
}

/** Enregistre les réglages. Un stockage absent, plein ou interdit est ignoré en silence. */
export function saveSettings(storage: StorageLike | undefined, settings: Settings): void {
  if (storage === undefined) return;
  try {
    storage.setItem(STORAGE_KEY, encodeSettings(settings));
  } catch {
    // Navigation privée, quota dépassé : le jeu continue avec les réglages en mémoire.
  }
}
