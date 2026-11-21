/** Invincibilité de réapparition, KO et dégâts imposés (ajouts demandés par `match-rules`). */
import { describe, expect, it } from 'vitest';
import { A_DEAD, A_IDLE } from '../../src/actions.ts';
import { fx } from '../../src/fixed.ts';
import {
  BTN_ATTACK,
  BTN_GRAB,
  BTN_SHIELD,
  EV_GRAB,
  EV_HIT,
  EV_KO,
  createFighterView,
  knockOut,
  readFighter,
  respawn,
  setDamage,
  type Sim,
} from '../../src/index.ts';
import { TEST_FIGHTER as F } from '../../src/testing/fixtures.ts';
import { NEUTRAL, countEvents, hold2, newSim, place, press, stick } from './helpers.ts';

const A = press(BTN_ATTACK);
const G = press(BTN_GRAB);

/** Le joueur 1 attaque le joueur 0 (input `attack`) ; renvoie le nombre d'événements `type`. */
function attackFrom1(sim: Sim, attack: number, type: number, frames = 20): number {
  place(sim, 1, 0, 1);
  place(sim, 0, 7, -1);
  let n = 0;
  hold2(sim, NEUTRAL, attack, 1);
  n += countEvents(sim, type);
  for (let f = 0; f < frames; f++) {
    hold2(sim, NEUTRAL, NEUTRAL, 1);
    n += countEvents(sim, type);
  }
  return n;
}

describe('invincibilité de réapparition', () => {
  it('respawn sans durée : comportement d’avant, vulnérable tout de suite', () => {
    const sim = newSim();
    respawn(sim, 0);
    expect(sim.state.invincible[0]).toBe(0);
    expect(attackFrom1(sim, A, EV_HIT)).toBe(1);
  });

  it('protège des coups et des saisies pendant la durée donnée, puis s’éteint', () => {
    const sim = newSim();
    respawn(sim, 0, 60);
    const view = createFighterView();
    readFighter(sim, 0, view);
    expect(view.invincible).toBe(true);
    expect(attackFrom1(sim, A, EV_HIT)).toBe(0);
    expect(attackFrom1(sim, G, EV_GRAB, F.grab.totalFrames)).toBe(0);

    hold2(sim, NEUTRAL, NEUTRAL, 60);
    expect(sim.state.invincible[0]).toBe(0);
    readFighter(sim, 0, view);
    expect(view.invincible).toBe(false);
    expect(attackFrom1(sim, A, EV_HIT)).toBe(1);
  });

  it('décompte une frame par frame, même pendant le hitlag', () => {
    const sim = newSim();
    respawn(sim, 0, 10);
    sim.state.hitlag[0] = 5;
    hold2(sim, NEUTRAL, NEUTRAL, 4);
    expect(sim.state.invincible[0]).toBe(6);
  });

  it('une esquive pendant l’invincibilité ne la raccourcit pas', () => {
    const sim = newSim();
    respawn(sim, 0, 120);
    hold2(sim, stick(0, -127, BTN_SHIELD), NEUTRAL, 1);
    hold2(sim, NEUTRAL, NEUTRAL, F.spotDodge.totalFrames + 5);
    expect(sim.state.intangible[0]).toBe(0);
    expect(sim.state.invincible[0]).toBeGreaterThan(0);
    expect(attackFrom1(sim, A, EV_HIT)).toBe(0);
  });
});

describe('knockOut', () => {
  it('met le combattant KO comme une sortie de zone limite et émet EV_KO une seule fois', () => {
    const sim = newSim();
    sim.events.count = 0;
    knockOut(sim, 1);
    expect(sim.state.action[1]).toBe(A_DEAD);
    expect(countEvents(sim, EV_KO)).toBe(1);
    expect(sim.events.a[0]).toBe(1);
    knockOut(sim, 1);
    expect(countEvents(sim, EV_KO)).toBe(1);

    hold2(sim, NEUTRAL, NEUTRAL, 30);
    expect(sim.state.action[1]).toBe(A_DEAD);
    respawn(sim, 1);
    expect(sim.state.action[1]).toBe(A_IDLE);
  });
});

describe('setDamage', () => {
  it('impose les dégâts, qui changent l’éjection reçue', () => {
    const low = newSim();
    const high = newSim();
    setDamage(high, 0, fx(300));
    expect(high.state.damage[0]).toBe(fx(300));
    attackFrom1(low, A, EV_HIT, 30);
    attackFrom1(high, A, EV_HIT, 30);
    const dist = (sim: Sim) => Math.abs(sim.state.posX[0]! - fx(7)) + Math.abs(sim.state.posY[0]!);
    expect(dist(high)).toBeGreaterThan(dist(low));
  });
});
