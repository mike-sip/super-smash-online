import { describe, expect, it } from 'vitest';
import { A_AIR, A_DOWN, A_HITSTUN, A_IDLE, A_TECH, A_TUMBLE } from '../../src/actions.ts';
import { fx, fxCos, fxMul, fxSin } from '../../src/fixed.ts';
import { BTN_ATTACK, BTN_JUMP, BTN_SHIELD, EV_KO, createSim, type Sim } from '../../src/index.ts';
import { M_FSMASH } from '../../src/moves.ts';
import { hitlagFrames, hitstunFrames, knockback } from '../../src/systems/knockback.ts';
import { TEST_FIGHTER as F, TEST_HEAVY, TEST_STAGE } from '../../src/testing/fixtures.ts';
import {
  NEUTRAL,
  countEvents,
  hold2,
  newSim,
  place,
  press,
  stick,
  teleportAir,
} from './helpers.ts';

const SMASH = F.moves[M_FSMASH]!.hits[0]!;
const HIT_FRAME = SMASH.start;
const LAG = hitlagFrames(SMASH.damage);
const SHIELD = press(BTN_SHIELD);

/** Éjection attendue du smash avant sur une victime à `percent` % avant le coup. */
const smashKb = (percent: number, weight: number = F.weight) =>
  knockback(
    fx(percent) + SMASH.damage,
    SMASH.damage,
    weight,
    SMASH.baseKnockback,
    SMASH.knockbackGrowth,
  );

const launchSpeed = (kb: number) => fxMul(kb, fx(0.03));

/**
 * Le joueur 0 frappe le joueur 1 d'un smash avant non chargé. Renvoie la simulation juste après
 * l'impact : la victime est en hitlag, pas encore éjectée.
 */
function strike(percent: number, sim: Sim = newSim()): Sim {
  place(sim, 0, 0, 1);
  place(sim, 1, 10, -1);
  sim.state.damage[1] = fx(percent);
  hold2(sim, stick(127, 0, BTN_ATTACK), NEUTRAL, 1);
  hold2(sim, NEUTRAL, NEUTRAL, HIT_FRAME - 1);
  expect(sim.state.action[1]).toBe(A_HITSTUN);
  return sim;
}

/** Frappe, puis joue le hitlag pendant que la victime tient `di`. Elle est éjectée à la sortie. */
function strikeAndLaunch(percent: number, di: number = NEUTRAL, sim?: Sim): Sim {
  const s = strike(percent, sim);
  hold2(s, NEUTRAL, di, LAG);
  return s;
}

describe('dégâts et éjection', () => {
  it('ajoute les dégâts à l’impact et n’éjecte qu’à la fin du hitlag', () => {
    const sim = strike(0);
    expect(sim.state.damage[1]).toBe(SMASH.damage);
    expect(sim.state.velX[1]).toBe(0);
    expect(sim.state.grounded[1]).toBe(1);

    hold2(sim, NEUTRAL, NEUTRAL, LAG);
    const speed = launchSpeed(smashKb(0));
    expect(sim.state.velX[1]).toBe(fxMul(speed, fxCos(SMASH.angle)));
    expect(sim.state.velY[1]).toBe(fxMul(speed, fxSin(SMASH.angle)));
    expect(sim.state.grounded[1]).toBe(0);
  });

  it('éjecte dans l’autre sens quand l’attaquant regarde à gauche', () => {
    const sim = newSim();
    place(sim, 0, 0, -1);
    place(sim, 1, -10, 1);
    hold2(sim, stick(-127, 0, BTN_ATTACK), NEUTRAL, 1);
    hold2(sim, NEUTRAL, NEUTRAL, HIT_FRAME - 1 + LAG);
    const speed = launchSpeed(smashKb(0));
    expect(sim.state.velX[1]).toBe(-fxMul(speed, fxCos(SMASH.angle)));
    expect(sim.state.velY[1]).toBe(fxMul(speed, fxSin(SMASH.angle)));
  });

  it('éjecte plus fort une victime déjà endommagée', () => {
    const fresh = strikeAndLaunch(0).state.velX[1]!;
    const hurt = strikeAndLaunch(60).state.velX[1]!;
    expect(hurt).toBeGreaterThan(fresh);
  });

  it('éjecte moins fort un combattant lourd', () => {
    const light = strikeAndLaunch(50).state.launchSpeed[1]!;
    const heavySim = createSim({ stage: TEST_STAGE, fighters: [F, TEST_HEAVY], seed: 1 });
    const heavy = strikeAndLaunch(50, NEUTRAL, heavySim).state.launchSpeed[1]!;
    expect(heavy).toBeLessThan(light);
    expect(heavy).toBe(launchSpeed(smashKb(50, TEST_HEAVY.weight)));
  });
});

describe('hitstun', () => {
  it('dure le nombre de frames prévu, puis rend le contrôle', () => {
    const sim = strikeAndLaunch(0);
    const expected = hitstunFrames(smashKb(0));
    let frames = 0;
    while (sim.state.action[1] === A_HITSTUN && frames < 200) {
      hold2(sim, NEUTRAL, NEUTRAL, 1);
      frames++;
    }
    expect(frames).toBe(expected);
    expect(sim.state.action[1]).toBe(A_AIR);
  });

  it('prive la victime de tout contrôle', () => {
    const free = strikeAndLaunch(0);
    const fighting = strikeAndLaunch(0);
    hold2(free, NEUTRAL, NEUTRAL, 15);
    hold2(fighting, NEUTRAL, stick(-127, 0, BTN_JUMP | BTN_ATTACK), 15);
    expect(fighting.state.posX[1]).toBe(free.state.posX[1]);
    expect(fighting.state.posY[1]).toBe(free.state.posY[1]);
    expect(fighting.state.action[1]).toBe(A_HITSTUN);
  });

  it('passe en chute désordonnée après une forte éjection', () => {
    const sim = strikeAndLaunch(40);
    expect(sim.state.tumble[1]).toBe(1);
    hold2(sim, NEUTRAL, NEUTRAL, hitstunFrames(smashKb(40)));
    expect(sim.state.action[1]).toBe(A_TUMBLE);
  });

  it('laisse sortir de la chute désordonnée par un saut ou un coup de stick', () => {
    for (const escape of [press(BTN_JUMP), stick(127)]) {
      const sim = strikeAndLaunch(40);
      hold2(sim, NEUTRAL, NEUTRAL, hitstunFrames(smashKb(40)));
      hold2(sim, NEUTRAL, escape, 1);
      expect(sim.state.action[1]).toBe(A_AIR);
    }
  });
});

describe('influence directionnelle', () => {
  const speed = launchSpeed(smashKb(0));
  const velocityAt = (angle: number) => [fxMul(speed, fxCos(angle)), fxMul(speed, fxSin(angle))];
  const velocity = (sim: Sim) => [sim.state.velX[1], sim.state.velY[1]];

  it('ne change rien sans input', () => {
    expect(velocity(strikeAndLaunch(0))).toEqual(velocityAt(40));
  });

  it('redresse la trajectoire stick vers le haut', () => {
    // Composante perpendiculaire : cos(40°) × 15° ≈ 11°
    expect(velocity(strikeAndLaunch(0, stick(0, 127)))).toEqual(velocityAt(51));
  });

  it('aplatit la trajectoire stick vers le bas', () => {
    expect(velocity(strikeAndLaunch(0, stick(0, -127)))).toEqual(velocityAt(29));
  });

  it('n’a aucun effet stick dans l’axe de l’éjection', () => {
    expect(velocity(strikeAndLaunch(0, stick(97, 82)))).toEqual(velocityAt(40));
    expect(velocity(strikeAndLaunch(0, stick(-97, -82)))).toEqual(velocityAt(40));
  });

  it('conserve la vitesse : seule la direction change', () => {
    const sq = ([x, y]: (number | undefined)[]) => x! * x! + y! * y!;
    const plain = sq(velocity(strikeAndLaunch(0)));
    const up = sq(velocity(strikeAndLaunch(0, stick(0, 127))));
    expect(Math.abs(up - plain) / plain).toBeLessThan(0.001);
  });

  it('lit le stick à la fin du hitlag, pas à l’impact', () => {
    const sim = strike(0);
    hold2(sim, NEUTRAL, stick(0, -127), LAG - 1);
    hold2(sim, NEUTRAL, stick(0, 127), 1);
    expect(velocity(sim)).toEqual(velocityAt(51));
  });
});

describe('KO par éjection', () => {
  function kosWithin(sim: Sim, frames: number): number {
    let kos = 0;
    for (let f = 0; f < frames; f++) {
      hold2(sim, NEUTRAL, NEUTRAL, 1);
      kos += countEvents(sim, EV_KO);
    }
    return kos;
  }

  it('sort la victime des zones limites à fort pourcentage', () => {
    const sim = strikeAndLaunch(100);
    expect(kosWithin(sim, 120)).toBe(1);
  });

  it('ne tue pas une victime à 0 %', () => {
    const sim = strikeAndLaunch(0);
    expect(kosWithin(sim, 300)).toBe(0);
    expect(sim.state.grounded[1]).toBe(1);
  });
});

describe('rétablissement au sol', () => {
  /** Joueur 0 en chute désordonnée au-dessus du sol principal. */
  function tumbling(y: number, velY = 0): Sim {
    const sim = newSim();
    teleportAir(sim, 0, 0, y);
    sim.state.action[0] = A_TUMBLE;
    sim.state.velY[0] = fx(velY);
    return sim;
  }
  const s0 = (sim: Sim) => sim.state;
  const until = (sim: Sim, input: number, done: () => boolean) => {
    for (let f = 0; f < 200 && !done(); f++) hold2(sim, input, NEUTRAL, 1);
  };

  it('étale la victime au sol sans appui sur bouclier, puis elle se relève', () => {
    const sim = tumbling(2);
    until(sim, NEUTRAL, () => s0(sim).grounded[0] === 1);
    expect(s0(sim).action[0]).toBe(A_DOWN);
    hold2(sim, NEUTRAL, NEUTRAL, F.downFrames - 1);
    expect(s0(sim).action[0]).toBe(A_DOWN);
    hold2(sim, NEUTRAL, NEUTRAL, 1);
    expect(s0(sim).action[0]).toBe(A_IDLE);
  });

  it('réussit le rétablissement si bouclier est pressé peu avant le contact', () => {
    const sim = tumbling(2);
    hold2(sim, SHIELD, NEUTRAL, 1);
    until(sim, NEUTRAL, () => s0(sim).grounded[0] === 1);
    expect(s0(sim).action[0]).toBe(A_TECH);
    expect(s0(sim).velX[0]).toBe(0);
    hold2(sim, NEUTRAL, NEUTRAL, F.techFrames);
    expect(s0(sim).action[0]).toBe(A_IDLE);
  });

  it('fait rebondir une victime qui percute le sol à grande vitesse, une seule fois', () => {
    const sim = tumbling(30, -1.6);
    until(sim, NEUTRAL, () => s0(sim).bounced[0] === 1);
    expect(s0(sim).grounded[0]).toBe(0);
    expect(s0(sim).posY[0]).toBe(0);
    expect(s0(sim).velY[0]).toBe(fxMul(F.maxFallSpeed, fx(0.5)));
    expect(s0(sim).action[0]).toBe(A_TUMBLE);

    hold2(sim, NEUTRAL, NEUTRAL, 1);
    until(sim, NEUTRAL, () => s0(sim).grounded[0] === 1);
    expect(s0(sim).action[0]).toBe(A_DOWN);
  });

  it('rate le rétablissement si bouclier est pressé trop tôt', () => {
    const sim = tumbling(30);
    hold2(sim, SHIELD, NEUTRAL, 1);
    until(sim, NEUTRAL, () => s0(sim).bounced[0] === 1 || s0(sim).grounded[0] === 1);
    expect(s0(sim).bounced[0]).toBe(1);
    expect(s0(sim).action[0]).toBe(A_TUMBLE);
  });

  it('évite le rebond par un rétablissement réussi, même à grande vitesse', () => {
    const sim = tumbling(30, -1.6);
    hold2(sim, NEUTRAL, NEUTRAL, 5);
    hold2(sim, SHIELD, NEUTRAL, 1);
    until(sim, NEUTRAL, () => s0(sim).grounded[0] === 1);
    expect(s0(sim).action[0]).toBe(A_TECH);
    expect(s0(sim).bounced[0]).toBe(0);
  });
});

describe('murs et plafonds pendant l’éjection', () => {
  /** Joueur 0 éjecté, hors du stage à droite, à hauteur du flanc du bloc principal. */
  function flying(x: number, y: number, vx: number, vy: number): Sim {
    const sim = newSim();
    teleportAir(sim, 0, x, y);
    sim.state.action[0] = A_HITSTUN;
    sim.state.stun[0] = 60;
    sim.state.tumble[0] = 1;
    sim.state.velX[0] = fx(vx);
    sim.state.velY[0] = fx(vy);
    return sim;
  }

  it('rebondit contre un mur', () => {
    const sim = flying(68, -22, -2, 0.3);
    hold2(sim, NEUTRAL, NEUTRAL, 4);
    expect(sim.state.velX[0]).toBeGreaterThan(fx(1));
    expect(sim.state.action[0]).toBe(A_HITSTUN);
    expect(sim.state.posX[0]).toBeGreaterThanOrEqual(fx(60) + F.halfWidth);
  });

  it('s’arrête net contre un mur si bouclier a été pressé à temps', () => {
    const sim = flying(68, -22, -2, 0.3);
    hold2(sim, SHIELD, NEUTRAL, 1);
    hold2(sim, NEUTRAL, NEUTRAL, 3);
    expect(sim.state.velX[0]).toBe(0);
    expect(sim.state.action[0]).toBe(A_AIR);
    expect(sim.state.stun[0]).toBe(0);
  });

  it('rebondit sous un plafond', () => {
    const sim = flying(0, -40, 0, 2.5);
    hold2(sim, NEUTRAL, NEUTRAL, 6);
    expect(sim.state.velY[0]).toBeLessThan(fx(-1));
    expect(sim.state.posY[0]).toBeLessThanOrEqual(fx(-20) - F.height);
  });
});
