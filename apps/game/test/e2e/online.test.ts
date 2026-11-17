/**
 * En ligne dans Edge, deux onglets (un contexte chacun, donc deux invités) : salon privé par code,
 * règles de l'hôte, match jusqu'au bout, mêmes résultats, retour au salon ; rechargement en
 * pleine partie ; lien d'invitation ; erreurs visibles.
 */
import type { Browser, Page } from 'playwright-core';
import type { ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { focused, hook, openTab, startGame, waitScreen, type Tab } from '../helpers.ts';

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

async function focusOn(page: Page, id: string, key = 'ArrowDown'): Promise<void> {
  for (let i = 0; i < 30; i++) {
    if ((await focused(page)) === id) return;
    await page.keyboard.press(key);
  }
  throw new Error(`focus jamais posé sur ${id} (sur ${await focused(page)})`);
}

interface LobbySnapshot {
  status: string;
  room: {
    code: string | null;
    phase: string;
    rules: { mode: string; timeLimit: number };
    members: { ready: boolean }[];
  } | null;
  match: { gameId: string } | null;
}

const lobby = (page: Page) => hook<LobbySnapshot>(page, 'lobby');

interface OnlineSnapshot {
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
async function playToEnd(tabs: Tab[], frames = 30 * 60): Promise<void> {
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

describe('en ligne', () => {
  it('salon privé à deux onglets : code, règles, match, résultats identiques, rechargement, retour au salon', async () => {
    const a = await openTab(browser, url);
    const b = await openTab(browser, url);
    await goOnline(a.page);
    await goOnline(b.page);
    expect(await a.page.textContent('#online-who')).toMatch(/invité/);

    // A crée le salon (bouton déjà focalisé).
    expect(await focused(a.page)).toBe('online-create');
    await a.page.keyboard.press('Enter');
    await waitScreen(a.page, 'online-room');
    const code = (await a.page.getAttribute('#room-code', 'data-code'))!;
    expect(code).toMatch(/^[A-Z0-9]{6}$/);

    // B le rejoint en tapant le code avec un tiret et en minuscules.
    await focusOn(b.page, 'online-join');
    await b.page.keyboard.press('Enter');
    await waitScreen(b.page, 'online-join');
    await b.page.keyboard.type(`${code.slice(0, 3).toLowerCase()}-${code.slice(3)}`);
    await b.page.keyboard.press('Enter');
    await waitScreen(b.page, 'online-room');

    // L'hôte règle un match court : Temps, 30 s.
    await focusOn(a.page, 'room-mode');
    await a.page.keyboard.press('ArrowRight');
    await a.page.waitForFunction(
      () =>
        (window as never as { __game: { lobby(): LobbySnapshot } }).__game.lobby().room!.rules
          .mode === 'time',
    );
    await focusOn(a.page, 'room-time');
    for (let i = 0; i < 10; i++) {
      if ((await lobby(a.page)).room!.rules.timeLimit === 30) break;
      await a.page.keyboard.press('ArrowLeft');
      await a.page.waitForTimeout(80);
    }
    expect((await lobby(a.page)).room!.rules.timeLimit).toBe(30);

    // B se déclare prêt, A lance.
    await b.page.waitForFunction(
      () =>
        (window as never as { __game: { lobby(): LobbySnapshot } }).__game.lobby().room!.rules
          .timeLimit === 30,
    );
    await focusOn(b.page, 'room-ready');
    await b.page.keyboard.press('Enter');
    await a.page.waitForFunction(
      () => !(document.getElementById('room-start') as HTMLButtonElement).disabled,
    );
    await focusOn(a.page, 'room-start', 'ArrowUp');
    await a.page.keyboard.press('Enter');
    for (const t of [a, b]) await waitScreen(t.page, 'match-online', 20_000);

    // B recharge sa page en pleine partie : il revient dans le même match.
    await b.page.waitForFunction(
      () =>
        (window as never as { __game: { online(): { frame: number } } }).__game.online().frame >
        300,
      null,
      { timeout: 30_000 },
    );
    const gameId = (await hook<OnlineSnapshot>(a.page, 'online')).gameId;
    await b.page.reload();
    await waitScreen(b.page, 'match-online', 30_000);
    expect((await hook<OnlineSnapshot>(b.page, 'online')).gameId).toBe(gameId);

    await playToEnd([a, b]);
    const ra = await hook<{ winners: number[]; endFrame: number }>(a.page, 'lastResult');
    const rb = await hook<{ winners: number[]; endFrame: number }>(b.page, 'lastResult');
    expect(rb).toEqual(ra);
    expect(await a.page.textContent('#results-title')).toMatch(/Victoire/);

    // Retour au salon.
    await a.page.keyboard.press('Enter');
    await waitScreen(a.page, 'online-room');
    expect((await lobby(a.page)).room!.phase).toBe('lobby');
    expect(a.errors).toEqual([]);
    expect(b.errors.filter((e) => !e.includes('WebSocket'))).toEqual([]);
  });

  it('lien d’invitation et code faux', async () => {
    const a = await openTab(browser, url);
    await goOnline(a.page);
    await a.page.keyboard.press('Enter');
    await waitScreen(a.page, 'online-room');
    const code = (await a.page.getAttribute('#room-code', 'data-code'))!;

    const b = await openTab(browser, `${url}#rejoindre=${code}`);
    await b.page.keyboard.press('Enter');
    await waitScreen(b.page, 'online-room', 20_000);
    expect((await lobby(b.page)).room!.code).toBe(code);

    // Code inexistant : message clair, on reste à l'accueil.
    const c = await openTab(browser, url);
    await goOnline(c.page);
    await focusOn(c.page, 'online-join');
    await c.page.keyboard.press('Enter');
    await c.page.keyboard.type('ZZZ-ZZZ');
    await c.page.keyboard.press('Enter');
    await c.page.waitForFunction(() =>
      document.getElementById('toast')!.textContent!.includes('Aucun salon'),
    );
    expect(await hook(c.page, 'screen')).toBe('online-home');
  });
});
