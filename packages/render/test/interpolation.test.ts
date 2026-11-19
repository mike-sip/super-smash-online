import { describe, expect, it } from 'vitest';
import {
  A_AIR,
  A_ATTACK,
  A_DEAD,
  A_HITSTUN,
  A_IDLE,
  A_LEDGE,
  A_LEDGE_GETUP,
  A_LEDGE_ROLL,
  A_TUMBLE,
  A_WALK,
  createSim,
  encodeInput,
  fx,
  respawn,
  step,
  type Sim,
} from '@game/sim-core';
import { testConfig } from '@game/sim-core/testing';
import type { DirectionalLight, Object3D } from 'three';
import {
  createTrack,
  isTeleport,
  pushSample,
  resetTrack,
  sampleX,
  sampleY,
} from '../src/interpolation.ts';
import type { Quality } from '../src/quality.ts';
import { createRendererWith } from '../src/renderer.ts';
import { fakeBackend } from './helpers.ts';

describe('interpolation', () => {
  it('mélange les deux dernières positions selon alpha', () => {
    const track = createTrack(2);
    pushSample(track, 1, 10, 4, false);
    pushSample(track, 1, 20, 8, false);
    expect(sampleX(track, 1, 0)).toBe(10);
    expect(sampleY(track, 1, 0)).toBe(4);
    expect(sampleX(track, 1, 0.5)).toBe(15);
    expect(sampleY(track, 1, 0.5)).toBe(6);
    expect(sampleX(track, 1, 1)).toBe(20);
    expect(sampleY(track, 1, 1)).toBe(8);
  });

  it('ne mélange pas le premier échantillon', () => {
    const track = createTrack(1);
    pushSample(track, 0, 50, 30, false);
    expect(sampleX(track, 0, 0)).toBe(50);
    expect(sampleY(track, 0, 0.5)).toBe(30);
  });

  it('ne mélange pas un saut de position', () => {
    const track = createTrack(1);
    pushSample(track, 0, -140, -70, false);
    pushSample(track, 0, 35, 0, true);
    expect(sampleX(track, 0, 0)).toBe(35);
    expect(sampleY(track, 0, 0.5)).toBe(0);
    // La frame suivante est de nouveau interpolée, à partir de la position d'arrivée.
    pushSample(track, 0, 37, 0, false);
    expect(sampleX(track, 0, 0.5)).toBe(36);
  });

  it('repart de zéro après resetTrack', () => {
    const track = createTrack(1);
    pushSample(track, 0, 0, 0, false);
    resetTrack(track);
    pushSample(track, 0, 100, 100, false);
    expect(sampleX(track, 0, 0)).toBe(100);
  });
});

describe('isTeleport', () => {
  it('reconnaît la réapparition, une accroche et les remontées de rebord', () => {
    expect(isTeleport(A_DEAD, A_IDLE)).toBe(true);
    expect(isTeleport(A_DEAD, A_AIR)).toBe(true);
    expect(isTeleport(A_AIR, A_LEDGE)).toBe(true);
    expect(isTeleport(A_TUMBLE, A_LEDGE)).toBe(true);
    expect(isTeleport(A_LEDGE_GETUP, A_IDLE)).toBe(true);
    expect(isTeleport(A_LEDGE_ROLL, A_IDLE)).toBe(true);
    expect(isTeleport(A_LEDGE, A_ATTACK)).toBe(true);
  });

  it('laisse interpoler les mouvements continus', () => {
    expect(isTeleport(A_IDLE, A_WALK)).toBe(false);
    expect(isTeleport(A_AIR, A_AIR)).toBe(false);
    expect(isTeleport(A_LEDGE, A_LEDGE)).toBe(false);
    expect(isTeleport(A_LEDGE, A_AIR)).toBe(false);
    expect(isTeleport(A_LEDGE, A_LEDGE_GETUP)).toBe(false);
    expect(isTeleport(A_LEDGE_GETUP, A_LEDGE_GETUP)).toBe(false);
    expect(isTeleport(A_AIR, A_HITSTUN)).toBe(false);
    expect(isTeleport(A_HITSTUN, A_DEAD)).toBe(false);
    expect(isTeleport(A_DEAD, A_DEAD)).toBe(false);
  });
});

describe('renderer : positions affichées', () => {
  function setup(players = 2, quality: Quality = 'low') {
    const config = testConfig(players);
    const sim = createSim(config);
    const backend = fakeBackend();
    const renderer = createRendererWith(config, backend, undefined, undefined, undefined, {
      quality,
    });
    const inputs = new Uint32Array(players);
    const object = (name: string): Object3D => {
      const found = backend.scene?.getObjectByName(name);
      if (found === undefined) throw new Error(`Objet ${name} absent de la scène.`);
      return found;
    };
    const advance = (): void => {
      step(sim, inputs);
      renderer.capture(sim);
    };
    return { sim, renderer, inputs, object, advance, backend };
  }

  const posX = (sim: Sim, i: number): number => sim.state.posX[i]! / fx(1);
  const posY = (sim: Sim, i: number): number => sim.state.posY[i]! / fx(1);

  /** Place le joueur 0 en chute, juste à gauche du rebord gauche du stage de test (x = -60, y = 0). */
  function dropNearLedge(sim: Sim): void {
    sim.state.posX[0] = fx(-66);
    sim.state.posY[0] = fx(-5);
    sim.state.grounded[0] = 0;
    sim.state.surface[0] = 0;
    sim.state.action[0] = A_AIR;
  }

  it('interpole un combattant qui marche', () => {
    const t = setup();
    t.inputs[0] = encodeInput(60, 0, 0);
    for (let f = 0; f < 20; f++) t.advance();
    const x1 = posX(t.sim, 0);
    t.advance();
    const x2 = posX(t.sim, 0);
    expect(x2).toBeGreaterThan(x1);

    t.renderer.draw(0);
    expect(t.object('fighter-0').position.x).toBeCloseTo(x1, 6);
    t.renderer.draw(0.5);
    expect(t.object('fighter-0').position.x).toBeCloseTo((x1 + x2) / 2, 6);
    t.renderer.draw(1);
    expect(t.object('fighter-0').position.x).toBeCloseTo(x2, 6);
  });

  it('avec une carte d’ombre, pas d’ombre ronde : le soleil porte la vraie ombre', () => {
    const t = setup(2, 'high');
    t.advance();
    t.renderer.draw(1);
    expect(t.object('shadow-0').visible).toBe(false);
    const sun = t.object('sun') as DirectionalLight;
    expect(sun.castShadow).toBe(true);
    expect(t.object('fighters').getObjectsByProperty('castShadow', true).length).toBeGreaterThan(0);
    // La carte d’ombre suit la caméra.
    expect(Math.abs(sun.target.position.x - t.backend.camera!.position.x)).toBeLessThan(5);
  });

  it('en Bas, oriente la boîte et pose une ombre ronde sous le combattant', () => {
    const t = setup();
    t.advance();
    t.renderer.draw(1);
    expect(t.object('fighter-0').rotation.y).toBe(0);
    expect(t.object('fighter-1').rotation.y).toBe(Math.PI);
    const shadow = t.object('shadow-0');
    expect(shadow.visible).toBe(true);
    expect(shadow.position.x).toBeCloseTo(-35, 6);
    expect(shadow.position.y).toBeGreaterThan(0);
    expect(shadow.position.y).toBeLessThan(0.2);
  });

  it('cache un combattant KO, puis le montre à son point de réapparition sans traînée', () => {
    const t = setup();
    t.advance();
    // En chute sous le stage, au-delà de la zone limite basse.
    dropNearLedge(t.sim);
    t.sim.state.posY[0] = fx(-200);
    t.advance();
    expect(t.sim.state.action[0]).toBe(A_DEAD);
    t.renderer.draw(1);
    expect(t.object('fighter-0').visible).toBe(false);
    expect(t.object('shadow-0').visible).toBe(false);

    respawn(t.sim, 0);
    t.advance();
    t.renderer.draw(0);
    expect(t.object('fighter-0').visible).toBe(true);
    expect(t.object('fighter-0').position.x).toBeCloseTo(-35, 6);
    t.renderer.draw(0.5);
    expect(t.object('fighter-0').position.x).toBeCloseTo(-35, 6);
  });

  it('affiche une accroche au rebord sans traînée', () => {
    const t = setup();
    dropNearLedge(t.sim);
    let frames = 0;
    while (t.sim.state.action[0] !== A_LEDGE) {
      t.advance();
      if (++frames > 60) throw new Error('Le combattant ne se suspend pas au rebord.');
    }
    t.renderer.draw(0);
    expect(t.object('fighter-0').position.x).toBeCloseTo(posX(t.sim, 0), 6);
    expect(t.object('fighter-0').position.y).toBeCloseTo(posY(t.sim, 0), 6);
    // Suspendu au-dessus du vide : pas d'ombre.
    expect(t.object('shadow-0').visible).toBe(false);
  });

  it('affiche la remontée depuis un rebord sans traînée', () => {
    const t = setup();
    dropNearLedge(t.sim);
    for (let f = 0; f < 30; f++) t.advance();
    expect(t.sim.state.action[0]).toBe(A_LEDGE);
    t.inputs[0] = encodeInput(0, 127, 0);
    let frames = 0;
    while (t.sim.state.action[0] !== A_LEDGE_GETUP) {
      t.advance();
      if (++frames > 10) throw new Error('La remontée ne démarre pas.');
    }
    t.inputs[0] = 0;
    while (t.sim.state.action[0] === A_LEDGE_GETUP) t.advance();
    expect(posY(t.sim, 0)).toBe(0);
    t.renderer.draw(0);
    expect(t.object('fighter-0').position.x).toBeCloseTo(posX(t.sim, 0), 6);
    expect(t.object('fighter-0').position.y).toBeCloseTo(0, 6);
  });

  it('ne mélange pas deux frames qui ne se suivent pas', () => {
    const t = setup();
    t.inputs[0] = encodeInput(127, 0, 0);
    t.advance();
    // Deux frames simulées sans capture : la capture suivante ne prolonge pas la précédente.
    step(t.sim, t.inputs);
    step(t.sim, t.inputs);
    t.advance();
    t.renderer.draw(0);
    expect(t.object('fighter-0').position.x).toBeCloseTo(posX(t.sim, 0), 6);
  });
});
