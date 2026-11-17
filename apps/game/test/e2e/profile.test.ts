/**
 * Profil et classement dans Edge : deux invités créent leur compte, jouent une partie rapide
 * classée jusqu'au bout, puis voient leur cote, leur historique et le classement à jour.
 * Erreurs de connexion visibles ; suppression de compte.
 */
import type { Browser, Page } from 'playwright-core';
import type { ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { focused, hook, openTab, startGame, waitScreen } from '../helpers.ts';
import { focusOn, goOnline, playToEnd } from './online-helpers.ts';

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

const PASSWORD = 'Un-Mot-De-Passe-Solide-2026';

/** Depuis l'accueil en ligne : invité converti en compte. */
async function convert(page: Page, pseudo: string): Promise<void> {
  await focusOn(page, 'online-login', 'ArrowUp');
  await focusOn(page, 'online-convert', 'ArrowLeft');
  await page.keyboard.press('Enter');
  await waitScreen(page, 'online-auth');
  expect(await focused(page)).toBe('auth-pseudo');
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

describe('profil et classement', () => {
  it('partie rapide entre deux comptes : résultats, cote et historique à jour, classement', async () => {
    const a = await openTab(browser, url);
    const b = await openTab(browser, url);
    await goOnline(a.page);
    await goOnline(b.page);
    await convert(a.page, 'Albane');
    await convert(b.page, 'Bastien');

    for (const t of [a, b]) {
      await focusOn(t.page, 'online-quick');
      await t.page.keyboard.press('Enter');
      await waitScreen(t.page, 'online-queue');
      expect(await focused(t.page)).toBe('queue-go');
      await t.page.keyboard.press('Enter');
    }
    for (const t of [a, b]) await waitScreen(t.page, 'match-online', 30_000);
    await playToEnd([a, b]);

    for (const t of [a, b]) {
      await focusOn(t.page, 'results-profile');
      await t.page.keyboard.press('Enter');
      await waitScreen(t.page, 'profile');
      await t.page.waitForSelector('#profile-history tbody tr td:nth-child(5)');
    }
    const ratings = await Promise.all(
      [a, b].map((t) =>
        t.page.$eval('[data-rating]', (e) => Number((e as HTMLElement).dataset.rating)),
      ),
    );
    expect(ratings.sort((x, y) => x - y)).toEqual([984, 1016]);
    const history = await a.page.textContent('#profile-history');
    expect(history).toMatch(/classé/);
    expect(history).toMatch(/[+-]16 →/);

    // Classement (personne n'a encore 5 matchs classés : tableau vide, message clair).
    await focusOn(a.page, 'profile-leaderboard', 'ArrowUp');
    await a.page.keyboard.press('Enter');
    await waitScreen(a.page, 'leaderboard');
    await a.page.waitForSelector('#lb-table');
    expect(await a.page.textContent('#lb-table')).toMatch(/5 parties rapides/);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  });

  it('mauvais mot de passe affiché ; suppression de compte confirmée', async () => {
    const t = await openTab(browser, url);
    await goOnline(t.page);
    await convert(t.page, 'Capucine');
    // Déconnexion puis connexion avec un mauvais mot de passe.
    await t.page.keyboard.press('Escape');
    await waitScreen(t.page, 'main-menu');
    await focusOn(t.page, 'menu-profile');
    await t.page.keyboard.press('Enter');
    await waitScreen(t.page, 'profile');
    await t.page.waitForSelector('#profile-account');
    await focusOn(t.page, 'profile-account');
    await t.page.keyboard.press('Enter');
    await waitScreen(t.page, 'account');
    await focusOn(t.page, 'account-logout');
    await t.page.keyboard.press('Enter');
    await t.page.keyboard.press('Enter'); // confirmer
    await waitScreen(t.page, 'main-menu');

    await focusOn(t.page, 'menu-profile');
    await t.page.keyboard.press('Enter');
    await t.page.waitForSelector('#profile-login');
    await focusOn(t.page, 'profile-login');
    await t.page.keyboard.press('Enter');
    await waitScreen(t.page, 'online-auth');
    await t.page.keyboard.type('Capucine');
    await t.page.keyboard.press('Tab');
    await t.page.keyboard.type('pas-le-bon-mot-de-passe');
    await t.page.keyboard.press('Enter');
    await t.page.waitForFunction(() => document.getElementById('auth-message')!.textContent !== '');
    expect(await t.page.textContent('#auth-message')).toMatch(/incorrect/);

    // Bon mot de passe, puis suppression.
    await t.page.fill('#auth-password', PASSWORD);
    await t.page.keyboard.press('Enter');
    await waitScreen(t.page, 'profile');
    await t.page.waitForSelector('#profile-account');
    await focusOn(t.page, 'profile-account');
    await t.page.keyboard.press('Enter');
    await waitScreen(t.page, 'account');
    await t.page.fill('#account-delete-password', PASSWORD);
    await focusOn(t.page, 'account-delete');
    await t.page.keyboard.press('Enter');
    await t.page.keyboard.press('Enter'); // confirmer
    await waitScreen(t.page, 'main-menu');
    expect(await t.page.textContent('#toast')).toMatch(/supprimé/);
    expect(await hook(t.page, 'screen')).toBe('main-menu');
  });
});
