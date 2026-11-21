/**
 * Deux onglets de Microsoft Edge jouent ensemble dans la démo en ligne (SPEC-netcode.md, critère
 * n° 5), désormais par le lobby (SPEC-lobby.md) : le premier crée un salon, le second le rejoint
 * par son code, chacun choisit son personnage et l'hôte lance. Une touche dans le premier fait
 * bouger son combattant dans le second ; aux mêmes frames confirmées, les deux onglets envoient
 * les mêmes empreintes au relais.
 */
import type { Browser } from 'playwright-core';
import type { ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gather, openTab, pickReadyStart, startDemo, unexpected, waitRunning } from './helpers.ts';

describe('démo en ligne', () => {
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

  it('ouvre une session invité et affiche le menu du lobby', async () => {
    const tab = await openTab(browser, url);
    expect(await tab.page.locator('#create-room').isVisible()).toBe(true);
    expect(await tab.page.evaluate(() => __online.lobby().you?.guest)).toBe(true);
    // Un code inconnu est refusé avec un message.
    await tab.page.fill('input[name="code"]', 'ZZZ-ZZZ');
    await tab.page.click('#join-room button[type="submit"]');
    await tab.page.locator('.error[data-code="not_found"]').waitFor();
    expect(unexpected(tab.errors)).toEqual([]);
    await tab.page.context().close();
  }, 60_000);

  it('deux onglets jouent la même partie et restent synchronisés', async () => {
    const a = await openTab(browser, url);
    const b = await openTab(browser, url);
    await gather(a, [b]);
    await pickReadyStart(a, [b]);
    for (const t of [a, b]) await waitRunning(t);
    const slotA = (await a.page.evaluate(() => __online.localSlots()))[0]!;
    const slotB = (await b.page.evaluate(() => __online.localSlots()))[0]!;
    expect(new Set([slotA, slotB])).toEqual(new Set([0, 1]));

    // Le joueur du premier onglet court à droite : le second le voit avancer.
    const startX = await b.page.evaluate((p) => __online.fighter(p)!.x, slotA);
    await a.page.keyboard.down('ArrowRight');
    await b.page.waitForFunction((args) => __online.fighter(args.p)!.x > args.x + 5, {
      p: slotA,
      x: startX,
    });
    await a.page.keyboard.up('ArrowRight');
    // Et un saut du second est vu par le premier.
    await b.page.keyboard.down('KeyZ');
    await a.page.waitForFunction((p) => !__online.fighter(p)!.grounded, slotB);
    await b.page.keyboard.up('KeyZ');

    // Laisse passer quelques empreintes après ces inputs, puis compare frame par frame.
    await a.page.waitForTimeout(2000);
    const sumsA = new Map(await a.page.evaluate(() => __online.checksums()));
    const sumsB = new Map(await b.page.evaluate(() => __online.checksums()));
    const common = [...sumsA.keys()].filter((f) => sumsB.has(f));
    expect(common.length).toBeGreaterThan(10);
    for (const f of common) expect(sumsA.get(f), `frame ${f}`).toBe(sumsB.get(f));

    for (const { page, errors } of [a, b]) {
      expect(await page.evaluate(() => __online.desyncs())).toBe(0);
      expect(unexpected(errors)).toEqual([]);
    }
    const stats = (await a.page.evaluate(() => __online.stats()))!;
    console.log(
      `deux onglets : frame ${stats.frame}, aller-retour ${stats.rttMs.toFixed(1)} ms, ` +
        `${stats.rollbacks} rollbacks, ${stats.stalls} attentes, ${common.length} empreintes comparées`,
    );
    await a.page.context().close();
    await b.page.context().close();
  }, 90_000);
});
