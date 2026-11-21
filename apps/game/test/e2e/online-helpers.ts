/** Étapes communes des tests en ligne dans Edge. */
import type { Page } from 'playwright-core';
import { focused, hook, waitScreen, type Tab } from '../helpers.ts';

export async function focusOn(page: Page, id: string, key = 'ArrowDown'): Promise<void> {
  for (let i = 0; i < 30; i++) {
    if ((await focused(page)) === id) return;
    await page.keyboard.press(key);
  }
  throw new Error(`focus jamais posé sur ${id} (sur ${await focused(page)})`);
}

/**
 * Pose le focus sur « Créer un compte » du bandeau invité, depuis le menu en ligne : ↑ jusqu'au
 * bandeau (on y arrive sur l'un ou l'autre bouton selon la mise en page), puis ←.
 */
export async function focusConvert(page: Page): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const id = await focused(page);
    if (id === 'online-convert') return;
    await page.keyboard.press(id === 'online-login' ? 'ArrowLeft' : 'ArrowUp');
  }
  throw new Error(`focus jamais posé sur online-convert (sur ${await focused(page)})`);
}

export interface LobbySnapshot {
  status: string;
  room: {
    code: string | null;
    phase: string;
    rules: { mode: string; timeLimit: number };
    members: { ready: boolean }[];
  } | null;
  match: { gameId: string } | null;
}

export const lobby = (page: Page) => hook<LobbySnapshot>(page, 'lobby');

export interface OnlineSnapshot {
  status: string;
  slot: number;
  gameId: string;
  frame: number;
  result: { winners: number[] } | null;
}

/** Au clavier : titre → menu → En ligne. */
export async function goOnline(page: Page): Promise<void> {
  await page.keyboard.press('Enter');
  await waitScreen(page, 'main-menu');
  await focusOn(page, 'menu-online', 'ArrowUp');
  await page.keyboard.press('Enter');
  await waitScreen(page, 'online-home', 15_000);
  await page.waitForFunction(
    () =>
      (window as never as { __game: { lobby(): { status: string } } }).__game.lobby().status ===
      'online',
  );
}

/** Joue jusqu'au bout : la place 1 sort du stage dans les 12 dernières secondes (pas d'égalité). */
export async function playToEnd(tabs: Tab[], frames = 30 * 60): Promise<void> {
  for (const t of tabs) {
    await t.page.waitForFunction(
      () =>
        (window as never as { __game: { online(): { status: string } } }).__game.online().status ===
        'running',
      null,
      { timeout: 20_000 },
    );
  }
  const slots = await Promise.all(tabs.map((t) => hook<OnlineSnapshot>(t.page, 'online')));
  const loser = tabs[slots.findIndex((s) => s.slot === 1)]!;
  await loser.page.waitForFunction(
    (f) =>
      (window as never as { __game: { online(): { frame: number } } }).__game.online().frame > f,
    frames - 12 * 60,
    { timeout: 60_000 },
  );
  await hook(loser.page, 'forceLeft', true);
  for (const t of tabs) await waitScreen(t.page, 'results', 60_000);
  await hook(loser.page, 'forceLeft', false);
}
