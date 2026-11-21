import { describe, expect, it } from 'vitest';
import {
  A_AIR,
  A_BRAKE,
  A_CROUCH,
  A_DASH,
  A_IDLE,
  A_RUN,
  A_TURN,
  A_WALK,
} from '../../src/actions.ts';
import { fx } from '../../src/fixed.ts';
import { TEST_FIGHTER as F } from '../../src/testing/fixtures.ts';
import { NEUTRAL, hold, holdUntil, newSim, play, stick } from './helpers.ts';

// Le joueur 0 démarre en x = -35 sur le sol principal, qui va de -60 à 60 en y = 0.
const START_X = fx(-35);

describe('au repos', () => {
  it('reste immobile et au sol', () => {
    const sim = newSim();
    hold(sim, NEUTRAL, 60);
    const s = sim.state;
    expect(s.action[0]).toBe(A_IDLE);
    expect(s.grounded[0]).toBe(1);
    expect(s.posX[0]).toBe(START_X);
    expect(s.posY[0]).toBe(0);
  });
});

describe('marche', () => {
  it('accélère jusqu’à une vitesse proportionnelle à l’inclinaison du stick', () => {
    const sim = newSim();
    hold(sim, stick(60), 1);
    expect(sim.state.action[0]).toBe(A_WALK);
    expect(sim.state.velX[0]).toBe(F.walkAccel);
    hold(sim, stick(60), 60);
    expect(sim.state.velX[0]).toBe(Math.trunc((F.walkSpeed * 60) / 127));
    expect(sim.state.facing[0]).toBe(1);
  });

  it('avance exactement de la somme des vitesses', () => {
    const sim = newSim();
    let x: number = START_X;
    let v = 0;
    const target = Math.trunc((F.walkSpeed * 60) / 127);
    for (let f = 0; f < 30; f++) {
      hold(sim, stick(60), 1);
      v = Math.min(v + F.walkAccel, target);
      x += v;
      expect(sim.state.posX[0]).toBe(x);
    }
  });

  it('se retourne immédiatement en marchant vers l’arrière', () => {
    const sim = newSim();
    hold(sim, stick(-60), 5);
    expect(sim.state.facing[0]).toBe(-1);
    expect(sim.state.velX[0]).toBeLessThan(0);
  });

  it('s’arrête par friction quand le stick revient au neutre', () => {
    const sim = newSim();
    hold(sim, stick(60), 30);
    hold(sim, NEUTRAL, 1);
    expect(sim.state.action[0]).toBe(A_IDLE);
    hold(sim, NEUTRAL, 30);
    expect(sim.state.velX[0]).toBe(0);
  });

  it('ignore un stick dans la zone morte', () => {
    const sim = newSim();
    hold(sim, stick(19), 20);
    expect(sim.state.action[0]).toBe(A_IDLE);
    expect(sim.state.posX[0]).toBe(START_X);
  });

  it('s’arrête au bord de la plateforme au lieu de tomber', () => {
    const sim = newSim();
    hold(sim, stick(60), 400);
    expect(sim.state.posX[0]).toBe(fx(60));
    expect(sim.state.grounded[0]).toBe(1);
    expect(sim.state.velX[0]).toBe(0);
  });
});

describe('dash et course', () => {
  it('part en dash à pleine vitesse dès la première frame', () => {
    const sim = newSim();
    hold(sim, stick(127), 1);
    expect(sim.state.action[0]).toBe(A_DASH);
    expect(sim.state.velX[0]).toBe(F.dashSpeed);
    expect(sim.state.posX[0]).toBe(START_X + F.dashSpeed);
  });

  it('dure dashFrames frames puis enchaîne sur la course si le stick est maintenu', () => {
    const sim = newSim();
    hold(sim, stick(127), F.dashFrames);
    expect(sim.state.action[0]).toBe(A_DASH);
    hold(sim, stick(127), 1);
    expect(sim.state.action[0]).toBe(A_RUN);
    hold(sim, stick(127), 10);
    expect(sim.state.velX[0]).toBe(F.runSpeed);
  });

  it('ne part pas en dash si le stick est incliné lentement', () => {
    const sim = newSim();
    play(
      sim,
      [20, 40, 60, 80, 100, 127].map((x) => stick(x)),
    );
    expect(sim.state.action[0]).toBe(A_WALK);
  });

  it('part en dash si le stick atteint le fond en 3 frames', () => {
    const sim = newSim();
    play(
      sim,
      [40, 80, 127].map((x) => stick(x)),
    );
    expect(sim.state.action[0]).toBe(A_DASH);
  });

  it('permet d’inverser le dash (dash dance)', () => {
    const sim = newSim();
    hold(sim, stick(127), 4);
    hold(sim, stick(-127), 1);
    expect(sim.state.action[0]).toBe(A_DASH);
    expect(sim.state.facing[0]).toBe(-1);
    expect(sim.state.velX[0]).toBe(-F.dashSpeed);
  });

  it('freine puis revient au repos quand le stick est relâché en course', () => {
    const sim = newSim();
    hold(sim, stick(127), F.dashFrames + 5);
    hold(sim, NEUTRAL, 1);
    expect(sim.state.action[0]).toBe(A_BRAKE);
    hold(sim, NEUTRAL, F.brakeFrames);
    expect(sim.state.action[0]).toBe(A_IDLE);
    hold(sim, NEUTRAL, 30);
    expect(sim.state.velX[0]).toBe(0);
  });

  it('fait demi-tour en course : dérapage, puis course dans l’autre sens', () => {
    const sim = newSim();
    hold(sim, stick(127), F.dashFrames + 5);
    hold(sim, stick(-127), 1);
    expect(sim.state.action[0]).toBe(A_TURN);
    expect(sim.state.facing[0]).toBe(1);
    hold(sim, stick(-127), F.turnFrames);
    expect(sim.state.action[0]).toBe(A_RUN);
    expect(sim.state.facing[0]).toBe(-1);
    hold(sim, stick(-127), 30);
    expect(sim.state.velX[0]).toBe(-F.runSpeed);
  });

  it('quitte la plateforme en courant', () => {
    const sim = newSim();
    const frames = holdUntil(sim, stick(127), () => sim.state.grounded[0] === 0);
    expect(sim.state.action[0]).toBe(A_AIR);
    expect(sim.state.posX[0]).toBeGreaterThan(fx(60));
    expect(sim.state.jumpsLeft[0]).toBe(F.airJumps);
    expect(frames).toBeGreaterThan(40);
    hold(sim, stick(127), 10);
    expect(sim.state.posY[0]).toBeLessThan(0);
  });
});

describe('accroupi', () => {
  it('s’accroupit stick vers le bas et se relève au relâchement', () => {
    const sim = newSim();
    hold(sim, stick(0, -80), 1);
    expect(sim.state.action[0]).toBe(A_CROUCH);
    hold(sim, stick(0, -80), 20);
    expect(sim.state.action[0]).toBe(A_CROUCH);
    expect(sim.state.grounded[0]).toBe(1);
    hold(sim, NEUTRAL, 1);
    expect(sim.state.action[0]).toBe(A_IDLE);
  });

  it('ne traverse pas le sol plein, même stick à fond vers le bas', () => {
    const sim = newSim();
    hold(sim, stick(0, -127), 30);
    expect(sim.state.action[0]).toBe(A_CROUCH);
    expect(sim.state.posY[0]).toBe(0);
  });
});
