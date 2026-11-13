/** Assemblage : écoute des périphériques, attribution aux joueurs, lecture par frame, réglages. */
import { withTapJump } from './analog.ts';
import type { BindingError, Bindings, DeviceKind, PhysicalInput } from './bindings.ts';
import { DEFAULT_GAMEPAD, DEFAULT_KEYBOARD, validateBindings } from './bindings.ts';
import { createPadBaseline, detectPadInput, type PadBaseline } from './capture.ts';
import {
  anyButtonPressed,
  createGamepadReader,
  type AnalogSettings,
  type GamepadReader,
  type PadState,
} from './gamepad.ts';
import { createKeyboardState } from './keyboard.ts';
import { describeInput } from './labels.ts';
import { cleanAnalog, loadSettings, saveSettings, type StorageLike } from './storage.ts';

/** Un périphérique vu par le module : le clavier, ou une manette branchée. */
export interface Device {
  readonly id: string;
  readonly kind: DeviceKind;
  /** Nom à afficher au joueur. */
  readonly label: string;
  readonly connected: boolean;
  /**
   * Faux pour une manette que le navigateur ne reconnaît pas comme « standard » : ses boutons
   * peuvent être dans un autre ordre, et la disposition par défaut ne pas lui convenir.
   */
  readonly standard: boolean;
}

export interface InputOptions {
  /** Cible des événements clavier et source des manettes. */
  readonly target: Window;
  /** Nombre d'emplacements de joueurs locaux, de 1 à 4. */
  readonly players: number;
  /** Où enregistrer dispositions et réglages (`localStorage`) ; absent : rien n'est conservé. */
  readonly storage?: StorageLike;
}

export interface Input {
  /**
   * À appeler une fois par frame simulée, juste avant `step`. Lit les périphériques et écrit
   * l'InputFrame de chaque joueur local dans `out[emplacement]`. Un emplacement sans
   * périphérique, ou dont la manette est débranchée, reçoit 0. N'alloue rien.
   */
  sample(out: Uint32Array): void;

  /** Le clavier, puis les manettes vues depuis la création, branchées ou non. */
  devices(): readonly Device[];
  /** Périphérique de l'emplacement, ou `null`. */
  assigned(player: number): Device | null;
  /**
   * Attribue un périphérique à un emplacement ; `null` libère l'emplacement. Un périphérique
   * n'appartient qu'à un joueur. Ce qui est enfoncé au moment de l'attribution ne compte pas :
   * il faut le relâcher d'abord.
   */
  assign(player: number, deviceId: string | null): void;

  /**
   * Appelé pendant `sample` quand un périphérique non attribué est actionné (touche du jeu,
   * bouton de manette) : un joueur veut rejoindre. Renvoie de quoi retirer l'écouteur.
   */
  onJoinRequest(listener: (device: Device) => void): () => void;
  /** Appelé pendant `sample` au branchement et au débranchement d'une manette. */
  onDeviceChange(listener: (device: Device) => void): () => void;

  bindings(deviceId: string): Bindings;
  /**
   * Refuse une disposition invalide et renvoie la raison ; sinon l'applique et l'enregistre.
   * Les manettes d'un même modèle partagent leur disposition.
   */
  setBindings(deviceId: string, bindings: Bindings): BindingError | null;
  resetBindings(deviceId: string): void;
  /**
   * Prochaine touche, prochain bouton ou prochain demi-axe actionné sur ce périphérique. La
   * commande capturée ne joue pas. Pour une manette, la capture avance à chaque `sample` : il
   * faut continuer de l'appeler. Une nouvelle capture annule la précédente.
   */
  captureNext(deviceId: string, signal?: AbortSignal): Promise<PhysicalInput>;
  /** Nom à afficher pour une commande, d'après le clavier du joueur quand il est connu. */
  describe(deviceId: string, input: PhysicalInput): string;

  analog(): AnalogSettings;
  /** Applique et enregistre les réglages, ramenés dans des bornes jouables. */
  setAnalog(settings: AnalogSettings): void;

  /** Saut en poussant le stick vers le haut, par joueur. Désactivé par défaut. */
  tapJump(player: number): boolean;
  setTapJump(player: number, enabled: boolean): void;

  dispose(): void;
}

/** Identifiant du clavier : il n'y en a qu'un, quel que soit le nombre de claviers branchés. */
export const KEYBOARD_ID = 'keyboard';
export const MAX_LOCAL_PLAYERS = 4;
/** L'API Gamepad garantit quatre manettes ; au-delà, cela dépend du navigateur. */
const MAX_PADS = 4;

/** Identifiant de la manette d'index `index` dans `navigator.getGamepads()`. */
export const gamepadId = (index: number): string => `gamepad-${index}`;

const TEXT_FIELDS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const NO_PADS: readonly null[] = [];

/** Vrai si l'événement vient d'un champ où le joueur tape du texte. */
function fromTextField(event: Event): boolean {
  const target = event.target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (target === null) return false;
  return (
    target.isContentEditable === true ||
    (typeof target.tagName === 'string' && TEXT_FIELDS.has(target.tagName))
  );
}

/** Ce que le module lit d'un objet `Gamepad`. */
interface RawPad extends PadState {
  readonly id: string;
  readonly connected: boolean;
  readonly mapping: string;
}

/** Ce que le module lit de `navigator`. Tout y est facultatif : rien n'est garanti partout. */
interface NavigatorLike {
  getGamepads?: () => readonly (RawPad | null)[];
  keyboard?: { getLayoutMap?: () => Promise<{ get(code: string): string | undefined }> };
}

interface PadSlot {
  /** Décrit la manette ; remplacé (jamais modifié) quand elle se branche ou se débranche. */
  device: Device | null;
  readonly reader: GamepadReader;
  bindings: Bindings;
  /** Emplacement du joueur, ou -1. */
  player: number;
  /** Vrai si un bouton était enfoncé à la lecture précédente. */
  wasPressed: boolean;
  /** Vrai tant que les boutons enfoncés au moment de l'attribution n'ont pas été relâchés. */
  muted: boolean;
}

/** Capture en cours pour le remappage. */
interface Capture {
  /** Index de la manette écoutée, -1 pour le clavier. */
  readonly padIndex: number;
  /** État de la manette au début de la capture ; `null` tant qu'elle n'a pas été lue. */
  baseline: PadBaseline | null;
  readonly resolve: (input: PhysicalInput) => void;
  readonly reject: (reason: Error) => void;
  /** Retire l'écoute du signal d'annulation. */
  readonly detach: () => void;
}

export function createInput(options: InputOptions): Input {
  const { target, players, storage } = options;
  if (!Number.isInteger(players) || players < 1 || players > MAX_LOCAL_PLAYERS) {
    throw new Error(`Il faut de 1 à ${MAX_LOCAL_PLAYERS} joueurs locaux, reçu ${players}.`);
  }

  const settings = loadSettings(storage);
  const save = (): void => saveSettings(storage, settings);

  const keyboardDevice: Device = {
    id: KEYBOARD_ID,
    kind: 'keyboard',
    label: 'Clavier',
    connected: true,
    standard: true,
  };
  const keyboard = createKeyboardState(settings.keyboard);
  /** Emplacement du joueur au clavier, ou -1. */
  let keyboardPlayer = -1;
  /** Vrai si le clavier, non attribué, était actionné à la lecture précédente. */
  let keyboardWasActive = false;

  const pads: PadSlot[] = [];
  for (let i = 0; i < MAX_PADS; i++) {
    pads.push({
      device: null,
      reader: createGamepadReader(DEFAULT_GAMEPAD),
      bindings: DEFAULT_GAMEPAD,
      player: -1,
      wasPressed: false,
      muted: false,
    });
  }

  // Liste rendue par `devices()` : reconstruite seulement quand un périphérique change.
  let deviceList: readonly Device[] = [keyboardDevice];
  const joinListeners = new Set<(device: Device) => void>();
  const changeListeners = new Set<(device: Device) => void>();
  let capture: Capture | null = null;
  let disposed = false;

  const navigator = (target.navigator ?? {}) as NavigatorLike;
  // Caractère porté par chaque touche sur le clavier du joueur, quand le navigateur le donne.
  let layout: { get(code: string): string | undefined } | undefined;
  try {
    void navigator.keyboard?.getLayoutMap?.().then(
      (map) => (layout = map),
      () => undefined,
    );
  } catch {
    // API absente ou interdite : les touches seront nommées d'après leur position.
  }

  function endCapture(): Capture | null {
    const ended = capture;
    capture = null;
    ended?.detach();
    return ended;
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (capture !== null && capture.padIndex < 0) {
      // Remappage : la touche est prise telle quelle, ne joue pas, et n'atteint personne d'autre.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat || event.code === '') return;
      endCapture()!.resolve({ type: 'key', code: event.code });
      return;
    }
    // Une touche tenue avec Ctrl, Alt ou Méta est un raccourci du navigateur, jamais une commande.
    if (event.ctrlKey || event.altKey || event.metaKey || fromTextField(event)) return;
    // Sans cela, les flèches font défiler la page.
    if (keyboard.press(event.code)) event.preventDefault();
  };
  const onKeyUp = (event: KeyboardEvent): void => keyboard.release(event.code);
  // Une touche relâchée hors de la fenêtre ne produit pas d'événement : on relâche tout.
  const onBlur = (): void => keyboard.releaseAll();

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);

  function checkPlayer(player: number): void {
    if (!Number.isInteger(player) || player < 0 || player >= players) {
      throw new Error(`Emplacement de joueur ${player} hors de 0 à ${players - 1}.`);
    }
  }

  /** Index de la manette désignée, -1 pour le clavier. Refuse un périphérique jamais vu. */
  function padIndexOf(deviceId: string): number {
    if (deviceId === KEYBOARD_ID) return -1;
    for (let i = 0; i < MAX_PADS; i++) {
      if (pads[i]!.device?.id === deviceId) return i;
    }
    throw new Error(`Périphérique inconnu : ${deviceId}.`);
  }

  function release(player: number): void {
    if (keyboardPlayer === player) keyboardPlayer = -1;
    for (const pad of pads) if (pad.player === player) pad.player = -1;
  }

  function useBindings(slot: PadSlot, bindings: Bindings): void {
    slot.bindings = bindings;
    slot.reader.setBindings(bindings);
  }

  /** Met à jour la description d'une manette et prévient si elle vient de changer d'état. */
  function track(slot: PadSlot, index: number, raw: RawPad | null): void {
    const connected = raw !== null;
    const known = slot.device;
    if (known === null ? !connected : known.connected === connected) return;
    slot.device = {
      id: gamepadId(index),
      kind: 'gamepad',
      label: raw !== null ? raw.id : known!.label,
      connected,
      standard: raw !== null ? raw.mapping === 'standard' : known!.standard,
    };
    slot.wasPressed = false;
    // Une manette qui se branche reprend la disposition enregistrée pour son modèle.
    if (raw !== null) useBindings(slot, settings.gamepads[raw.id] ?? DEFAULT_GAMEPAD);
    const list: Device[] = [keyboardDevice];
    for (const pad of pads) if (pad.device !== null) list.push(pad.device);
    deviceList = list;
    for (const listener of changeListeners) listener(slot.device);
  }

  return {
    sample(out) {
      for (let p = 0; p < players; p++) out[p] = 0;
      if (disposed) return;

      // Clavier : lu à chaque frame même sans joueur, pour ne pas accumuler d'appuis en attente.
      const keys = keyboard.sample();
      if (keyboardPlayer >= 0) {
        out[keyboardPlayer] = settings.tapJump[keyboardPlayer] === true ? withTapJump(keys) : keys;
      } else {
        const active = keys !== 0;
        if (active && !keyboardWasActive) {
          for (const listener of joinListeners) listener(keyboardDevice);
        }
        keyboardWasActive = active;
      }

      const raws = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : NO_PADS;
      const analog = settings.analog;
      for (let i = 0; i < MAX_PADS; i++) {
        const slot = pads[i]!;
        const found = raws[i];
        const raw = found !== null && found !== undefined && found.connected ? found : null;
        track(slot, i, raw);

        if (capture !== null && capture.padIndex === i) {
          // Remappage en cours sur cette manette : elle ne joue pas.
          if (raw === null) {
            endCapture()!.reject(new Error('Manette débranchée pendant la capture.'));
          } else if (capture.baseline === null) {
            capture.baseline = createPadBaseline(raw, analog.threshold);
          } else {
            const input = detectPadInput(capture.baseline, raw, analog.threshold);
            if (input !== null) {
              // Ce qui vient d'être actionné ne doit pas jouer en étant relâché.
              slot.muted = true;
              endCapture()!.resolve(input);
            }
          }
          if (raw !== null) slot.wasPressed = anyButtonPressed(raw, analog.threshold);
          continue;
        }
        if (raw === null) continue;

        const pressed = anyButtonPressed(raw, analog.threshold);
        const newPress = pressed && !slot.wasPressed;
        // Noté avant de prévenir les écouteurs : s'ils attribuent la manette, `assign` doit
        // savoir qu'un bouton est enfoncé.
        slot.wasPressed = pressed;
        if (slot.player < 0) {
          if (newPress) for (const listener of joinListeners) listener(slot.device!);
        } else if (slot.muted) {
          slot.muted = pressed;
        } else {
          const frame = slot.reader.read(raw, analog);
          out[slot.player] = settings.tapJump[slot.player] === true ? withTapJump(frame) : frame;
        }
      }
    },

    devices: () => deviceList,

    assigned(player) {
      checkPlayer(player);
      if (player === keyboardPlayer) return keyboardDevice;
      for (let i = 0; i < MAX_PADS; i++) {
        if (pads[i]!.player === player) return pads[i]!.device;
      }
      return null;
    },

    assign(player, deviceId) {
      checkPlayer(player);
      if (deviceId === null) {
        release(player);
        return;
      }
      const padIndex = padIndexOf(deviceId);
      release(player);
      if (padIndex < 0) {
        // Une touche tenue pendant l'attribution ne doit pas compter pour le nouveau joueur.
        keyboard.releaseAll();
        keyboardPlayer = player;
        keyboardWasActive = false;
      } else {
        const slot = pads[padIndex]!;
        slot.player = player;
        // De même pour le bouton qui a servi à rejoindre : la manette reste muette jusqu'à ce
        // que tout soit relâché.
        slot.muted = slot.wasPressed;
      }
    },

    onJoinRequest(listener) {
      joinListeners.add(listener);
      return () => void joinListeners.delete(listener);
    },

    onDeviceChange(listener) {
      changeListeners.add(listener);
      return () => void changeListeners.delete(listener);
    },

    bindings(deviceId) {
      const padIndex = padIndexOf(deviceId);
      return padIndex < 0 ? settings.keyboard : pads[padIndex]!.bindings;
    },

    setBindings(deviceId, bindings) {
      const padIndex = padIndexOf(deviceId);
      const error = validateBindings(padIndex < 0 ? 'keyboard' : 'gamepad', bindings);
      if (error !== null) return error;
      if (padIndex < 0) {
        settings.keyboard = bindings;
        keyboard.setBindings(bindings);
      } else {
        const label = pads[padIndex]!.device!.label;
        settings.gamepads[label] = bindings;
        for (const slot of pads) if (slot.device?.label === label) useBindings(slot, bindings);
      }
      save();
      return null;
    },

    resetBindings(deviceId) {
      const padIndex = padIndexOf(deviceId);
      if (padIndex < 0) {
        settings.keyboard = DEFAULT_KEYBOARD;
        keyboard.setBindings(DEFAULT_KEYBOARD);
      } else {
        const label = pads[padIndex]!.device!.label;
        delete settings.gamepads[label];
        for (const slot of pads) {
          if (slot.device?.label === label) useBindings(slot, DEFAULT_GAMEPAD);
        }
      }
      save();
    },

    captureNext(deviceId, signal) {
      return new Promise<PhysicalInput>((resolve, reject) => {
        const padIndex = padIndexOf(deviceId);
        endCapture()?.reject(new Error('Capture remplacée par une autre.'));
        if (signal?.aborted === true) {
          reject(new Error('Capture annulée.'));
          return;
        }
        const onAbort = (): void => {
          if (capture === mine) endCapture()!.reject(new Error('Capture annulée.'));
        };
        signal?.addEventListener('abort', onAbort);
        const mine: Capture = {
          padIndex,
          baseline: null,
          resolve,
          reject,
          detach: () => signal?.removeEventListener('abort', onAbort),
        };
        capture = mine;
      });
    },

    describe(deviceId, input) {
      return describeInput(input, padIndexOf(deviceId) < 0 ? layout : undefined);
    },

    analog: () => settings.analog,

    setAnalog(next) {
      settings.analog = cleanAnalog(next);
      save();
    },

    tapJump(player) {
      checkPlayer(player);
      return settings.tapJump[player] === true;
    },

    setTapJump(player, enabled) {
      checkPlayer(player);
      settings.tapJump[player] = enabled;
      save();
    },

    dispose() {
      disposed = true;
      endCapture()?.reject(new Error('Module arrêté.'));
      keyboard.releaseAll();
      joinListeners.clear();
      changeListeners.clear();
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
    },
  };
}
