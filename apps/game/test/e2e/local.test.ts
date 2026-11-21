/** Combat local et entraînement dans Edge : clavier et fausse manette. */
import type { Browser, Page } from 'playwright-core';
import type { ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PAD, focused, hook, openTab, setPad, startGame, tapPad, waitScreen } from '../helpers.ts';

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

interface MatchInfo {
  frame: number;
  phase: string;
  paused: boolean;
  players: number;
  fighters: string[];
  stocks: number[];
}

const match = (page: Page) => hook<MatchInfo>(page, 'match');

/** Appuie sur ↓ jusqu'à poser le focus sur `id`. */
async function focusDown(page: Page, id: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if ((await focused(page)) === id) return;
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`focus jamais posé sur ${id} (sur ${await focused(page)})`);
}

async function toMainMenu(page: Page): Promise<void> {
  await page.keyboard.press('Enter');
  await waitScreen(page, 'main-menu');
}

describe('combat local', () => {
  it('entraînement : lancement, simulation, pause, remise à zéro, retour', async () => {
    const { page, errors } = await openTab(browser, url);
    await toMainMenu(page);
    await focusDown(page, 'menu-training');
    await page.keyboard.press('Enter');
    await waitScreen(page, 'training-setup');
    await focusDown(page, 'training-count');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await focusDown(page, 'training-start');
    await page.keyboard.press('Enter');
    await waitScreen(page, 'training');
    await page.waitForFunction(
      () =>
        (window as never as { __game: { match(): { frame: number } } }).__game.match().frame > 60,
    );
    const info = await match(page);
    expect(info.players).toBe(4);
    const [before, after] = await hook<[number, number]>(page, 'checksumAroundDraw');
    expect(after).toBe(before);

    await page.keyboard.press('Escape');
    expect((await match(page)).paused).toBe(true);
    const frozen = (await match(page)).frame;
    await page.waitForTimeout(300);
    expect((await match(page)).frame).toBe(frozen);
    expect(await focused(page)).toBe('pause-resume');
    await page.keyboard.press('Escape');
    expect((await match(page)).paused).toBe(false);

    await page.keyboard.press('Escape');
    await focusDown(page, 'pause-quit');
    await page.keyboard.press('Enter');
    await waitScreen(page, 'training-setup');
    expect(errors).toEqual([]);
  });

  it('à deux (clavier et manette) : sélection, stage, règles, combat, résultats, revanche', async () => {
    const { page, errors } = await openTab(browser, url);
    await toMainMenu(page);
    await focusDown(page, 'menu-local');
    await page.keyboard.press('Enter');
    await waitScreen(page, 'local-setup');

    // La manette rejoint en appuyant sur un bouton, puis change de personnage et se déclare prête.
    await setPad(page, 0, []);
    await page.waitForTimeout(100);
    await tapPad(page, 0, PAD.A);
    await page.waitForFunction(
      () =>
        document.getElementById('ready-1') instanceof HTMLButtonElement &&
        !(document.getElementById('ready-1') as HTMLButtonElement).disabled,
    );
    await tapPad(page, 0, PAD.RIGHT);
    await tapPad(page, 0, PAD.A);
    // Le clavier (J1) change de personnage et se déclare prêt.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => !(document.getElementById('local-continue') as HTMLButtonElement).disabled,
    );
    await page.keyboard.press('Enter');
    await waitScreen(page, 'local-stage');
    await page.keyboard.press('Enter');
    await waitScreen(page, 'local-rules');
    await focusDown(page, 'rules-fight');
    await page.keyboard.press('Enter');
    await waitScreen(page, 'match-local');

    const info = await match(page);
    expect(info.players).toBe(2);
    expect(info.fighters[0]).not.toBe('');
    // Fin du match : J2 perd ses trois vies.
    for (let i = 0; i < 3; i++) {
      await hook(page, 'knockOut', 1);
      await hook(page, 'fastForward', 200);
    }
    await waitScreen(page, 'results');
    expect(await page.textContent('#results-title')).toMatch(/Victoire de J1/);
    expect(await focused(page)).toBe('results-rematch');
    await page.keyboard.press('Enter');
    await waitScreen(page, 'match-local');
    await page.keyboard.press('Escape');
    await focusDown(page, 'pause-quit');
    await page.keyboard.press('Enter');
    await waitScreen(page, 'local-setup');
    expect(errors).toEqual([]);
  });

  it('règles refusées : message affiché, bouton désactivé', async () => {
    const { page } = await openTab(browser, url);
    await toMainMenu(page);
    await focusDown(page, 'menu-local');
    await page.keyboard.press('Enter');
    await setPad(page, 0, []);
    await page.waitForTimeout(100);
    await tapPad(page, 0, PAD.A);
    await tapPad(page, 0, PAD.A);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await waitScreen(page, 'local-stage');
    await page.keyboard.press('Enter');
    await waitScreen(page, 'local-rules');
    // Équipes, avec les deux joueurs dans la même équipe.
    await focusDown(page, 'rules-teams');
    await page.keyboard.press('ArrowRight');
    await focusDown(page, 'rules-team-1');
    await page.keyboard.press('ArrowLeft');
    expect(await page.textContent('#rules-errors')).toMatch(/équipe/i);
    expect(await page.isDisabled('#rules-fight')).toBe(true);
  });
});
