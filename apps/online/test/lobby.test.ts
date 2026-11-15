/**
 * Parcours complet du lobby dans Edge (SPEC-lobby.md, objectif et critère n° 7) : trois onglets,
 * création du salon, code partagé, choix des personnages, règles (Temps, 30 s), lancement ; une
 * page rechargée en pleine partie revient dans le match ; fin ; mêmes résultats partout ; retour
 * au salon. Aucune erreur de console.
 */
import type { Browser } from 'playwright-core';
import type { ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gather, openTab, pickReadyStart, startDemo, unexpected, waitRunning } from './helpers.ts';

describe('lobby de la démo en ligne', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let url: string;

  beforeAll(async () => {
    ({ server, browser, url } = await startDemo());
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it('trois onglets : salon, choix, match, rechargement en pleine partie, résultats, retour', async () => {
    const tabs = [
      await openTab(browser, url),
      await openTab(browser, url),
      await openTab(browser, url),
    ];
    const [host, b, c] = tabs as [(typeof tabs)[0], (typeof tabs)[0], (typeof tabs)[0]];
    await gather(host, [b, c]);

    // L'hôte règle un match court : mode Temps, 30 s.
    await host.page.selectOption('select[name="mode"]', 'time');
    await host.page.waitForFunction(() => __online.lobby().room!.rules.mode === 'time');
    await host.page.fill('input[name="timeLimit"]', '30');
    await host.page.locator('input[name="timeLimit"]').blur();
    await host.page.waitForFunction(() => __online.lobby().room!.rules.timeLimit === 30);
    await pickReadyStart(host, [b, c], 'colosse');
    for (const t of tabs) await waitRunning(t);
    expect(await host.page.locator('#lobby').isHidden()).toBe(true);

    // Le troisième recharge sa page en pleine partie : il revient dans le même match.
    await c.page.waitForTimeout(5_000);
    const gameId = (await host.page.evaluate(() => __online.lobby().match!.gameId))!;
    await c.page.reload();
    await c.page.waitForFunction(() => globalThis.__online?.lobby().status === 'online', null, {
      timeout: 15_000,
    });
    await c.page.waitForFunction(
      (id) => __online.lobby().match?.gameId === id && __online.status() === 'running',
      gameId,
      { timeout: 20_000 },
    );

    // Sans combat, les trois finiraient à égalité, puis en mort subite sans fin : peu avant la fin
    // du temps, les deux invités courent hors du stage, et l'hôte gagne (au temps ou en mort subite).
    await host.page.waitForFunction(() => (__online.stats()?.frame ?? 0) > 1650, null, {
      timeout: 40_000,
    });
    for (const t of [b, c]) await t.page.keyboard.down('ArrowLeft');

    // Fin du match (30 s de jeu), résultats et retour au salon pour tous.
    for (const t of tabs) {
      await t.page
        .waitForFunction(
          (id) =>
            __online.lobby().room?.phase === 'lobby' && __online.lobby().lastEnd?.gameId === id,
          gameId,
          { timeout: 60_000 },
        )
        .catch(async (e: unknown) => {
          // Relevé de l'état de chaque onglet, pour comprendre un échec.
          for (const [i, x] of tabs.entries()) {
            const s = await x.page.evaluate(() =>
              JSON.stringify({
                status: __online.status(),
                error: __online.error(),
                stats: __online.stats(),
                lobbyError: __online.lobby().error,
                phase: __online.lobby().room?.phase,
                lastEnd: __online.lobby().lastEnd,
                results: __online.results().length,
                config: __online.lobby().match?.config,
              }),
            );
            console.log(`onglet ${i} : ${s} ${x.errors.join(' | ')}`);
          }
          throw e;
        });
      await t.page.waitForFunction(
        (id) => __online.lobby().room?.phase === 'lobby' && __online.lobby().lastEnd?.gameId === id,
        gameId,
        { timeout: 60_000 },
      );
    }
    const ends = await Promise.all(
      tabs.map((t) => t.page.evaluate(() => __online.lobby().lastEnd)),
    );
    for (const end of ends) expect(end!.status).toBe('agreed');
    expect(new Set(ends.map((e) => JSON.stringify(e!.result))).size).toBe(1);
    for (const t of tabs) {
      expect(await t.page.locator('#lobby').isVisible()).toBe(true);
      await t.page.locator('#results .end-status[data-status="agreed"]').waitFor();
      expect(await t.page.locator('#results li').count()).toBe(3);
      expect(await t.page.evaluate(() => __online.desyncs())).toBe(0);
      expect(unexpected(t.errors), 'erreurs de console').toEqual([]);
    }
    await host.page.screenshot({ path: 'test-results/lobby-results.png' });
    for (const t of tabs) await t.page.context().close();
  }, 150_000);
});
