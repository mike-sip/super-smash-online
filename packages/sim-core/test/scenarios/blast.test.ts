import { describe, expect, it } from 'vitest';
import { A_DEAD, A_IDLE } from '../../src/actions.ts';
import { fx } from '../../src/fixed.ts';
import {
  EV_KO,
  STATE_BYTES,
  checksum,
  events,
  loadState,
  respawn,
  saveState,
} from '../../src/index.ts';
import { NEUTRAL, hold, holdUntil, newSim, stick, teleportAir } from './helpers.ts';

// Zones limites du stage de test : x de -150 à 150, y de -80 à 120.

describe('zones limites', () => {
  it('émet un KO, une seule fois, quand un joueur court hors du stage et tombe', () => {
    const sim = newSim();
    let kos = 0;
    for (let f = 0; f < 400; f++) {
      hold(sim, stick(127), 1);
      const q = events(sim);
      for (let e = 0; e < q.count; e++) {
        if (q.type[e] === EV_KO) {
          kos++;
          expect(q.a[e]).toBe(0);
        }
      }
    }
    expect(kos).toBe(1);
    expect(sim.state.action[0]).toBe(A_DEAD);
  });

  it.each([
    ['gauche', -149, 0, -2, 0],
    ['droite', 149, 0, 2, 0],
    ['haut', 0, 119, 0, 3],
    ['bas', 100, -79, 0, -2],
  ])('tue par la limite %s', (_name, x, y, vx, vy) => {
    const sim = newSim();
    teleportAir(sim, 0, x, y);
    sim.state.velX[0] = fx(vx);
    sim.state.velY[0] = fx(vy);
    hold(sim, NEUTRAL, 1);
    expect(events(sim).count).toBe(1);
    expect(events(sim).type[0]).toBe(EV_KO);
    expect(sim.state.action[0]).toBe(A_DEAD);
  });

  it('fige un joueur mort : il ne bouge plus et n’obéit plus aux inputs', () => {
    const sim = newSim();
    teleportAir(sim, 0, 0, -79);
    sim.state.velY[0] = fx(-2);
    hold(sim, NEUTRAL, 3);
    expect(sim.state.action[0]).toBe(A_DEAD);
    const x = sim.state.posX[0];
    const y = sim.state.posY[0];
    hold(sim, stick(127), 30);
    expect(sim.state.posX[0]).toBe(x);
    expect(sim.state.posY[0]).toBe(y);
    expect(sim.state.action[0]).toBe(A_DEAD);
  });

  it('ne touche pas les autres joueurs', () => {
    const sim = newSim(4);
    teleportAir(sim, 2, 0, -79);
    hold(sim, NEUTRAL, 5);
    expect(sim.state.action[2]).toBe(A_DEAD);
    for (const p of [0, 1, 3]) expect(sim.state.action[p]).toBe(A_IDLE);
  });
});

describe('file d’événements', () => {
  it('est vidée à chaque frame', () => {
    const sim = newSim();
    teleportAir(sim, 0, 0, -79);
    holdUntil(sim, NEUTRAL, () => events(sim).count > 0);
    hold(sim, NEUTRAL, 1);
    expect(events(sim).count).toBe(0);
  });

  it('réémet le KO quand la frame est re-simulée après un rollback', () => {
    const sim = newSim();
    teleportAir(sim, 0, 0, -78);
    const snap = new Uint8Array(STATE_BYTES);
    saveState(sim, snap);
    holdUntil(sim, NEUTRAL, () => events(sim).count > 0);
    const after = checksum(sim);

    loadState(sim, snap);
    holdUntil(sim, NEUTRAL, () => events(sim).count > 0);
    expect(events(sim).type[0]).toBe(EV_KO);
    expect(checksum(sim)).toBe(after);
  });
});

describe('réapparition', () => {
  it('remet le joueur sur son point d’apparition, dégâts à zéro, de nouveau jouable', () => {
    const sim = newSim();
    teleportAir(sim, 0, 0, -79);
    sim.state.damage[0] = fx(87);
    hold(sim, NEUTRAL, 5);
    expect(sim.state.action[0]).toBe(A_DEAD);

    respawn(sim, 0);
    expect(sim.state.action[0]).toBe(A_IDLE);
    expect(sim.state.posX[0]).toBe(fx(-35));
    expect(sim.state.posY[0]).toBe(0);
    expect(sim.state.grounded[0]).toBe(1);
    expect(sim.state.damage[0]).toBe(0);

    hold(sim, stick(60), 10);
    expect(sim.state.posX[0]).toBeGreaterThan(fx(-35));
  });

  it('permet un second KO après réapparition', () => {
    const sim = newSim();
    teleportAir(sim, 0, 0, -79);
    hold(sim, NEUTRAL, 5);
    respawn(sim, 0);
    teleportAir(sim, 0, 0, -79);
    holdUntil(sim, NEUTRAL, () => events(sim).count > 0);
    expect(sim.state.action[0]).toBe(A_DEAD);
  });
});
