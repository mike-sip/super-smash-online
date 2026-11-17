/**
 * Parcours complet d'un joueur (SPEC-app-shell.md, objectif et critère n° 10), sur le build de
 * production servi par les vrais processus serveur derrière la passerelle locale, au clavier
 * seul (et une manette simulée pour le second joueur local) :
 *
 * titre → combat local à deux → résultats → menu ; puis deux onglets inscrits en partie rapide
 * classée → match jusqu'au bout → mêmes résultats → profil avec cote et historique à jour →
 * classement ; serveur de jeu arrêté puis relancé : message visible, puis retour à la normale.
 *
 * Le build utilisé est celui des tests (`dist-e2e`, identique au build public plus la prise de
 * test) ; le build public est vérifié par `build.test.ts`.
 */
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startProduction, type Production } from '../../scripts/serve-prod.ts';
import { PAD, focused, hook, openTab, setPad, tapPad, waitScreen } from '../helpers.ts';
import { focusOn, goOnline, playToEnd } from './online-helpers.ts';

let prod: Production;
let browser: Browser;

const SHORT_RULES = {
  mode: 'time',
  stocks: 3,
  timeLimit: 30,
  stamina: 150,
  teams: false,
  teamAttack: false,
  ultimate: true,
  items: { enabled: false, frequency: 'normal' },
};
const PASSWORD = 'Un-Mot-De-Passe-Solide-2026';

beforeAll(async () => {
  prod = await startProduction({
    client: fileURLToPath(new URL('../../dist-e2e/', import.meta.url)),
    quickRules: SHORT_RULES,
    quickWaitMs: 500,
  });
  browser = await chromium.launch({ channel: 'msedge' });
});

afterAll(async () => {
  await browser?.close();
  await prod?.stop();
});

async function register(page: Page, pseudo: string): Promise<void> {
  await focusOn(page, 'online-login', 'ArrowUp');
  await focusOn(page, 'online-convert', 'ArrowLeft');
  await page.keyboard.press('Enter');
  await waitScreen(page, 'online-auth');
  await page.keyboard.press('Control+A');
  await page.keyboard.type(pseudo);
  await page.keyboard.press('Tab');
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Enter');
  await waitScreen(page, 'online-home');
  await page.waitForFunction(
    (p) => document.getElementById('online-who')?.textContent === p,
    pseudo,
  );
}

describe('parcours complet sur le build de production', () => {
  it('en-têtes de sécurité et routes bloquées', async () => {
    const page = await fetch(prod.url);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    expect(
      (await fetch(new URL('/api/ranking/v1/matches', prod.url), { method: 'POST' })).status,
    ).toBe(404);
    expect((await fetch(new URL('/health', prod.url))).status).toBe(404);
    expect((await fetch(new URL('/api/ranking/v1/leaderboard', prod.url))).status).toBe(200);
  });

  it('local, puis en ligne à deux onglets jusqu’au classement, puis serveur de jeu relancé', async () => {
    const a = await openTab(browser, prod.url);

    // --- Combat local à deux : clavier (J1) et manette (J2). ---
    await a.page.keyboard.press('Enter');
    await waitScreen(a.page, 'main-menu');
    await focusOn(a.page, 'menu-local');
    await a.page.keyboard.press('Enter');
    await waitScreen(a.page, 'local-setup');
    await setPad(a.page, 0, []);
    await a.page.waitForTimeout(100);
    await tapPad(a.page, 0, PAD.A);
    await tapPad(a.page, 0, PAD.A);
    await a.page.keyboard.press('Enter');
    await a.page.waitForFunction(
      () => !(document.getElementById('local-continue') as HTMLButtonElement).disabled,
    );
    await a.page.keyboard.press('Enter');
    await waitScreen(a.page, 'local-stage');
    await a.page.keyboard.press('Enter');
    await waitScreen(a.page, 'local-rules');
    await focusOn(a.page, 'rules-fight');
    await a.page.keyboard.press('Enter');
    await waitScreen(a.page, 'match-local');
    for (let i = 0; i < 3; i++) {
      await hook(a.page, 'knockOut', 1);
      await hook(a.page, 'fastForward', 200);
    }
    await waitScreen(a.page, 'results');
    await focusOn(a.page, 'results-menu');
    await a.page.keyboard.press('Enter');
    await waitScreen(a.page, 'main-menu');

    // --- En ligne : deux comptes, partie rapide classée. ---
    const b = await openTab(browser, prod.url);
    await focusOn(a.page, 'menu-online', 'ArrowUp');
    await a.page.keyboard.press('Enter');
    await waitScreen(a.page, 'online-home', 15_000);
    await goOnline(b.page);
    await register(a.page, 'Aurore');
    await register(b.page, 'Basile');
    for (const t of [a, b]) {
      await focusOn(t.page, 'online-quick');
      await t.page.keyboard.press('Enter');
      await waitScreen(t.page, 'online-queue');
      await t.page.keyboard.press('Enter');
    }
    for (const t of [a, b]) await waitScreen(t.page, 'match-online', 30_000);
    await playToEnd([a, b]);
    expect(await hook(b.page, 'lastResult')).toEqual(await hook(a.page, 'lastResult'));

    for (const t of [a, b]) {
      await focusOn(t.page, 'results-profile');
      await t.page.keyboard.press('Enter');
      await waitScreen(t.page, 'profile');
      // Le classement reçoit le rapport du serveur de jeu en HTTP : on recharge jusqu'à le voir.
      await t.page
        .waitForFunction(
          () =>
            document
              .querySelector('#profile-history td:nth-child(5)')
              ?.textContent?.includes('→') ?? false,
          null,
          { timeout: 15_000 },
        )
        .catch(async () => {
          await t.page.keyboard.press('Escape');
          await t.page.keyboard.press('Enter');
          await t.page.waitForSelector('#profile-history td:nth-child(5)');
        });
    }
    const ratings = await Promise.all(
      [a, b].map((t) =>
        t.page.$eval('[data-rating]', (e) => Number((e as HTMLElement).dataset.rating)),
      ),
    );
    expect(ratings.sort((x, y) => x - y)).toEqual([984, 1016]);
    await focusOn(a.page, 'profile-leaderboard', 'ArrowUp');
    await a.page.keyboard.press('Enter');
    await waitScreen(a.page, 'leaderboard');
    await a.page.waitForSelector('#lb-table');

    // --- Serveur de jeu arrêté puis relancé : message, puis reconnexion seule. ---
    await a.page.keyboard.press('Escape');
    await waitScreen(a.page, 'profile');
    await prod.stopGame();
    await a.page.waitForFunction(
      () => /Reconnexion|injoignable/.test(document.getElementById('banner')?.textContent ?? ''),
      null,
      { timeout: 15_000 },
    );
    expect(await a.page.isVisible('#banner')).toBe(true);
    await prod.startGame();
    await a.page.waitForFunction(() => document.getElementById('banner')!.hidden, null, {
      timeout: 30_000,
    });
    expect((await hook<{ status: string }>(a.page, 'lobby')).status).toBe('online');

    expect(await focused(a.page)).not.toBe('');
    // Les seules erreurs de console tolérées : les WebSocket coupées pendant l'arrêt du serveur.
    const unexpected = (errs: string[]) =>
      errs.filter((e) => !/WebSocket|ERR_CONNECTION_REFUSED|502/.test(e));
    expect(unexpected(a.errors)).toEqual([]);
    expect(unexpected(b.errors)).toEqual([]);
  });
});
