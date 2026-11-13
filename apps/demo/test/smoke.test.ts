/**
 * Test de fumée : la démo se charge dans Microsoft Edge sans erreur, le canvas n'est pas vide,
 * une touche déplace le joueur 1, et un dessin réel ne modifie pas la simulation.
 */
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DemoTestHook } from '../src/main.ts';

declare global {
  var __demo: DemoTestHook;
}

describe('démo', () => {
  let server: ViteDevServer;
  let browser: Browser;
  let url: string;

  beforeAll(async () => {
    server = await createServer({
      root: fileURLToPath(new URL('..', import.meta.url)),
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1' },
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (address === null || address === undefined || typeof address === 'string') {
      throw new Error('Le serveur de la démo ne donne pas son port.');
    }
    url = `http://127.0.0.1:${address.port}/`;
    browser = await chromium.launch({ channel: 'msedge' });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  async function open(query: string, init?: () => void): Promise<{ page: Page; errors: string[] }> {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    if (init !== undefined) await page.addInitScript(init);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(url + query);
    await page.waitForFunction(() => globalThis.__demo !== undefined && __demo.frame() > 10);
    return { page, errors };
  }

  it('se charge sans erreur et dessine quelque chose', async () => {
    const { page, errors } = await open('');
    expect(await page.evaluate(() => __demo.players)).toBe(2);
    // Fond, stage, deux boîtes : au moins quatre couleurs sur la grille de contrôle.
    expect(await page.evaluate(() => __demo.distinctColors())).toBeGreaterThanOrEqual(4);
    // HUD : un pourcentage et une étiquette visible par joueur.
    expect(await page.locator('[data-hud^="damage-"]').allTextContents()).toEqual(['0%', '0%']);
    expect(await page.locator('[data-hud^="tag-"]:visible').allTextContents()).toEqual([
      'J1',
      'J2',
    ]);
    const [before, after] = await page.evaluate(() => __demo.checksumAroundDraw());
    expect(after).toBe(before);
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);

  it('déplace le joueur 1 quand une touche est enfoncée', async () => {
    const { page, errors } = await open('');
    const start = await page.evaluate(() => __demo.fighter(0).x);
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction((x) => __demo.fighter(0).x > x + 5, start);
    await page.keyboard.up('ArrowRight');

    await page.keyboard.down('KeyZ');
    await page.waitForFunction(() => !__demo.fighter(0).grounded);
    await page.keyboard.up('KeyZ');
    // L'adversaire immobile n'a pas bougé.
    expect(await page.evaluate(() => __demo.fighter(1).x)).toBe(35);
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);

  it('relâche tout quand la fenêtre perd le focus', async () => {
    const { page, errors } = await open('');
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction(() => __demo.fighter(0).velX > 1);
    // La touche reste physiquement enfoncée, mais la fenêtre n'a plus le focus.
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForFunction(() => __demo.fighter(0).velX === 0);
    const stopped = await page.evaluate(() => __demo.fighter(0).x);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => __demo.fighter(0).x)).toBe(stopped);
    await page.keyboard.up('ArrowRight');
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);

  it('accueille une manette, puis le clavier, et survit à un débranchement', async () => {
    // Manettes simulées : la page lit `__pads` à la place du matériel. Le test vérifie notre
    // lecture et la façon dont les joueurs rejoignent, pas une manette réelle.
    const { page, errors } = await open('?dummies=3', () => {
      const pads: unknown[] = [];
      Object.assign(globalThis, { __pads: pads });
      navigator.getGamepads = () => pads as ReturnType<Navigator['getGamepads']>;
    });
    const setPad = (state: { axes?: number[]; pressed?: number[] } | null): Promise<void> =>
      page.evaluate((s) => {
        const pads = (globalThis as unknown as { __pads: unknown[] }).__pads;
        pads[0] =
          s === null
            ? null
            : {
                index: 0,
                id: 'Manette simulée',
                connected: true,
                mapping: 'standard',
                axes: s.axes ?? [0, 0, 0, 0],
                buttons: Array.from({ length: 17 }, (_, i) => {
                  const pressed = s.pressed?.includes(i) ?? false;
                  return { pressed, value: pressed ? 1 : 0 };
                }),
              };
      }, state);
    const settle = (): Promise<void> => page.waitForTimeout(100);

    expect(await page.evaluate(() => __demo.devices())).toEqual(['keyboard', null, null, null]);
    await setPad({});
    await page.waitForFunction(() => __demo.status().includes('branchée'));

    // Personne n'a touché au clavier : la manette prend J1 en appuyant sur un bouton.
    await setPad({ pressed: [9] });
    await page.waitForFunction(() => __demo.devices()[0] === 'gamepad-0');
    expect(await page.evaluate(() => __demo.status())).toContain('J1');
    await setPad({});
    await settle();

    const start = await page.evaluate(() => __demo.fighter(0).x);
    await setPad({ axes: [1, 0, 0, 0] });
    await page.waitForFunction((x) => __demo.fighter(0).x > x + 5, start);
    await setPad({ pressed: [2] });
    await page.waitForFunction(() => !__demo.fighter(0).grounded);
    await setPad({});

    // Le clavier rejoint à son tour, à la place d'un adversaire automatique.
    await page.keyboard.press('KeyX');
    await page.waitForFunction(() => __demo.devices()[1] === 'keyboard');
    const second = await page.evaluate(() => __demo.fighter(1).x);
    await page.keyboard.down('ArrowLeft');
    await page.waitForFunction((x) => __demo.fighter(1).x < x - 5, second);
    await page.keyboard.up('ArrowLeft');

    // Débranchée stick incliné : le joueur s'arrête, son emplacement reste le sien.
    await page.waitForFunction(() => __demo.fighter(0).grounded);
    await setPad({ axes: [-1, 0, 0, 0] });
    await page.waitForFunction(() => __demo.fighter(0).velX < -1);
    await setPad(null);
    await page.waitForFunction(() => __demo.status().includes('débranchée'));
    await page.waitForFunction(() => __demo.fighter(0).velX === 0);
    expect(await page.evaluate(() => __demo.devices()[0])).toBe('gamepad-0');

    await setPad({ axes: [1, 0, 0, 0] });
    await page.waitForFunction(() => __demo.fighter(0).velX > 1);
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);

  it('réassigne une commande, la garde après rechargement, puis revient au défaut', async () => {
    const { page, errors } = await open('');
    const jumps = async (key: string): Promise<boolean> => {
      await page.waitForFunction(() => __demo.fighter(0).grounded && __demo.frame() > 20);
      await page.keyboard.down(key);
      await page.waitForTimeout(200);
      const airborne = await page.evaluate(() => !__demo.fighter(0).grounded);
      await page.keyboard.up(key);
      return airborne;
    };
    const panel = page.locator('#remap');
    const jumpButton = page.locator('[data-remap="jump"]');
    const message = page.locator('[data-remap="message"]');

    expect(await panel.isVisible()).toBe(false);
    await page.locator('[data-control="KeyM"]').click();
    expect(await panel.isVisible()).toBe(true);
    // Les noms affichés sont ceux du clavier de la machine : « Z ou W » sur un QWERTY, « W ou Z »
    // sur un AZERTY, où les deux touches sont échangées. De même la touche KeyQ s'y appelle A.
    const defaultJump = (await jumpButton.textContent()) ?? '';
    expect(defaultJump).toMatch(/^(Z ou W|W ou Z)$/);

    // Une touche de contrôle de la démo est refusée, et ne déclenche pas son contrôle.
    await jumpButton.click();
    await page.keyboard.press('KeyP');
    expect(await message.textContent()).toContain('touche de contrôle');
    expect(await page.evaluate(() => __demo.paused())).toBe(false);

    // Une touche déjà prise par une autre action est signalée.
    await jumpButton.click();
    await page.keyboard.press('KeyX');
    expect(await message.textContent()).toContain('Attaque');
    expect(await jumpButton.textContent()).toBe(defaultJump);

    // Échap annule sans rien changer.
    await jumpButton.click();
    await page.keyboard.press('Escape');
    expect(await jumpButton.textContent()).toBe(defaultJump);

    // Le saut passe sur Q : l'ancienne touche ne saute plus, la nouvelle oui.
    await jumpButton.click();
    await page.keyboard.press('KeyQ');
    expect(await jumpButton.textContent()).toMatch(/^[QA]$/);
    expect(await jumps('KeyZ')).toBe(false);
    expect(await jumps('KeyQ')).toBe(true);

    // Le choix survit au rechargement de la page.
    await page.reload();
    await page.waitForFunction(() => globalThis.__demo !== undefined && __demo.frame() > 10);
    expect(await jumps('KeyQ')).toBe(true);
    await page.locator('[data-control="KeyM"]').click();
    expect(await jumpButton.textContent()).toMatch(/^[QA]$/);

    // Zone morte et saut au stick se règlent et se retrouvent.
    await page.locator('[data-remap="deadzone"]').fill('25');
    await page.locator('[data-remap="deadzone"]').press('Enter');
    await page.locator('[data-remap="tap-jump-0"]').check();
    await page.locator('[data-remap="tap-jump-0"]').blur();
    expect(await jumps('ArrowUp')).toBe(true);

    await page.locator('[data-remap="reset"]').click();
    expect(await jumpButton.textContent()).toBe(defaultJump);
    await page.locator('[data-remap="tap-jump-0"]').uncheck();
    await page.locator('[data-remap="tap-jump-0"]').blur();
    expect(await jumps('ArrowUp')).toBe(false);
    expect(await jumps('KeyZ')).toBe(true);
    expect(await page.locator('[data-remap="deadzone"]').inputValue()).toBe('25');
    expect(errors).toEqual([]);
    await page.close();
  }, 90_000);

  it('met en pause, avance image par image, ralentit et réinitialise', async () => {
    const { page, errors } = await open('?dummies=3&mode=random');
    await page.keyboard.press('KeyP');
    expect(await page.evaluate(() => __demo.paused())).toBe(true);
    const frozen = await page.evaluate(() => __demo.frame());
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => __demo.frame())).toBe(frozen);

    await page.keyboard.press('KeyN');
    await page.waitForFunction((f) => __demo.frame() === f + 1, frozen);
    await page.keyboard.press('KeyN');
    await page.waitForFunction((f) => __demo.frame() === f + 2, frozen);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => __demo.frame())).toBe(frozen + 2);

    // Au dixième de la vitesse, une seconde donne environ six frames.
    await page.keyboard.press('Digit3');
    await page.keyboard.press('KeyP');
    const slowStart = await page.evaluate(() => __demo.frame());
    await page.waitForTimeout(1000);
    const slow = (await page.evaluate(() => __demo.frame())) - slowStart;
    expect(slow).toBeGreaterThanOrEqual(3);
    expect(slow).toBeLessThanOrEqual(12);
    await page.keyboard.press('Digit1');

    // Réinitialisation : la simulation repart de zéro et le nouveau renderer dessine.
    await page.waitForFunction(() => __demo.frame() > 120);
    await page.keyboard.press('KeyR');
    expect(await page.evaluate(() => __demo.frame())).toBeLessThan(60);
    expect(await page.evaluate(() => __demo.distinctColors())).toBeGreaterThanOrEqual(4);
    expect(await page.locator('[data-hud^="damage-"]').count()).toBe(4);
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);

  it('affiche la vue technique à la demande', async () => {
    const { page, errors } = await open('');
    const layer = page.locator('[data-debug="layer"]');
    expect(await layer.isVisible()).toBe(false);
    await page.locator('[data-control="KeyH"]').click();
    expect(await layer.isVisible()).toBe(true);
    await page.waitForTimeout(200);
    // Le canvas de la vue technique porte des tracés : hurtbox, zones limites, texte.
    const painted = await layer.evaluate((canvas) => {
      const c = canvas as HTMLCanvasElement;
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) count++;
      return count;
    });
    expect(painted).toBeGreaterThan(1000);
    // Elle survit à une réinitialisation.
    await page.keyboard.press('KeyR');
    expect(await page.locator('[data-debug="layer"]').isVisible()).toBe(true);
    await page.keyboard.press('KeyH');
    expect(await page.locator('[data-debug="layer"]').isVisible()).toBe(false);
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);

  it('règle la gravité en direct : le saut monte moins haut', async () => {
    const { page, errors } = await open('');
    /** Hauteur maximale atteinte par le joueur 1 pendant un grand saut. */
    const jumpPeak = async (): Promise<number> => {
      await page.waitForFunction(() => __demo.fighter(0).grounded && __demo.frame() > 20);
      await page.keyboard.down('KeyZ');
      const peak = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            let best = 0;
            let airborne = false;
            const watch = (): void => {
              const fighter = __demo.fighter(0);
              best = Math.max(best, fighter.y);
              if (!fighter.grounded) airborne = true;
              if (airborne && fighter.grounded) resolve(best);
              else requestAnimationFrame(watch);
            };
            watch();
          }),
      );
      await page.keyboard.up('KeyZ');
      return peak;
    };

    const before = await jumpPeak();
    expect(before).toBeGreaterThan(25);

    const panel = page.locator('#tuning');
    expect(await panel.isVisible()).toBe(false);
    await page.locator('[data-control="KeyT"]').click();
    expect(await panel.isVisible()).toBe(true);
    const gravity = page.locator('[data-tuning="gravity"]');
    expect(await gravity.inputValue()).toBe('0.09');
    await gravity.fill('0.3');
    // Taper dans un champ ne pilote ni le jeu ni les contrôles : « 3 » n'a pas ralenti la démo.
    expect(await page.evaluate(() => __demo.speed())).toBe(1);
    await gravity.press('Enter');
    await gravity.blur();
    // La simulation a été recréée avec la nouvelle valeur.
    expect(await page.evaluate(() => __demo.frame())).toBeLessThan(30);
    expect(await page.locator('[data-tuning="export"]').inputValue()).toBe('gravity: fx(0.3),');

    const after = await jumpPeak();
    expect(after).toBeLessThan(before / 2);
    expect(await page.evaluate(() => __demo.distinctColors())).toBeGreaterThanOrEqual(4);

    // Retour aux valeurs d'origine.
    await page.locator('[data-tuning="reset"]').click();
    expect(await gravity.inputValue()).toBe('0.09');
    expect(await page.locator('[data-tuning="export"]').inputValue()).toContain('Aucune valeur');
    expect(await jumpPeak()).toBeCloseTo(before, 3);
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);

  it('accepte 7 adversaires à inputs aléatoires', async () => {
    const { page, errors } = await open('?dummies=7&mode=random');
    expect(await page.evaluate(() => __demo.players)).toBe(8);
    const frame = await page.evaluate(() => __demo.frame());
    await page.waitForFunction((f) => __demo.frame() > f + 120, frame);
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);
});
