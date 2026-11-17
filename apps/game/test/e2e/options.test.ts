/** Options dans Edge : remappage persistant et utilisé en jeu, son, affichage, stockage corrompu. */
import type { Browser, Page } from 'playwright-core';
import type { ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { focused, hook, openTab, startGame, waitScreen } from '../helpers.ts';

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

async function focusDown(page: Page, id: string): Promise<void> {
  for (let i = 0; i < 25; i++) {
    if ((await focused(page)) === id) return;
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`focus jamais posé sur ${id} (sur ${await focused(page)})`);
}

async function openOptions(page: Page): Promise<void> {
  await page.keyboard.press('Enter');
  await waitScreen(page, 'main-menu');
  await focusDown(page, 'menu-options');
  await page.keyboard.press('Enter');
  await waitScreen(page, 'options');
}

/** Bit « attaque » de l'InputFrame (boutons dans les 16 bits hauts). */
const ATTACK = 1 << 16;

describe('options', () => {
  it('une touche remappée sert en jeu et survit au rechargement', async () => {
    const { page, errors } = await openTab(browser, url);
    await openOptions(page);
    await page.keyboard.press('Enter');
    await waitScreen(page, 'options-controls');
    await focusDown(page, 'bind-attack');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      document.getElementById('controls-message')!.textContent!.includes('Actionnez'),
    );
    // Pendant la capture, la touche va au remappage, pas à la navigation.
    await page.keyboard.press('KeyP');
    await page.waitForFunction(() =>
      document.getElementById('controls-message')!.textContent!.includes('Attaque'),
    );
    expect(await page.getAttribute('#bind-attack', 'aria-label')).toMatch(/P/);
    expect(await focused(page)).toBe('bind-attack');

    await page.reload();
    await page.waitForFunction(
      () => 'screen' in ((window as never as { __game?: object }).__game ?? {}),
    );
    await page.keyboard.down('KeyP');
    const frame = await hook<number>(page, 'sample');
    await page.keyboard.up('KeyP');
    expect(frame & ATTACK).toBe(ATTACK);

    // Échap pendant une capture annule, sans quitter l'écran.
    await page.reload();
    await page.waitForFunction(
      () => 'screen' in ((window as never as { __game?: object }).__game ?? {}),
    );
    await openOptions(page);
    await page.keyboard.press('Enter');
    await waitScreen(page, 'options-controls');
    await focusDown(page, 'bind-jump');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      document.getElementById('controls-message')!.textContent!.includes('Actionnez'),
    );
    await page.keyboard.press('Escape');
    await page.waitForFunction(() =>
      document.getElementById('controls-message')!.textContent!.includes('annulé'),
    );
    expect(await hook(page, 'screen')).toBe('options-controls');
    // Retour aux commandes par défaut.
    await focusDown(page, 'controls-reset');
    await page.keyboard.press('Enter');
    expect(await page.getAttribute('#bind-attack', 'aria-label')).not.toMatch(/: P\./);
    expect(errors).toEqual([]);
  });

  it('son coupé et affichage gardés après rechargement ; grand texte sans débordement', async () => {
    const { page, errors } = await openTab(browser, url);
    await openOptions(page);
    await focusDown(page, 'options-sound');
    await page.keyboard.press('Enter');
    await waitScreen(page, 'options-sound');
    expect(await focused(page)).toBe('sound-enabled');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    await focusDown(page, 'options-display');
    await page.keyboard.press('Enter');
    await waitScreen(page, 'options-display');
    await focusDown(page, 'display-large');
    await page.keyboard.press('ArrowRight');
    await focusDown(page, 'display-fps');
    await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => document.documentElement.dataset.text)).toBe('large');

    await page.reload();
    await page.waitForFunction(
      () => 'screen' in ((window as never as { __game?: object }).__game ?? {}),
    );
    const settings = await hook<{
      audio: { enabled: boolean };
      display: { largeText: boolean; showFps: boolean };
    }>(page, 'settings');
    expect(settings.audio.enabled).toBe(false);
    expect(settings.display).toMatchObject({ largeText: true, showFps: true });
    expect(await page.isVisible('#fps')).toBe(true);
    await page.keyboard.press('Enter');
    await waitScreen(page, 'main-menu');
    const overflow = await page.evaluate(() => {
      const s = document.querySelector('#ui .screen') as HTMLElement;
      return s.scrollWidth - s.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  it('un stockage corrompu est ignoré', async () => {
    const { page, errors } = await openTab(browser, url);
    await page.evaluate(() => {
      localStorage.setItem('fracas.settings', '{');
      localStorage.setItem('fracas.local', '[[[');
    });
    await page.reload();
    await page.waitForFunction(
      () => 'screen' in ((window as never as { __game?: object }).__game ?? {}),
    );
    expect(await hook(page, 'screen')).toBe('title');
    const settings = await hook<{ audio: { enabled: boolean } }>(page, 'settings');
    expect(settings.audio.enabled).toBe(true);
    expect(errors).toEqual([]);
  });
});
