import { describe, expect, it } from 'vitest';
import { A_AIR, A_IDLE, A_JUMPSQUAT, A_LAND } from '../../src/actions.ts';
import { fx, fxToFloat } from '../../src/fixed.ts';
import { BTN_JUMP, type Sim } from '../../src/index.ts';
import { TEST_FIGHTER as F } from '../../src/testing/fixtures.ts';
import { NEUTRAL, hold, holdUntil, newSim, press, stick, teleportAir } from './helpers.ts';

const JUMP = press(BTN_JUMP);

/** Saute et renvoie la hauteur maximale atteinte, en unités de jeu. */
function apex(sim: Sim, heldFrames: number): number {
  const base = sim.state.posY[0]!;
  let top = base;
  hold(sim, JUMP, heldFrames);
  for (let f = 0; f < 120; f++) {
    hold(sim, NEUTRAL, 1);
    top = Math.max(top, sim.state.posY[0]!);
    if (sim.state.grounded[0] === 1 && f > 10) break;
  }
  return fxToFloat(top - base);
}

describe('saut', () => {
  it('reste au sol pendant exactement jumpSquatFrames frames', () => {
    const sim = newSim();
    hold(sim, JUMP, 1);
    expect(sim.state.action[0]).toBe(A_JUMPSQUAT);
    hold(sim, JUMP, F.jumpSquatFrames - 1);
    expect(sim.state.grounded[0]).toBe(1);
    hold(sim, JUMP, 1);
    expect(sim.state.grounded[0]).toBe(0);
    expect(sim.state.action[0]).toBe(A_AIR);
    expect(sim.state.posY[0]).toBe(F.jumpVelocity - F.gravity);
  });

  it('fait un grand saut si le bouton est maintenu, un petit s’il est relâché avant le décollage', () => {
    const full = apex(newSim(), 10);
    const short = apex(newSim(), 1);
    expect(full).toBeGreaterThan(30);
    expect(full).toBeLessThan(36);
    expect(short).toBeGreaterThan(12);
    expect(short).toBeLessThan(16);
  });

  it('retombe, encaisse le lag d’atterrissage, puis revient au repos', () => {
    const sim = newSim();
    // Petit saut : un grand saut atterrirait sur la plateforme au-dessus.
    hold(sim, JUMP, 1);
    hold(sim, NEUTRAL, 5);
    holdUntil(sim, NEUTRAL, () => sim.state.grounded[0] === 1);
    expect(sim.state.action[0]).toBe(A_LAND);
    expect(sim.state.posY[0]).toBe(0);
    expect(sim.state.velY[0]).toBe(0);
    hold(sim, NEUTRAL, F.landFrames);
    expect(sim.state.action[0]).toBe(A_IDLE);
  });

  it('ne redéclenche pas un saut tant que le bouton reste enfoncé', () => {
    const sim = newSim();
    hold(sim, JUMP, 200);
    expect(sim.state.grounded[0]).toBe(1);
    expect(sim.state.action[0]).toBe(A_IDLE);
  });
});

describe('double saut', () => {
  it('accorde un seul saut en l’air, rendu à l’atterrissage', () => {
    const sim = newSim();
    hold(sim, JUMP, 6);
    hold(sim, NEUTRAL, 20);
    expect(sim.state.jumpsLeft[0]).toBe(1);

    hold(sim, JUMP, 1);
    expect(sim.state.velY[0]).toBe(F.doubleJumpVelocity - F.gravity);
    expect(sim.state.jumpsLeft[0]).toBe(0);

    hold(sim, NEUTRAL, 10);
    const falling = sim.state.velY[0]!;
    hold(sim, JUMP, 1);
    expect(sim.state.velY[0]).toBeLessThan(falling);

    holdUntil(sim, NEUTRAL, () => sim.state.action[0] === A_IDLE);
    hold(sim, JUMP, 6);
    expect(sim.state.jumpsLeft[0]).toBe(1);
  });
});

describe('contrôle aérien', () => {
  it('dérive sans dépasser la vitesse aérienne maximale', () => {
    const sim = newSim();
    hold(sim, JUMP, 4);
    hold(sim, stick(127), 40);
    expect(sim.state.velX[0]).toBe(F.airSpeed);
    expect(sim.state.posX[0]).toBeGreaterThan(fx(-35));
  });

  it('ralentit en l’air quand le stick est au neutre', () => {
    const sim = newSim();
    hold(sim, JUMP, 4);
    hold(sim, stick(127), 20);
    const before = sim.state.velX[0]!;
    hold(sim, NEUTRAL, 5);
    expect(sim.state.velX[0]).toBeLessThan(before);
    expect(sim.state.velX[0]).toBeGreaterThanOrEqual(0);
  });

  it('plafonne la vitesse de chute', () => {
    const sim = newSim();
    teleportAir(sim, 0, -100, 100);
    hold(sim, NEUTRAL, 60);
    expect(sim.state.velY[0]).toBe(-F.maxFallSpeed);
  });

  it('passe en chute rapide sur un coup de stick vers le bas, seulement en descente', () => {
    const sim = newSim();
    hold(sim, JUMP, 5);
    hold(sim, stick(0, -127), 1);
    expect(sim.state.fastFall[0]).toBe(0);

    holdUntil(sim, NEUTRAL, () => sim.state.velY[0]! < 0);
    hold(sim, stick(0, -127), 1);
    expect(sim.state.fastFall[0]).toBe(1);
    expect(sim.state.velY[0]).toBe(-F.fastFallSpeed);

    holdUntil(sim, NEUTRAL, () => sim.state.grounded[0] === 1);
    expect(sim.state.fastFall[0]).toBe(0);
  });
});

describe('plateformes traversables', () => {
  // Plateforme gauche : x de -40 à -15, y = 20. Le joueur 0 démarre dessous, en x = -35.
  function onPlatform(): Sim {
    const sim = newSim();
    hold(sim, JUMP, 6);
    holdUntil(sim, NEUTRAL, () => sim.state.grounded[0] === 1);
    return sim;
  }

  it('se traverse par le bas et s’atterrit par le haut', () => {
    const sim = onPlatform();
    expect(sim.state.posY[0]).toBe(fx(20));
    expect(sim.state.action[0]).toBe(A_LAND);
  });

  it('se quitte par un coup de stick vers le bas', () => {
    const sim = onPlatform();
    hold(sim, NEUTRAL, 10);
    hold(sim, stick(0, -127), 1);
    expect(sim.state.grounded[0]).toBe(0);
    hold(sim, stick(0, -127), 3);
    holdUntil(sim, NEUTRAL, () => sim.state.grounded[0] === 1);
    expect(sim.state.posY[0]).toBe(0);
  });

  it('ne retient pas un joueur qui maintient le stick vers le bas en tombant', () => {
    const sim = newSim();
    teleportAir(sim, 0, -27, 35);
    holdUntil(sim, stick(0, -80), () => sim.state.grounded[0] === 1);
    expect(sim.state.posY[0]).toBe(0);
  });

  it('retient un joueur qui tombe dessus sans toucher au stick', () => {
    const sim = newSim();
    teleportAir(sim, 0, -27, 35);
    holdUntil(sim, NEUTRAL, () => sim.state.grounded[0] === 1);
    expect(sim.state.posY[0]).toBe(fx(20));
  });

  it('s’arrête au bord en marchant, comme sur le sol principal', () => {
    const sim = onPlatform();
    hold(sim, stick(-60), 200);
    expect(sim.state.posX[0]).toBe(fx(-40));
    expect(sim.state.grounded[0]).toBe(1);
  });
});

describe('murs et plafonds', () => {
  // Bloc principal : x de -60 à 60, y de -20 à 0.
  it('bute contre le flanc du stage', () => {
    const sim = newSim();
    teleportAir(sim, 0, -64, -15);
    hold(sim, stick(127), 6);
    expect(sim.state.posX[0]).toBe(fx(-60) - F.halfWidth);
    expect(sim.state.velX[0]).toBe(0);
  });

  it('se cogne la tête sous le stage', () => {
    const sim = newSim();
    teleportAir(sim, 0, 0, -45);
    hold(sim, JUMP, 1);
    hold(sim, NEUTRAL, 8);
    expect(sim.state.posY[0]).toBeLessThanOrEqual(fx(-20) - F.height);
    const top = sim.state.posY[0]!;
    hold(sim, NEUTRAL, 30);
    expect(sim.state.posY[0]).toBeLessThan(top);
  });

  it('ne traverse jamais le sol plein par le haut', () => {
    const sim = newSim();
    teleportAir(sim, 0, 0, 60);
    sim.state.fastFall[0] = 1;
    holdUntil(sim, stick(0, -127), () => sim.state.grounded[0] === 1);
    expect(sim.state.posY[0]).toBe(0);
  });
});
