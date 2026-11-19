import {
  A_AIR,
  A_ATTACK,
  A_HITSTUN,
  A_IDLE,
  A_JUMPSQUAT,
  A_LAND,
  A_WALK,
  createFighterView,
} from '@game/sim-core';
import { testConfig } from '@game/sim-core/testing';
import { describe, expect, it } from 'vitest';
import { blendFrames, createPoseDriver } from '../src/fighters/driver.ts';
import { createChain, resetChain, stepChain } from '../src/fighters/dynamics.ts';
import { entrance, striking } from '../src/fighters/figurine.ts';
import {
  computePose,
  createPose,
  createPoseInput,
  settle,
  snap,
  victoryPose,
} from '../src/fighters/poses.ts';
import { squashOf } from '../src/fighters/squash.ts';
import { TRAIL_LIFE, createTrails } from '../src/fighters/trails.ts';

describe('courbes des coups', () => {
  it('le coup part vite et arrive en place ; la retombée dépasse un peu puis se pose', () => {
    expect(snap(0)).toBe(0);
    expect(snap(1)).toBe(1);
    expect(snap(0.3)).toBeGreaterThan(0.3);
    expect(settle(0)).toBeCloseTo(0, 9);
    expect(settle(1)).toBeCloseTo(1, 9);
    let peak = 0;
    for (let t = 0; t <= 1; t += 0.01) peak = Math.max(peak, settle(t));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.15);
  });

  it('fondus : courts vers un coup ou un choc, longs vers le repos', () => {
    expect(blendFrames(A_ATTACK)).toBeLessThan(blendFrames(A_AIR));
    expect(blendFrames(A_HITSTUN)).toBeLessThan(blendFrames(A_IDLE));
  });
});

describe('pas calés sur la distance', () => {
  it('à l’arrêt la marche ne change pas de pose ; elle avance avec la distance parcourue', () => {
    const input = createPoseInput();
    input.action = A_WALK;
    input.stride = 0.1;
    const a = createPose();
    const b = createPose();
    input.frame = 0;
    computePose(input, a);
    input.frame = 30;
    computePose(input, b);
    expect(b.legF).toBeCloseTo(a.legF, 9);
    input.stride = 0.2;
    computePose(input, b);
    expect(Math.abs(b.legF - a.legF)).toBeGreaterThan(0.05);
  });

  it('le pilote cumule la distance parcourue pendant la marche', () => {
    const config = testConfig(1);
    const driver = createPoseDriver(config.fighters[0]!, undefined);
    const v = createFighterView();
    v.action = A_WALK;
    v.grounded = true;
    v.velX = 1.2;
    for (let f = 0; f < 10; f++) {
      v.actionFrame = f;
      driver.capture(v);
    }
    driver.update(v, 1);
    expect(driver.input.stride).toBeGreaterThan(0);
    v.action = A_IDLE;
    v.actionFrame = 0;
    driver.capture(v);
    driver.update(v, 1);
    expect(driver.input.stride).toBe(0);
  });
});

describe('écrasement et étirement', () => {
  const sq = { y: 1 };
  it('tassé avant le saut et à l’atterrissage, étiré en montée, intact au repos', () => {
    expect(squashOf(A_JUMPSQUAT, 3, 3, 0, 0, sq).y).toBeLessThan(1);
    expect(squashOf(A_LAND, 0, 4, 0, 0, sq).y).toBeLessThan(1);
    expect(squashOf(A_LAND, 4, 4, 0, 0, sq).y).toBe(1);
    expect(squashOf(A_AIR, 0, 0, 3, 0, sq).y).toBeGreaterThan(1);
    expect(squashOf(A_AIR, 0, 0, -2, 0, sq).y).toBe(1);
    expect(squashOf(A_HITSTUN, 0, 0, 0, 6, sq).y).toBeLessThan(1);
    expect(squashOf(A_IDLE, 0, 0, 0, 0, sq).y).toBe(1);
  });
});

describe('mouvements secondaires', () => {
  it('au repos, la chaîne pend ; un départ vers l’avant la rejette en arrière, puis elle revient', () => {
    const c = createChain();
    for (let f = 0; f < 20; f++) stepChain(c, 1, 0, 0, 0);
    expect(Math.abs(c.angle[0]!)).toBeLessThan(1e-9);
    stepChain(c, 1, 0, 2, 0);
    for (let f = 0; f < 3; f++) stepChain(c, 1, 0, 2, 0);
    expect(c.angle[0]!).toBeLessThan(-0.05);
    for (let f = 0; f < 120; f++) stepChain(c, 1, 0, 2, 0);
    expect(Math.abs(c.angle[0]!)).toBeLessThan(0.02);
  });

  it('compense l’inclinaison du corps pour pendre vers le bas ; figée sans temps écoulé', () => {
    const c = createChain();
    for (let f = 0; f < 200; f++) stepChain(c, 1, 0.5, 0, 0);
    expect(c.angle[0]!).toBeGreaterThan(0.3);
    const before = c.angle[0]!;
    stepChain(c, 0, 1.5, 9, 9);
    expect(c.angle[0]).toBe(before);
    resetChain(c);
    expect(c.angle[0]).toBe(0);
  });

  it('reste bornée même sous un choc violent', () => {
    const c = createChain();
    stepChain(c, 1, 0, 0, 0);
    stepChain(c, 1, 0, 50, 50);
    for (let f = 0; f < 5; f++) stepChain(c, 1, 0, 0, 0);
    expect(Math.abs(c.angle[0]!)).toBeLessThanOrEqual(1.4);
    expect(Math.abs(c.angle[1]!)).toBeLessThanOrEqual(1.4);
  });
});

describe('traînées des coups', () => {
  it('actives pendant les frames actives d’un coup seulement', () => {
    expect(striking(A_ATTACK, 5, 5, 7)).toBe(true);
    expect(striking(A_ATTACK, 12, 5, 7)).toBe(false);
    expect(striking(A_IDLE, 5, 5, 7)).toBe(false);
    expect(striking(A_ATTACK, 0, 0, 0)).toBe(false);
  });

  it('un échantillon par avancée du temps, éteint après sa durée de vie', () => {
    const trails = createTrails(2);
    trails.push(0, 10, 0, 0, 0);
    trails.push(0, 10.05, 1, 0, 0);
    expect(trails.live(0, 10.1)).toBe(1);
    trails.push(0, 11, 2, 0, 0);
    trails.update(11);
    expect(trails.live(0, 11)).toBe(2);
    expect(trails.live(1, 11)).toBe(0);
    expect(trails.live(0, 11 + TRAIL_LIFE)).toBe(0);
    trails.dispose();
  });
});

describe('écrans : victoire et entrée en scène', () => {
  it('trois poses de victoire distinctes, pieds au sol', () => {
    const poses = [0, 1, 2].map((i) => {
      const p = createPose();
      victoryPose(i, 0, p);
      return p;
    });
    expect(poses[0]!.armF).toBeGreaterThan(2.5);
    expect(poses[1]!.foreF).toBeGreaterThan(1.5);
    expect(poses[2]!.legF).toBeGreaterThan(0.3);
    for (const p of poses) expect(p.hipY).toBeGreaterThan(0.3);
  });

  it('la figurine surgit de 0 à 1 en début de match, avec un léger rebond', () => {
    expect(entrance(0)).toBeCloseTo(0, 9);
    expect(entrance(30)).toBe(1);
    expect(entrance(500)).toBe(1);
    let peak = 0;
    for (let t = 0; t <= 30; t += 0.5) peak = Math.max(peak, entrance(t));
    expect(peak).toBeGreaterThan(1);
  });
});
