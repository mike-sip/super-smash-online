/** Point d'entrée de Fracas : assemble l'application et ses écrans. */
import './style.css';
import { App, type AppElements } from './app.ts';
import { createBackground } from './background.ts';
import { GAME_NAME } from './strings.ts';
import { openLocal, openTraining } from './ui/local.ts';
import { openOptions } from './ui/options.ts';
import { openOnline } from './ui/online.ts';
import { openProfile } from './ui/profile.ts';
import { Online, shouldResumeOnline } from './online.ts';
import { errorScreen, mainMenu, titleScreen, type MainMenuEntry } from './ui/screens-basic.ts';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Élément #${id} introuvable.`);
  return found as T;
}

document.title = GAME_NAME;

const elements: AppElements = {
  canvas: element<HTMLCanvasElement>('game'),
  overlay: element('overlay'),
  ui: element('ui'),
  banner: element('banner'),
  toast: element('toast'),
  announce: element('announce'),
  fps: element('fps'),
};

let online: Online | null = null;
function getOnline(a: App): Online {
  if (online === null) {
    online = new Online(a);
    const o = online;
    o.openProfile = () => openProfile(a, o);
  }
  return online;
}
/** Lien d'invitation `#rejoindre=CODE` : le code est lu puis retiré de l'adresse. */
const invite = /^#rejoindre=([A-Za-z0-9-]{6,9})$/.exec(location.hash)?.[1];
if (invite !== undefined) history.replaceState(null, '', location.pathname + location.search);

const entries: MainMenuEntry[] = [
  {
    id: 'online',
    label: 'En ligne',
    detail: 'Salons privés et partie rapide',
    open: (a) => openOnline(a, getOnline(a)),
  },
  {
    id: 'profile',
    label: 'Profil et classement',
    detail: 'Cote, historique, compte',
    open: (a) => openProfile(a, getOnline(a)),
  },
  { id: 'local', label: 'Combat local', detail: '2 à 4 joueurs', open: openLocal },
  {
    id: 'training',
    label: 'Entraînement',
    detail: 'Seul, contre des mannequins',
    open: openTraining,
  },
  { id: 'options', label: 'Options', detail: 'Commandes, son, affichage', open: openOptions },
];

const app = new App(elements, (a) =>
  titleScreen(
    a,
    entries,
    invite === undefined ? undefined : () => openOnline(a, getOnline(a), invite),
  ),
);
// Page rechargée dans un salon ou en pleine partie : retour direct en ligne, le lobby renvoie la partie.
if (invite === undefined && shouldResumeOnline()) {
  app.replace(mainMenu(app, entries));
  openOnline(app, getOnline(app));
}
/** Écrans qui ont leur propre rendu sur le canvas. */
const MATCH_SCREENS = new Set(['match-local', 'training', 'match-online']);
const background = createBackground(app, () => MATCH_SCREENS.has(app.top().id));
app.releaseCanvas = () => background.release();
app.onFatal = () => app.reset(errorScreen());
window.addEventListener('error', (event) => app.fail(event.error));
window.addEventListener('unhandledrejection', (event) => app.fail(event.reason));

// Prise pour les tests automatiques, absente du build public (variable de build réservée aux tests).
if (import.meta.env.VITE_TEST_HOOK === '1') {
  const hook = {
    screen: () => app.top().id,
    screens: () => app.ids(),
    settings: () => app.settings,
    ...app.test,
  };
  Object.defineProperty(window, '__game', {
    value: new Proxy(hook, {
      get: (t, k: string) => (k in t ? t[k as keyof typeof t] : app.test[k]),
    }),
  });
}
