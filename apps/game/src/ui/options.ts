/** Options : commandes (remappage par l'API d'`input`), son et affichage. */
import { ACTIONS, KEYBOARD_ID, type Action } from '@game/input';
import type { App, Screen } from '../app.ts';
import { PIXEL_RATIOS, type Settings } from '../settings.ts';
import { STANDARD_HINTS, button, choice, hints, menu, slider, toggle } from './components.ts';
import { el } from './dom.ts';

export function openOptions(app: App): void {
  const items = [
    button('Commandes', () => app.push(controlsScreen(app)), {
      id: 'options-controls',
      detail: 'Clavier et manettes',
      primary: true,
    }),
    button('Son', () => app.push(soundScreen(app)), { id: 'options-sound' }),
    button('Affichage', () => app.push(displayScreen(app)), { id: 'options-display' }),
    button('Retour', () => app.back(), { id: 'options-back' }),
  ];
  items[0]!.dataset.autofocus = '';
  const root = el(
    'section',
    { className: 'screen', attrs: { 'aria-labelledby': 'options-title' } },
    [
      el('h1', { id: 'options-title', text: 'Options' }),
      menu('Options', items),
      hints(STANDARD_HINTS),
    ],
  );
  app.push({ id: 'options', back: 'pop', root });
}

// --- Commandes -------------------------------------------------------------------------------

export const ACTION_LABELS: Readonly<Record<Action, string>> = {
  left: 'Gauche',
  right: 'Droite',
  up: 'Haut',
  down: 'Bas',
  attack: 'Attaque',
  special: 'Spécial',
  jump: 'Saut',
  shield: 'Bouclier',
  grab: 'Saisie',
  taunt: 'Provocation',
  cLeft: 'Smash ← (stick droit)',
  cRight: 'Smash → (stick droit)',
  cUp: 'Smash ↑ (stick droit)',
  cDown: 'Smash ↓ (stick droit)',
  walk: 'Marcher (demi-inclinaison)',
};

function controlsScreen(app: App): Screen {
  const { input } = app;
  const sample = new Uint32Array(4);
  let deviceId = KEYBOARD_ID;
  let capture: AbortController | null = null;
  const message = el('p', {
    className: 'muted',
    id: 'controls-message',
    attrs: { 'aria-live': 'polite' },
  });
  const list = el('div', {
    className: 'menu',
    attrs: { role: 'group', 'aria-label': 'Commandes' },
  });
  const extra = el('div', { className: 'menu' });
  const deviceRow = el('div', { className: 'menu' });

  const say = (text: string): void => {
    message.textContent = text;
  };

  async function rebind(action: Action, b: HTMLButtonElement): Promise<void> {
    capture?.abort();
    const controller = new AbortController();
    capture = controller;
    b.querySelector('.detail')!.textContent = '…';
    say(`Actionnez la commande pour « ${ACTION_LABELS[action]} » (Échap pour annuler).`);
    app.announce(`Actionnez la commande pour ${ACTION_LABELS[action]}`);
    try {
      const captured = await input.captureNext(deviceId, controller.signal);
      if (captured.type === 'key' && captured.code === 'Escape') {
        say('Remappage annulé.');
      } else {
        const error = input.setBindings(deviceId, {
          ...input.bindings(deviceId),
          [action]: [captured],
        });
        const name = input.describe(deviceId, captured);
        if (error === null) say(`« ${ACTION_LABELS[action]} » : ${name}.`);
        else if (error.reason === 'conflict') {
          const other = error.action === action ? error.other : error.action;
          say(`${name} sert déjà à « ${ACTION_LABELS[other]} » : choisissez une autre commande.`);
        } else say('Cette commande ne convient pas à ce périphérique.');
      }
    } catch {
      say('Remappage annulé.');
    }
    if (capture === controller) capture = null;
    render();
    // La liste est reconstruite : le focus revient sur la même action.
    document.getElementById(`bind-${action}`)?.focus();
  }

  function render(): void {
    const devices = input.devices().filter((d) => d.connected);
    if (!devices.some((d) => d.id === deviceId)) deviceId = KEYBOARD_ID;
    const picker = choice(
      'Périphérique',
      devices.map((d) => ({
        value: d.id,
        label: d.standard ? d.label : `${d.label} (non standard)`,
      })),
      deviceId,
      (id) => {
        deviceId = id;
        render();
        document.getElementById('controls-device')?.focus();
      },
      'controls-device',
    );
    deviceRow.replaceChildren(picker.element);
    const bindings = input.bindings(deviceId);
    list.replaceChildren(
      ...ACTIONS.map((action) => {
        const current =
          bindings[action].map((x) => input.describe(deviceId, x)).join(' ou ') || '—';
        const b = button(ACTION_LABELS[action], () => void rebind(action, b), {
          id: `bind-${action}`,
          detail: current,
        });
        b.setAttribute('aria-label', `${ACTION_LABELS[action]} : ${current}. Entrée pour changer.`);
        return b;
      }),
    );
    const analog = input.analog();
    extra.replaceChildren(
      toggle(
        'Saut en poussant le stick vers le haut (J1)',
        input.tapJump(0),
        (on) => input.setTapJump(0, on),
        'controls-tapjump',
      ).element,
      slider(
        'Zone morte du stick',
        analog.deadzone,
        (v) => input.setAnalog({ ...input.analog(), deadzone: Math.min(0.5, v) }),
        'controls-deadzone',
      ),
      button(
        'Commandes par défaut',
        () => {
          input.resetBindings(deviceId);
          say('Commandes par défaut rétablies.');
          render();
          document.getElementById('controls-reset')?.focus();
        },
        { id: 'controls-reset' },
      ),
    );
  }

  render();
  const back = button('Retour', () => app.back(), { id: 'controls-back' });
  const root = el(
    'section',
    { className: 'screen', attrs: { 'aria-labelledby': 'controls-title' } },
    [
      el('header', {}, [el('h1', { id: 'controls-title', text: 'Commandes' })]),
      deviceRow,
      message,
      list,
      extra,
      menu('Retour', [back]),
      hints(STANDARD_HINTS),
    ],
  );
  return {
    id: 'options-controls',
    back: 'pop',
    root,
    get capturesInput() {
      return capture !== null;
    },
    frame() {
      // Fait avancer la capture d'une manette et voit arriver les manettes.
      app.input.sample(sample);
    },
    onKey() {
      // Pendant une capture, chaque touche va au remappage (Échap compris : il annule).
      return capture !== null;
    },
    hidden() {
      capture?.abort();
      capture = null;
    },
  };
}

// --- Son -------------------------------------------------------------------------------------

function soundScreen(app: App): Screen {
  const update = (audio: Partial<Settings['audio']>): void =>
    app.updateSettings({ ...app.settings, audio: { ...app.settings.audio, ...audio } });
  const a = app.settings.audio;
  const enabled = toggle('Son', a.enabled, (on) => update({ enabled: on }), 'sound-enabled');
  enabled.element.dataset.autofocus = '';
  const root = el('section', { className: 'screen', attrs: { 'aria-labelledby': 'sound-title' } }, [
    el('h1', { id: 'sound-title', text: 'Son' }),
    el('div', { className: 'panel' }, [
      enabled.element,
      slider('Musique', a.music, (v) => update({ music: v }), 'sound-music'),
      slider('Effets', a.effects, (v) => update({ effects: v }), 'sound-effects'),
      toggle('Sons des menus', a.menuSounds, (on) => update({ menuSounds: on }), 'sound-menu')
        .element,
      button('Retour', () => app.back(), { id: 'sound-back' }),
    ]),
    hints(STANDARD_HINTS),
  ]);
  return { id: 'options-sound', back: 'pop', root };
}

// --- Affichage -------------------------------------------------------------------------------

function displayScreen(app: App): Screen {
  const update = (display: Partial<Settings['display']>): void =>
    app.updateSettings({ ...app.settings, display: { ...app.settings.display, ...display } });
  const d = app.settings.display;
  const fullscreen = button(
    'Plein écran',
    () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else
        void document.documentElement
          .requestFullscreen?.()
          .catch(() => app.toast('Plein écran refusé par le navigateur.'));
    },
    { id: 'display-fullscreen', detail: 'F11 aussi' },
  );
  fullscreen.dataset.autofocus = '';
  const root = el(
    'section',
    { className: 'screen', attrs: { 'aria-labelledby': 'display-title' } },
    [
      el('h1', { id: 'display-title', text: 'Affichage' }),
      el('div', { className: 'panel' }, [
        fullscreen,
        choice(
          'Résolution du rendu',
          PIXEL_RATIOS.map((r) => ({
            value: r,
            label: r === 1 ? 'Standard (plus rapide)' : r === 1.5 ? 'Élevée' : 'Maximale',
          })),
          d.pixelRatio,
          (r) => update({ pixelRatio: r }),
          'display-ratio',
        ).element,
        toggle('Grand texte', d.largeText, (on) => update({ largeText: on }), 'display-large')
          .element,
        toggle(
          'Mouvements réduits',
          d.reducedMotion,
          (on) => update({ reducedMotion: on }),
          'display-motion',
        ).element,
        toggle('Compteur d’images', d.showFps, (on) => update({ showFps: on }), 'display-fps')
          .element,
        button('Retour', () => app.back(), { id: 'display-back' }),
      ]),
      hints(STANDARD_HINTS),
    ],
  );
  return { id: 'options-display', back: 'pop', root };
}
