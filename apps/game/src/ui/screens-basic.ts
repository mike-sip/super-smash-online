/** Écran titre, menu principal, crédits et écran d'erreur imprévue. */
import type { App, Screen } from '../app.ts';
import { UNEXPECTED } from '../errors.ts';
import { GAME_NAME, PRESS_TO_START, TAGLINE } from '../strings.ts';
import { STANDARD_HINTS, button, hints, menu } from './components.ts';
import { el } from './dom.ts';

/** Entrées du menu principal, ajoutées par les autres écrans (combat local, en ligne…). */
export interface MainMenuEntry {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly open: (app: App) => void;
}

export function titleScreen(
  app: App,
  entries: readonly MainMenuEntry[],
  afterStart?: () => void,
): Screen {
  const start = el('button', {
    className: 'btn primary press',
    id: 'press-start',
    text: PRESS_TO_START,
    attrs: { type: 'button', 'data-autofocus': '' },
  });
  const go = (): void => {
    app.audio.unlock();
    app.audio.playMusic('arena');
    app.replace(mainMenu(app, entries));
    afterStart?.();
  };
  start.addEventListener('click', go);
  const root = el(
    'section',
    { className: 'screen center', attrs: { 'aria-labelledby': 'title-logo' } },
    [
      el('h1', { className: 'logo', id: 'title-logo', text: GAME_NAME }),
      el('p', { className: 'tagline', text: TAGLINE }),
      start,
    ],
  );
  return {
    id: 'title',
    back: 'pop',
    root,
    // N'importe quelle touche ou n'importe quel bouton : on entre.
    onKey: (event) => {
      if (event.repeat || event.key === 'Tab' || event.key === 'Escape') return false;
      if (event.key.startsWith('Arrow')) return false;
      go();
      return true;
    },
    onPad: (action) => {
      if (action.type === 'move') return false;
      go();
      return true;
    },
  };
}

export function mainMenu(app: App, entries: readonly MainMenuEntry[]): Screen {
  const items = [
    ...entries.map((e, i) => {
      const b = button(e.label, () => e.open(app), {
        id: `menu-${e.id}`,
        detail: e.detail,
        primary: i === 0,
      });
      if (i === 0) b.dataset.autofocus = '';
      return b;
    }),
    button('Crédits', () => app.push(creditsScreen(app)), { id: 'menu-credits' }),
  ];
  const root = el('section', { className: 'screen', attrs: { 'aria-labelledby': 'main-title' } }, [
    el('header', {}, [el('h1', { className: 'logo small', id: 'main-title', text: GAME_NAME })]),
    menu('Menu principal', items),
    hints(STANDARD_HINTS),
  ]);
  return {
    id: 'main-menu',
    back: 'pop',
    root,
    onBack: () => app.reset(titleScreen(app, entries)),
  };
}

export function creditsScreen(app: App): Screen {
  const root = el(
    'section',
    { className: 'screen', attrs: { 'aria-labelledby': 'credits-title' } },
    [
      el('h1', { id: 'credits-title', text: 'Crédits' }),
      el('div', { className: 'panel' }, [
        el('p', {
          text: `${GAME_NAME} est un jeu de combat de plateforme original, jouable dans le navigateur.`,
        }),
        el('p', {
          text: 'Personnages, décors, sons et musiques sont générés par le code du jeu : aucun élément n’est repris d’un autre jeu.',
        }),
        el('p', {
          className: 'muted',
          text: 'Rendu 3D : Three.js. Développé avec TypeScript et Vite.',
        }),
      ]),
      menu('Crédits', [button('Retour', () => app.back(), { id: 'credits-back', primary: true })]),
      hints(STANDARD_HINTS),
    ],
  );
  return { id: 'credits', back: 'pop', root };
}

/** Écran d'erreur imprévue : message simple, « Recharger ». */
export function errorScreen(): Screen {
  const reload = button('Recharger', () => location.reload(), {
    primary: true,
    id: 'error-reload',
  });
  reload.dataset.autofocus = '';
  const root = el('section', { className: 'screen center', attrs: { role: 'alert' } }, [
    el('h1', { text: 'Oups' }),
    el('p', { text: UNEXPECTED.message }),
    reload,
  ]);
  return { id: 'error', back: 'block', root };
}
