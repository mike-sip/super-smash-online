import {
  A_DASH,
  A_HITSTUN,
  A_IDLE,
  A_JUMPSQUAT,
  A_AIR,
  A_ATTACK,
  EV_ULTIMATE,
  M_JAB,
  M_NSPECIAL,
  EV_HIT,
  EV_KO,
  EV_PARRY,
  EV_SHIELD_BREAK,
  createFighterView,
  type FighterView,
} from '@game/sim-core';
import { describe, expect, it } from 'vitest';
import { dimWeight } from '../src/renderer.ts';
import { createVfx, isSpecialMove, likelyKo, type Blast } from '../src/vfx/library.ts';
import { createParticlePool, liveParticles } from '../src/vfx/particles.ts';

const BLAST: Blast = { left: -200, right: 200, top: 180, bottom: -120 };

function setup(players = 2) {
  const glow = createParticlePool(4000);
  const puff = createParticlePool(2000);
  const vfx = createVfx({
    glow,
    puff,
    heights: new Float64Array(players).fill(12),
    gravities: new Float64Array(players).fill(0.12),
    blast: BLAST,
  });
  const views: FighterView[] = [];
  for (let i = 0; i < players; i++) {
    const v = createFighterView();
    v.x = i * 20;
    v.grounded = true;
    v.action = A_IDLE;
    views.push(v);
  }
  return { glow, puff, vfx, views };
}

describe('KO probable', () => {
  it('une éjection rapide vers une zone limite proche est décisive', () => {
    expect(likelyKo(150, 0, 3.5, 0.5, 0.12, BLAST)).toBe(true);
    expect(likelyKo(-150, 0, -3.5, 0.5, 0.12, BLAST)).toBe(true);
    expect(likelyKo(0, 50, 0, 6.5, 0.12, BLAST)).toBe(true);
  });

  it('une éjection faible, ou vers l’autre côté, ne l’est pas', () => {
    expect(likelyKo(0, 0, 1, 1, 0.12, BLAST)).toBe(false);
    expect(likelyKo(150, 0, -2, 0, 0.12, BLAST)).toBe(false);
    expect(likelyKo(0, 0, 0, -6, 0.12, BLAST)).toBe(false);
  });
});

describe('effets des événements', () => {
  it('un coup fort émet plus d’étincelles et secoue la caméra', () => {
    const weak = setup();
    weak.views[1]!.hitlag = 4;
    weak.vfx.event(EV_HIT, 0, 1, weak.views, 10);
    const strong = setup();
    strong.views[1]!.hitlag = 20;
    strong.vfx.event(EV_HIT, 0, 1, strong.views, 10);
    expect(strong.glow.emitted).toBeGreaterThan(weak.glow.emitted);
    expect(weak.vfx.cues.shake).toBe(0);
    expect(strong.vfx.cues.shake).toBeGreaterThan(0);
    expect(liveParticles(strong.glow, 11)).toBe(strong.glow.emitted);
  });

  it('les étincelles partent du côté opposé à l’attaquant', () => {
    const t = setup();
    t.views[0]!.x = 0;
    t.views[1]!.x = 20;
    t.views[1]!.hitlag = 12;
    t.vfx.event(EV_HIT, 0, 1, t.views, 0);
    let vx = 0;
    for (let i = 0; i < t.glow.emitted; i++) vx += t.glow.motion[i * 4]!;
    expect(vx).toBeGreaterThan(0);
  });

  it('un KO hors de l’écran explose au bord de la vue, secoue et éclaire l’écran', () => {
    const t = setup();
    Object.assign(t.vfx.view, { minX: -100, maxX: 100, minY: -50, maxY: 60 });
    t.views[0]!.x = 260;
    t.views[0]!.y = 10;
    t.vfx.event(EV_KO, 0, 0, t.views, 50);
    for (let i = 0; i < t.glow.emitted; i++) {
      expect(t.glow.start[i * 4]!).toBeLessThanOrEqual(100);
    }
    expect(t.vfx.cues.shake).toBeGreaterThan(0.02);
    expect(t.vfx.cues.flash).toBeGreaterThan(0);
  });

  it('parade et bris de bouclier ont leurs effets', () => {
    for (const ev of [EV_PARRY, EV_SHIELD_BREAK]) {
      const t = setup();
      t.vfx.event(ev, 0, 1, t.views, 0);
      expect(t.glow.emitted).toBeGreaterThan(5);
    }
  });

  it('un joueur inconnu (entité sans propriétaire) ne casse rien', () => {
    const t = setup();
    t.views[1]!.hitlag = 8;
    expect(() => t.vfx.event(EV_HIT, -1, 1, t.views, 0)).not.toThrow();
    expect(() => t.vfx.event(EV_KO, 7, 0, t.views, 0)).not.toThrow();
  });
});

describe('effets des changements d’état', () => {
  it('rien à la première frame vue, puis poussière au dash et à l’atterrissage', () => {
    const t = setup(1);
    const v = t.views[0]!;
    t.vfx.fighter(0, v, 0);
    expect(t.puff.emitted).toBe(0);
    v.action = A_DASH;
    t.vfx.fighter(0, v, 1);
    const afterDash = t.puff.emitted;
    expect(afterDash).toBeGreaterThan(0);
    v.action = A_AIR;
    v.grounded = false;
    v.velY = -3;
    t.vfx.fighter(0, v, 2);
    v.action = A_IDLE;
    v.grounded = true;
    t.vfx.fighter(0, v, 3);
    expect(t.puff.emitted).toBeGreaterThan(afterDash + 4);
  });

  it('après un saut dans le temps, l’état précédent est oublié', () => {
    const t = setup(1);
    const v = t.views[0]!;
    t.vfx.fighter(0, v, 0);
    t.vfx.forget();
    v.action = A_JUMPSQUAT;
    v.grounded = true;
    t.vfx.fighter(0, v, 100);
    expect(t.puff.emitted).toBe(0);
  });

  it('l’éjection décisive demande un gros plan, une fois par intervalle', () => {
    const t = setup(1);
    const v = t.views[0]!;
    v.action = A_HITSTUN;
    v.hitlag = 3;
    t.vfx.fighter(0, v, 0);
    v.hitlag = 0;
    v.x = 150;
    v.velX = 3.5;
    v.grounded = false;
    t.vfx.fighter(0, v, 1);
    expect(t.vfx.cues.closeLife).toBeGreaterThan(0);
    expect(t.vfx.cues.flash).toBeGreaterThan(0);
    // Une traînée suit la victime.
    expect(t.puff.emitted).toBeGreaterThan(0);

    t.vfx.cues.closeLife = 0;
    v.hitlag = 3;
    t.vfx.fighter(0, v, 20);
    v.hitlag = 0;
    t.vfx.fighter(0, v, 21);
    expect(t.vfx.cues.closeLife).toBe(0);
  });
});

describe('effets propres aux personnages', () => {
  function themed(theme: string) {
    const glow = createParticlePool(4000);
    const puff = createParticlePool(2000);
    const vfx = createVfx({
      glow,
      puff,
      heights: new Float64Array(1).fill(12),
      gravities: new Float64Array(1).fill(0.12),
      blast: BLAST,
      themes: [theme],
    });
    const v = createFighterView();
    v.grounded = true;
    v.action = A_IDLE;
    vfx.fighter(0, v, 0);
    return { glow, vfx, v };
  }

  it('un spécial émet les particules du thème à chaque frame', () => {
    const t = themed('wind');
    t.v.action = A_ATTACK;
    t.v.move = M_NSPECIAL;
    const before = t.glow.emitted;
    for (let f = 1; f <= 10; f++) t.vfx.fighter(0, t.v, f);
    expect(t.glow.emitted - before).toBeGreaterThanOrEqual(20);
  });

  it('les braises s’échappent même au repos ; un coup normal n’a pas d’effet de thème', () => {
    const ember = themed('ember');
    for (let f = 1; f <= 30; f++) ember.vfx.fighter(0, ember.v, f);
    expect(ember.glow.emitted).toBeGreaterThan(5);
    const wind = themed('wind');
    wind.v.action = A_ATTACK;
    wind.v.move = M_JAB;
    for (let f = 1; f <= 30; f++) wind.vfx.fighter(0, wind.v, f);
    expect(wind.glow.emitted).toBe(0);
  });

  it('l’ultime assombrit le décor ; un projectile laisse une traînée', () => {
    const t = themed('pearl');
    t.vfx.event(EV_ULTIMATE, 0, 0, [t.v], 5);
    expect(t.vfx.cues.dimLife).toBeGreaterThan(0);
    const before = t.glow.emitted;
    t.vfx.projectile(10, 10, 2, 0, 0, 2, 6);
    expect(t.glow.emitted).toBe(before + 1);
    expect(t.glow.motion[(t.glow.next - 1) * 4]).toBeLessThan(0);
  });

  it('isSpecialMove ne retient que les spéciaux et l’ultime', () => {
    expect(isSpecialMove(M_NSPECIAL)).toBe(true);
    expect(isSpecialMove(M_JAB)).toBe(false);
  });
});

describe('assombrissement de l’ultime', () => {
  it('monte, tient, puis revient', () => {
    expect(dimWeight(-1, 80)).toBe(0);
    expect(dimWeight(10, 80)).toBe(1);
    expect(dimWeight(75, 80)).toBeGreaterThan(0);
    expect(dimWeight(75, 80)).toBeLessThan(1);
    expect(dimWeight(80, 80)).toBe(0);
  });
});
