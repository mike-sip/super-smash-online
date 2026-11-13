import { describe, expect, it } from 'vitest';
import { DEFAULT_GAMEPAD, DEFAULT_KEYBOARD, type Bindings } from '../src/bindings.ts';
import { DEFAULT_ANALOG } from '../src/gamepad.ts';
import {
  STORAGE_KEY,
  STORAGE_VERSION,
  cleanAnalog,
  decodeSettings,
  defaultSettings,
  encodeSettings,
  loadSettings,
  saveSettings,
  type Settings,
} from '../src/storage.ts';
import { memoryStorage } from './helpers.ts';

const remapped: Bindings = {
  ...DEFAULT_KEYBOARD,
  jump: [{ type: 'key', code: 'Space' }],
};

function custom(): Settings {
  return {
    keyboard: remapped,
    gamepads: {
      'Manette A': {
        ...DEFAULT_GAMEPAD,
        attack: [{ type: 'button', index: 3 }],
        jump: [
          { type: 'button', index: 0 },
          { type: 'button', index: 2 },
        ],
      },
    },
    analog: { deadzone: 0.25, threshold: 0.4 },
    tapJump: [true, false, false, true],
  };
}

describe('réglages par défaut', () => {
  it('reprennent les dispositions par défaut, sans saut au stick', () => {
    expect(defaultSettings()).toEqual({
      keyboard: DEFAULT_KEYBOARD,
      gamepads: {},
      analog: DEFAULT_ANALOG,
      tapJump: [false, false, false, false],
    });
  });
});

describe('aller-retour', () => {
  it('redonne exactement ce qui a été enregistré', () => {
    expect(decodeSettings(encodeSettings(custom()))).toEqual(custom());
  });

  it('porte un numéro de version', () => {
    expect(JSON.parse(encodeSettings(custom())).version).toBe(STORAGE_VERSION);
  });

  it('passe par le stockage', () => {
    const storage = memoryStorage();
    saveSettings(storage, custom());
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(loadSettings(storage)).toEqual(custom());
  });
});

describe('données absentes ou abîmées', () => {
  it('donne les réglages par défaut quand rien n’est enregistré', () => {
    expect(decodeSettings(null)).toEqual(defaultSettings());
    expect(loadSettings(memoryStorage())).toEqual(defaultSettings());
    expect(loadSettings(undefined)).toEqual(defaultSettings());
  });

  it('donne les réglages par défaut pour un texte illisible', () => {
    for (const text of ['', 'pas du json', '{', 'null', '42', '[]', '"texte"']) {
      expect(decodeSettings(text)).toEqual(defaultSettings());
    }
  });

  it('ignore tout ce qui vient d’une version inconnue', () => {
    const future = JSON.stringify({ ...JSON.parse(encodeSettings(custom())), version: 99 });
    expect(decodeSettings(future)).toEqual(defaultSettings());
    const none = JSON.parse(encodeSettings(custom()));
    delete none.version;
    expect(decodeSettings(JSON.stringify(none))).toEqual(defaultSettings());
  });

  it('remplace une disposition invalide par celle par défaut, et garde le reste', () => {
    const data = JSON.parse(encodeSettings(custom()));
    data.keyboard.jump = [];
    data.gamepads['Manette B'] = { attack: 'n’importe quoi' };
    const decoded = decodeSettings(JSON.stringify(data));
    expect(decoded.keyboard).toEqual(DEFAULT_KEYBOARD);
    expect(Object.keys(decoded.gamepads)).toEqual(['Manette A']);
    expect(decoded.analog).toEqual({ deadzone: 0.25, threshold: 0.4 });
    expect(decoded.tapJump).toEqual([true, false, false, true]);
  });

  it('refuse une disposition de clavier faite de boutons de manette', () => {
    const data = JSON.parse(encodeSettings(custom()));
    data.keyboard = DEFAULT_GAMEPAD;
    expect(decodeSettings(JSON.stringify(data)).keyboard).toEqual(DEFAULT_KEYBOARD);
  });

  it('écarte les champs en trop d’une disposition', () => {
    const data = JSON.parse(encodeSettings(custom()));
    data.keyboard.inconnue = [{ type: 'key', code: 'KeyQ' }];
    data.keyboard.attack = [{ type: 'key', code: 'KeyX', intrus: true }];
    const decoded = decodeSettings(JSON.stringify(data));
    expect(decoded.keyboard).toEqual(remapped);
  });

  it('remet des réglages analogiques ou un saut au stick aberrants à leur valeur par défaut', () => {
    const data = JSON.parse(encodeSettings(custom()));
    data.analog = { deadzone: 'beaucoup', threshold: null };
    data.tapJump = 'oui';
    const decoded = decodeSettings(JSON.stringify(data));
    expect(decoded.analog).toEqual(DEFAULT_ANALOG);
    expect(decoded.tapJump).toEqual([false, false, false, false]);

    data.tapJump = [true, 'x', 1];
    expect(decodeSettings(JSON.stringify(data)).tapJump).toEqual([true, false, false, false]);
  });

  it('ne casse rien quand le stockage refuse de lire ou d’écrire', () => {
    const broken = {
      getItem(): string | null {
        throw new Error('lecture interdite');
      },
      setItem(): void {
        throw new Error('quota dépassé');
      },
    };
    expect(loadSettings(broken)).toEqual(defaultSettings());
    expect(() => saveSettings(broken, custom())).not.toThrow();
    expect(() => saveSettings(undefined, custom())).not.toThrow();
  });
});

describe('cleanAnalog', () => {
  it('ramène les réglages dans des bornes jouables', () => {
    expect(cleanAnalog({ deadzone: -1, threshold: 5 })).toEqual({ deadzone: 0, threshold: 1 });
    expect(cleanAnalog({ deadzone: 0.99, threshold: 0 })).toEqual({
      deadzone: 0.6,
      threshold: 0.1,
    });
    expect(cleanAnalog({ deadzone: 0.2, threshold: 0.7 })).toEqual({
      deadzone: 0.2,
      threshold: 0.7,
    });
  });

  it('remplace une valeur qui n’est pas un nombre par celle par défaut', () => {
    expect(cleanAnalog({ deadzone: Number.NaN, threshold: Number.NaN })).toEqual(DEFAULT_ANALOG);
  });
});
