import {
  A_HITSTUN,
  A_IDLE,
  A_TUMBLE,
  EV_HIT,
  EV_KO,
  createFighterView,
  type FighterView,
} from '@game/sim-core';
import { describe, expect, it } from 'vitest';
import { finaleScale } from '../src/renderer.ts';
import { createVfx, type Blast } from '../src/vfx/library.ts';
import {
  P_BURST,
  P_SHARD,
  P_SPLAT,
  P_TWINKLE,
  createParticlePool,
  type ParticlePool,
} from '../src/vfx/particles.ts';

const BLAST: Blast = { left: -200, right: 200, top: 180, bottom: -120 };

function setup(isFinal?: (p: number) => boolean) {
  const glow = createParticlePool(4000);
  const puff = createParticlePool(2000);
  const vfx = createVfx({
    glow,
    puff,
    heights: new Float64Array(2).fill(12),
    gravities: new Float64Array(2).fill(0.12),
    blast: BLAST,
    themes: ['ember', 'wind'],
    ...(isFinal === undefined ? {} : { isFinal }),
  });
  const views: FighterView[] = [0, 1].map((i) => {
    const v = createFighterView();
    v.x = i * 20;
    v.grounded = true;
    v.action = A_IDLE;
    return v;
  });
  return { glow, puff, vfx, views };
}

/** Particules d'une forme donnée écrites dans la réserve. */
function count(pool: ParticlePool, shape: number): number {
  let n = 0;
  for (let i = 0; i < pool.emitted && i < pool.capacity; i++) {
    if (pool.look[i * 4 + 3] === shape && pool.look[i * 4 + 2]! > 0) n++;
  }
  return n;
}

describe('impacts stylisés (SPEC-finition.md, phase 3)', () => {
  it('tout coup a son éclat à pointes ; un coup fort brise un anneau et projette de l’encre', () => {
    const weak = setup();
    weak.views[1]!.action = A_HITSTUN;
    weak.views[1]!.hitlag = 5;
    weak.vfx.event(EV_HIT, 0, 1, weak.views, 10);
    expect(count(weak.glow, P_BURST)).toBe(1);
    expect(count(weak.glow, P_SHARD)).toBe(0);
    expect(count(weak.puff, P_SPLAT)).toBe(0);

    const strong = setup();
    strong.views[1]!.action = A_HITSTUN;
    strong.views[1]!.hitlag = 20;
    strong.vfx.event(EV_HIT, 0, 1, strong.views, 10);
    expect(count(strong.glow, P_SHARD)).toBe(1);
    expect(count(strong.puff, P_SPLAT)).toBeGreaterThanOrEqual(2);
  });

  it('un KO par le haut laisse une étoile qui scintille, pas une explosion au bord', () => {
    const { glow, vfx, views } = setup();
    vfx.view.minX = -100;
    vfx.view.maxX = 100;
    vfx.view.minY = -60;
    vfx.view.maxY = 60;
    views[1]!.x = 10;
    views[1]!.y = 190;
    vfx.event(EV_KO, 1, -1, views, 30);
    expect(count(glow, P_TWINKLE)).toBe(1);
    views[0]!.x = 230;
    views[0]!.y = 0;
    vfx.event(EV_KO, 0, -1, views, 40);
    expect(count(glow, P_TWINKLE)).toBe(1);
  });

  it('l’éjection qui finit le match demande le ralenti et un gros plan long', () => {
    const final = setup((p) => p === 1);
    const v = final.views[1]!;
    v.action = A_TUMBLE;
    v.grounded = false;
    v.x = 150;
    v.velX = 4;
    v.velY = 0.5;
    // L'éjection part quand le gel du coup se termine.
    v.hitlag = 6;
    final.vfx.fighter(1, v, 1);
    final.vfx.fighter(1, v, 2);
    v.hitlag = 0;
    final.vfx.fighter(1, v, 3);
    expect(final.vfx.cues.finale).toBe(true);
    expect(final.vfx.cues.closeLife).toBeGreaterThan(30);

    const normal = setup(() => false);
    v.hitlag = 6;
    normal.vfx.fighter(1, v, 1);
    normal.vfx.fighter(1, v, 2);
    v.hitlag = 0;
    normal.vfx.fighter(1, v, 3);
    expect(normal.vfx.cues.closeLife).toBeGreaterThan(0);
    expect(normal.vfx.cues.finale).toBe(false);
  });

  it('le ralenti tient, revient en douceur, et vaut 1 hors du coup final', () => {
    expect(finaleScale(Number.POSITIVE_INFINITY)).toBe(1);
    expect(finaleScale(-5)).toBe(1);
    expect(finaleScale(0)).toBeLessThan(0.5);
    expect(finaleScale(5)).toBe(finaleScale(0));
    let previous = finaleScale(10);
    for (let age = 11; age <= 50; age++) {
      const s = finaleScale(age);
      expect(s).toBeGreaterThanOrEqual(previous);
      previous = s;
    }
    expect(finaleScale(50)).toBe(1);
  });
});

describe('HUD redessiné (SPEC-finition.md, phase 4)', () => {
  it('le pourcentage passe du blanc au rouge sombre en chauffant', async () => {
    const { heatColor } = await import('../src/hud.ts');
    expect(heatColor(0)).toBe('rgb(255,255,255)');
    const red = (c: string): number[] => c.match(/\d+/g)!.map(Number);
    const [, g40] = red(heatColor(40));
    const [, g120] = red(heatColor(120));
    expect(g120!).toBeLessThan(g40!);
    expect(heatColor(400)).toBe(heatColor(150));
    expect(red(heatColor(150))[0]).toBeLessThan(255);
  });
});
