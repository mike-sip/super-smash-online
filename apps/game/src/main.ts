/** Point d'entrée de Fracas : assemble l'application et ses écrans. */
import './style.css';
import { App, type AppElements } from './app.ts';
import { GAME_NAME } from './strings.ts';
import { errorScreen, titleScreen, type MainMenuEntry } from './ui/screens-basic.ts';

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

const entries: MainMenuEntry[] = [];

const app = new App(elements, (a) => titleScreen(a, entries));
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
