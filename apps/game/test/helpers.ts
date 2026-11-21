/**
 * Outils des tests du jeu dans Edge : serveur de développement (qui héberge comptes, classement,
 * lobby et relais), un contexte de navigation par joueur, une fausse manette, et la prise de test.
 */
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';

export interface Tab {
  readonly page: Page;
  readonly errors: string[];
}

/** Ce que la page de test peut lire et faire par `window.__game`. */
export type Hook = Record<string, (...args: never[]) => unknown>;

export async function startGame(): Promise<{
  server: ViteDevServer;
  browser: Browser;
  url: string;
}> {
  process.env.VITE_TEST_HOOK = '1';
  process.env.GAME_QUICK = 'short';
  const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'silent',
    server: { port: 0, host: '127.0.0.1' },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('Le serveur du jeu ne donne pas son port.');
  }
  const browser = await chromium.launch({ channel: 'msedge' });
  return { server, browser, url: `http://127.0.0.1:${address.port}/` };
}

/**
 * Fausses manettes : `navigator.getGamepads()` renvoie `window.__pads`, que le test remplit par
 * `setPad`. Disposition standard, 17 boutons, 4 axes.
 */
const FAKE_PADS = `
  window.__pads = [];
  Object.defineProperty(navigator, 'getGamepads', { value: () => window.__pads, configurable: true });
`;

export async function openTab(
  browser: Browser,
  url: string,
  viewport = { width: 1100, height: 700 },
): Promise<Tab> {
  // En intégration continue, sans carte graphique, le rendu 3D est fait par le processeur : un
  // écran de densité 0,5 fait rendre le canevas à mi-résolution (4 fois moins de pixels), sans rien
  // changer à la mise en page.
  const context = await browser.newContext(
    process.env.CI === undefined ? { viewport } : { viewport, deviceScaleFactor: 0.5 },
  );
  await context.addInitScript(FAKE_PADS);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(url);
  await page.waitForFunction(
    () => 'screen' in ((window as unknown as { __game?: object }).__game ?? {}),
  );
  return { page, errors };
}

export async function screen(page: Page): Promise<string> {
  return page.evaluate(() =>
    (window as unknown as { __game: { screen(): string } }).__game.screen(),
  );
}

export async function waitScreen(page: Page, id: string, timeout = 10_000): Promise<void> {
  await page.waitForFunction(
    (want) => (window as unknown as { __game: { screen(): string } }).__game.screen() === want,
    id,
    { timeout },
  );
}

/** Appelle une fonction de la prise de test. */
export async function hook<T = unknown>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([n, a]) => {
      const g = (window as unknown as { __game: Record<string, (...x: unknown[]) => unknown> })
        .__game;
      return g[n as string]!(...(a as unknown[])) as never;
    },
    [name, args] as const,
  );
}

/** Pose l'état de la fausse manette `index` : boutons enfoncés et axes. */
export async function setPad(
  page: Page,
  index: number,
  pressed: readonly number[] = [],
  axes: readonly number[] = [0, 0, 0, 0],
): Promise<void> {
  await page.evaluate(
    ([i, p, a]) => {
      const w = window as unknown as { __pads: (object | null)[] };
      const buttons = Array.from({ length: 17 }, (_, b) => ({
        pressed: (p as number[]).includes(b),
        touched: false,
        value: (p as number[]).includes(b) ? 1 : 0,
      }));
      w.__pads[i as number] = {
        id: 'Manette de test (STANDARD GAMEPAD)',
        index: i,
        connected: true,
        mapping: 'standard',
        timestamp: performance.now(),
        buttons,
        axes: a,
        vibrationActuator: null,
      };
    },
    [index, pressed, axes] as const,
  );
}

/** Appuie puis relâche un bouton de la fausse manette (deux images au moins de chaque côté). */
export async function tapPad(page: Page, index: number, button: number): Promise<void> {
  await setPad(page, index, [button]);
  await page.waitForTimeout(80);
  await setPad(page, index, []);
  await page.waitForTimeout(80);
}

export const PAD = { A: 0, B: 1, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

/** Identifiant (ou texte) de l'élément qui a le focus. */
export async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return a?.id || a?.textContent?.trim() || '';
  });
}

/** Problèmes d'accessibilité simples de l'écran affiché : éléments interactifs sans nom. */
export async function unnamedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const e of document.querySelectorAll<HTMLElement>('#ui button, #ui input, #ui select')) {
      const name =
        e.getAttribute('aria-label') ??
        (e.id ? document.querySelector(`label[for="${e.id}"]`)?.textContent : null) ??
        e.closest('label')?.textContent ??
        e.textContent;
      if (name === null || name === undefined || name.trim() === '')
        out.push(e.outerHTML.slice(0, 80));
    }
    return out;
  });
}

/** Le focus est-il marqué (contour visible) ? */
export async function focusVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const a = document.activeElement;
    if (!(a instanceof HTMLElement) || a === document.body) return false;
    const style = getComputedStyle(a);
    return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 2;
  });
}
