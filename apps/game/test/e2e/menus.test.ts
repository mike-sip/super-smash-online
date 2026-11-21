/** Écran titre et menus au clavier seul, puis à la manette (simulée), dans Edge. */
import type { Browser } from 'playwright-core';
import type { ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PAD,
  focusVisible,
  focused,
  openTab,
  screen,
  setPad,
  startGame,
  tapPad,
  unnamedControls,
  waitScreen,
} from '../helpers.ts';

let server: ViteDevServer;
let browser: Browser;
let url: string;

beforeAll(async () => {
  ({ server, browser, url } = await startGame());
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe('menus', () => {
  it('au clavier seul : titre, menu, crédits, retours, focus visible et rendu', async () => {
    const { page, errors } = await openTab(browser, url);
    expect(await screen(page)).toBe('title');
    expect(await page.title()).toBe('Fracas');
    expect(await focusVisible(page)).toBe(true);
    await page.keyboard.press('Enter');
    await waitScreen(page, 'main-menu');
    expect(await unnamedControls(page)).toEqual([]);
    expect(await focusVisible(page)).toBe(true);

    // Jusqu'au dernier élément (Crédits), quel que soit le nombre d'entrées.
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowDown');
    expect(await focused(page)).toBe('menu-credits');
    await page.keyboard.press('Enter');
    await waitScreen(page, 'credits');
    expect(await focusVisible(page)).toBe(true);
    await page.keyboard.press('Escape');
    await waitScreen(page, 'main-menu');
    // Le focus revient où il était.
    expect(await focused(page)).toBe('menu-credits');
    await page.keyboard.press('Escape');
    await waitScreen(page, 'title');
    expect(errors).toEqual([]);
  });

  it('à la manette : A entre, la croix déplace, A valide, B revient', async () => {
    const { page, errors } = await openTab(browser, url);
    await setPad(page, 0, []);
    await page.waitForTimeout(100);
    await tapPad(page, 0, PAD.A);
    await waitScreen(page, 'main-menu');
    for (let i = 0; i < 10; i++) await tapPad(page, 0, PAD.DOWN);
    expect(await focused(page)).toBe('menu-credits');
    await tapPad(page, 0, PAD.A);
    await waitScreen(page, 'credits');
    await tapPad(page, 0, PAD.B);
    await waitScreen(page, 'main-menu');
    expect(errors).toEqual([]);
  });

  it('un bouton tenu à l’arrivée de la manette ne déclenche rien', async () => {
    const { page } = await openTab(browser, url);
    await setPad(page, 0, [PAD.A]);
    await page.waitForTimeout(200);
    expect(await screen(page)).toBe('title');
  });
});
