/**
 * Panneau son de la démo : coupure, volumes des effets et de la musique, état du son, planche
 * d'écoute. Les réglages sont gardés dans `localStorage`. Le panneau final appartiendra à
 * `app-shell` ; celui-ci sert à régler et à écouter.
 */
import {
  DEFAULT_AUDIO_SETTINGS,
  SOUND_NAMES,
  type AudioSettings,
  type GameAudio,
  type GameAudioState,
} from '@game/render';

const STORAGE_KEY = 'demo.audio';

const STATE_TEXT: Readonly<Record<GameAudioState, string>> = {
  locked:
    'Son bloqué par le navigateur : cliquez dans la page ou appuyez sur une touche du clavier pour l’activer (un bouton de manette ne suffit pas).',
  loading: 'Préparation des sons…',
  running: 'Son actif.',
  closed: 'Son arrêté.',
};

const level = (value: unknown, fallback: number): number =>
  typeof value === 'number' && value >= 0 && value <= 1 ? value : fallback;

/** Réglages enregistrés, ou ceux par défaut s'il n'y en a pas ou s'ils sont illisibles. */
export function loadAudioSettings(storage: Storage | undefined): AudioSettings {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw === null || raw === undefined) return DEFAULT_AUDIO_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Record<keyof AudioSettings, unknown>>;
    return {
      enabled:
        typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_AUDIO_SETTINGS.enabled,
      effects: level(parsed.effects, DEFAULT_AUDIO_SETTINGS.effects),
      music: level(parsed.music, DEFAULT_AUDIO_SETTINGS.music),
    };
  } catch {
    return DEFAULT_AUDIO_SETTINGS;
  }
}

function saveAudioSettings(storage: Storage | undefined, settings: AudioSettings): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Stockage plein ou interdit : le réglage vaut pour cette page seulement.
  }
}

export interface SoundPanelOptions {
  readonly panel: HTMLElement;
  readonly audio: GameAudio;
  readonly storage: Storage | undefined;
  /** Musique jouée par la démo. */
  readonly track: string;
}

export interface SoundPanel {
  toggle(): void;
  /** Met l'état du son à jour ; ne touche au DOM que s'il a changé. */
  refresh(): void;
}

export function createSoundPanel(options: SoundPanelOptions): SoundPanel {
  const { panel, audio, storage, track } = options;
  const doc = panel.ownerDocument;
  let shownState: GameAudioState | undefined;
  let musicOn = true;

  const title = doc.createElement('h2');
  title.textContent = 'Son';
  const status = doc.createElement('p');
  status.dataset.sound = 'status';
  status.className = 'message';

  function update(change: Partial<AudioSettings>): void {
    const next = { ...audio.settings, ...change };
    audio.setSettings(next);
    saveAudioSettings(storage, next);
  }

  /** Un champ du panneau ne garde pas le focus : les flèches doivent revenir au combattant. */
  const release = (element: HTMLElement): void => {
    element.addEventListener('change', () => element.blur());
  };

  const enabledLabel = doc.createElement('label');
  const enabledText = doc.createElement('span');
  enabledText.textContent = 'Son activé';
  const enabled = doc.createElement('input');
  enabled.type = 'checkbox';
  enabled.dataset.sound = 'enabled';
  enabled.checked = audio.settings.enabled;
  enabled.addEventListener('change', () => update({ enabled: enabled.checked }));
  release(enabled);
  enabledLabel.append(enabledText, enabled);

  function slider(key: 'effects' | 'music', label: string): HTMLLabelElement {
    const row = doc.createElement('label');
    const text = doc.createElement('span');
    text.textContent = label;
    const input = doc.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '1';
    input.dataset.sound = key;
    input.value = String(Math.round(audio.settings[key] * 100));
    input.addEventListener('input', () => update({ [key]: Number(input.value) / 100 }));
    release(input);
    row.append(text, input);
    return row;
  }

  const boardTitle = doc.createElement('h3');
  boardTitle.textContent = 'Planche d’écoute';
  const board = doc.createElement('div');
  board.className = 'board';
  SOUND_NAMES.forEach((name, id) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = name;
    button.dataset.soundPlay = String(id);
    button.addEventListener('click', () => {
      audio.unlock();
      audio.play(id);
      button.blur();
    });
    board.append(button);
  });
  const music = doc.createElement('button');
  music.type = 'button';
  music.dataset.sound = 'music-toggle';
  const musicLabel = (): string => (musicOn ? 'Arrêter la musique' : 'Relancer la musique');
  music.textContent = musicLabel();
  music.addEventListener('click', () => {
    musicOn = !musicOn;
    audio.playMusic(musicOn ? track : null);
    music.textContent = musicLabel();
    music.blur();
  });

  panel.append(
    title,
    status,
    enabledLabel,
    slider('effects', 'Effets'),
    slider('music', 'Musique'),
    boardTitle,
    board,
    music,
  );

  const panelApi: SoundPanel = {
    toggle() {
      panel.hidden = !panel.hidden;
      panelApi.refresh();
    },
    refresh() {
      const state = audio.state;
      if (state === shownState) return;
      shownState = state;
      status.textContent = STATE_TEXT[state];
    },
  };
  panelApi.refresh();
  return panelApi;
}
