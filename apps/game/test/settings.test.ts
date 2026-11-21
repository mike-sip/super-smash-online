import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
  saveSettings,
  type Settings,
} from '../src/settings.ts';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('réglages', () => {
  it('sans stockage : valeurs par défaut', () => {
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(undefined, DEFAULT_SETTINGS)).not.toThrow();
  });

  it('écrit puis relit', () => {
    const s = memory();
    const changed: Settings = {
      ...DEFAULT_SETTINGS,
      audio: { enabled: false, music: 0.2, effects: 0.4, menuSounds: false },
      display: {
        pixelRatio: 1,
        quality: 'medium',
        largeText: true,
        reducedMotion: true,
        showFps: true,
      },
    };
    saveSettings(s, changed);
    expect(loadSettings(s)).toEqual(changed);
  });

  it('JSON illisible, autre version, mauvais types : valeurs par défaut', () => {
    expect(loadSettings(memory({ [SETTINGS_KEY]: '{' }))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memory({ [SETTINGS_KEY]: '{"version":99}' }))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memory({ [SETTINGS_KEY]: 'null' }))).toEqual(DEFAULT_SETTINGS);
    const wrong = JSON.stringify({ version: 1, audio: { enabled: 'oui', music: 'fort' } });
    expect(loadSettings(memory({ [SETTINGS_KEY]: wrong }))).toEqual(DEFAULT_SETTINGS);
  });

  it('valeurs hors bornes ramenées ; champs valides gardés un par un', () => {
    const raw = JSON.stringify({
      version: 1,
      audio: { enabled: true, music: 7, effects: -1, menuSounds: false },
      display: { pixelRatio: 3, quality: 'extrême', largeText: true },
    });
    const s = loadSettings(memory({ [SETTINGS_KEY]: raw }));
    expect(s.audio).toEqual({ enabled: true, music: 1, effects: 0, menuSounds: false });
    expect(s.display.pixelRatio).toBe(DEFAULT_SETTINGS.display.pixelRatio);
    expect(s.display.quality).toBe('auto');
    expect(s.display.largeText).toBe(true);
    expect(s.display.reducedMotion).toBe(DEFAULT_SETTINGS.display.reducedMotion);
  });

  it('un stockage qui lève (navigation privée stricte) ne gêne pas', () => {
    const broken = {
      getItem: () => {
        throw new Error('interdit');
      },
      setItem: () => {
        throw new Error('interdit');
      },
      removeItem: () => {},
    };
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(broken, DEFAULT_SETTINGS)).not.toThrow();
  });
});
