import { describe, expect, it } from 'vitest';
import {
  A_GRAB,
  A_GRABBED,
  A_GRABBING,
  A_GRAB_RELEASE,
  A_HITSTUN,
  A_IDLE,
  A_THROW,
} from '../../src/actions.ts';
import { fx, fxCos, fxMul, fxSin } from '../../src/fixed.ts';
import {
  BTN_ATTACK,
  BTN_GRAB,
  BTN_JUMP,
  BTN_SHIELD,
  BTN_SPECIAL,
  EV_GRAB,
  EV_HIT,
  type Sim,
} from '../../src/index.ts';
import {
  GRAB_HOLD_BASE_FRAMES,
  GRAB_RELEASE_FRAMES,
  THROW_BACK,
  THROW_DOWN,
  THROW_FORWARD,
  THROW_UP,
} from '../../src/systems/grab.ts';
import { knockback } from '../../src/systems/knockback.ts';
import { TEST_FIGHTER as F } from '../../src/testing/fixtures.ts';
import { NEUTRAL, countEvents, hold2, holdAll, newSim, place, press, stick } from './helpers.ts';

const G = press(BTN_GRAB);
const A = press(BTN_ATTACK);
const SH = press(BTN_SHIELD);

/** Joueur 0 en x = 0 tourné vers la droite, joueur 1 à `distance` devant lui. */
function duel(distance = 7, players = 2): Sim {
  const sim = newSim(players);
  place(sim, 0, 0, 1);
  place(sim, 1, distance, -1);
  return sim;
}

/** Le joueur 0 saisit le joueur 1. Renvoie la simulation à la frame où la prise s'établit. */
function grabbed(percent = 0): Sim {
  const sim = duel();
  sim.state.damage[1] = fx(percent);
  hold2(sim, G, NEUTRAL, 1);
  hold2(sim, NEUTRAL, NEUTRAL, F.grab.start - 1);
  expect(sim.state.action[0]).toBe(A_GRABBING);
  return sim;
}

describe('saisie', () => {
  it('prend à sa première frame active et immobilise la victime devant soi', () => {
    const sim = duel();
    hold2(sim, G, NEUTRAL, 1);
    expect(sim.state.action[0]).toBe(A_GRAB);
    hold2(sim, NEUTRAL, NEUTRAL, F.grab.start - 2);
    expect(sim.state.action[1]).toBe(A_IDLE);

    hold2(sim, NEUTRAL, NEUTRAL, 1);
    expect(countEvents(sim, EV_GRAB)).toBe(1);
    expect(sim.state.action[0]).toBe(A_GRABBING);
    expect(sim.state.action[1]).toBe(A_GRABBED);
    expect(sim.state.posX[1]).toBe(F.grab.holdX);
    expect(sim.state.facing[1]).toBe(-1);
    expect(sim.state.damage[1]).toBe(0);
  });

  it('dure totalFrames dans le vide', () => {
    const sim = duel(25);
    hold2(sim, G, NEUTRAL, 1);
    hold2(sim, NEUTRAL, NEUTRAL, F.grab.totalFrames - 1);
    expect(sim.state.action[0]).toBe(A_GRAB);
    hold2(sim, NEUTRAL, NEUTRAL, 1);
    expect(sim.state.action[0]).toBe(A_IDLE);
    expect(sim.state.action[1]).toBe(A_IDLE);
  });

  it('passe à travers le bouclier', () => {
    const sim = duel();
    hold2(sim, G, SH, 1);
    hold2(sim, NEUTRAL, SH, F.grab.start - 1);
    expect(sim.state.action[1]).toBe(A_GRABBED);
  });

  it('ne prend pas un adversaire intangible', () => {
    const sim = duel();
    hold2(sim, NEUTRAL, SH, 3);
    hold2(sim, G, stick(0, -127, BTN_SHIELD), 1);
    hold2(sim, NEUTRAL, NEUTRAL, F.grab.end);
    expect(sim.state.action[0]).toBe(A_GRAB);
    expect(sim.state.action[1]).not.toBe(A_GRABBED);
  });

  it('part aussi d’une attaque sous bouclier', () => {
    const sim = newSim();
    hold2(sim, SH, NEUTRAL, 4);
    hold2(sim, press(BTN_SHIELD | BTN_ATTACK), NEUTRAL, 1);
    expect(sim.state.action[0]).toBe(A_GRAB);
  });

  it('prive la victime de tout contrôle', () => {
    const sim = grabbed();
    hold2(sim, NEUTRAL, stick(127), 10);
    expect(sim.state.action[1]).toBe(A_GRABBED);
    expect(sim.state.posX[1]).toBe(F.grab.holdX);
  });
});

describe('coups pendant la prise', () => {
  it('inflige des dégâts à chaque appui, avec un délai entre deux coups', () => {
    const sim = grabbed();
    hold2(sim, A, NEUTRAL, 1);
    expect(countEvents(sim, EV_HIT)).toBe(1);
    expect(sim.state.damage[1]).toBe(F.grab.pummelDamage);

    hold2(sim, NEUTRAL, NEUTRAL, 1);
    hold2(sim, A, NEUTRAL, 1);
    hold2(sim, NEUTRAL, NEUTRAL, 6);
    expect(sim.state.damage[1]).toBe(F.grab.pummelDamage);

    hold2(sim, NEUTRAL, NEUTRAL, F.grab.pummelFrames);
    hold2(sim, A, NEUTRAL, 1);
    expect(sim.state.damage[1]).toBe(2 * F.grab.pummelDamage);
  });
});

describe('projections', () => {
  it.each<[string, number, number]>([
    ['avant', stick(127), THROW_FORWARD],
    ['arrière', stick(-127), THROW_BACK],
    ['haut', stick(0, 127), THROW_UP],
    ['bas', stick(0, -127), THROW_DOWN],
  ])('projection vers l’%s', (_name, input, index) => {
    const sim = grabbed(30);
    const t = F.throws[index]!;
    hold2(sim, input, NEUTRAL, 1);
    expect(sim.state.action[0]).toBe(A_THROW);
    expect(sim.state.move[0]).toBe(index);

    hold2(sim, NEUTRAL, NEUTRAL, t.releaseFrame - 2);
    expect(sim.state.action[1]).toBe(A_GRABBED);
    expect(sim.state.damage[1]).toBe(fx(30));

    hold2(sim, NEUTRAL, NEUTRAL, 1);
    expect(sim.state.damage[1]).toBe(fx(30) + t.damage);
    expect(sim.state.action[1]).toBe(A_HITSTUN);
    expect(sim.state.grabTarget[0]).toBe(0);
    expect(sim.state.grabbedBy[1]).toBe(0);

    // Une frame de gel, puis l'éjection.
    hold2(sim, NEUTRAL, NEUTRAL, 1);
    const kb = knockback(fx(30) + t.damage, t.damage, F.weight, t.baseKnockback, t.knockbackGrowth);
    const speed = fxMul(kb, fx(0.03));
    expect(sim.state.velX[1]).toBe(fxMul(speed, fxCos(t.angle)));
    expect(sim.state.velY[1]).toBe(fxMul(speed, fxSin(t.angle)));

    hold2(sim, NEUTRAL, NEUTRAL, t.totalFrames - t.releaseFrame);
    expect(sim.state.action[0]).toBe(A_IDLE);
  });

  it('éjecte derrière soi avec la projection arrière', () => {
    const sim = grabbed();
    hold2(sim, stick(-127), NEUTRAL, 1);
    hold2(sim, NEUTRAL, NEUTRAL, F.throws[THROW_BACK].releaseFrame + 5);
    expect(sim.state.velX[1]).toBeLessThan(0);
    expect(sim.state.posX[1]).toBeLessThan(F.grab.holdX);
  });
});

describe('dégagement', () => {
  /** Nombre de frames avant que la prise ne se rompe d'elle-même. */
  function holdDuration(sim: Sim, victimInput: (f: number) => number): number {
    for (let f = 1; f <= 400; f++) {
      hold2(sim, NEUTRAL, victimInput(f), 1);
      if (sim.state.action[0] !== A_GRABBING) return f;
    }
    return -1;
  }

  it('libère la victime au bout du temps de prise, sans dégâts', () => {
    const sim = grabbed();
    expect(holdDuration(sim, () => NEUTRAL)).toBe(GRAB_HOLD_BASE_FRAMES);
    expect(sim.state.action[0]).toBe(A_GRAB_RELEASE);
    expect(sim.state.action[1]).toBe(A_GRAB_RELEASE);
    expect(sim.state.damage[1]).toBe(0);
    expect(sim.state.velX[0]).toBeLessThan(0);
    expect(sim.state.velX[1]).toBeGreaterThan(0);

    hold2(sim, NEUTRAL, NEUTRAL, GRAB_RELEASE_FRAMES);
    expect(sim.state.action[0]).toBe(A_IDLE);
    expect(sim.state.action[1]).toBe(A_IDLE);
  });

  it('tient plus longtemps une victime endommagée', () => {
    expect(holdDuration(grabbed(100), () => NEUTRAL)).toBe(GRAB_HOLD_BASE_FRAMES + 50);
  });

  it('plafonne la durée de prise', () => {
    expect(holdDuration(grabbed(900), () => NEUTRAL)).toBe(180);
  });

  it('se rompt plus vite si la victime se débat', () => {
    const buttons = [BTN_ATTACK, BTN_SPECIAL, BTN_JUMP];
    const mashed = holdDuration(grabbed(), (f) => press(buttons[f % 3]!));
    expect(mashed).toBeGreaterThan(0);
    expect(mashed).toBeLessThan(GRAB_HOLD_BASE_FRAMES / 4);
  });

  it('ne compte pas un bouton simplement maintenu', () => {
    expect(holdDuration(grabbed(), () => A)).toBeGreaterThan(GRAB_HOLD_BASE_FRAMES - 10);
  });
});

describe('indépendance à l’ordre des joueurs', () => {
  /** Saisie puis projection avant, en miroir si `grabber` vaut 1. Renvoie la position de la victime. */
  function throwFrom(grabber: 0 | 1): number {
    const target = grabber === 0 ? 1 : 0;
    const dir = grabber === 0 ? 1 : -1;
    const sim = newSim();
    place(sim, grabber, 0, dir as 1 | -1);
    place(sim, target, 7 * dir, -dir as 1 | -1);
    const inputs = [NEUTRAL, NEUTRAL];
    const play = (input: number, frames: number) => {
      inputs[grabber] = input;
      hold2(sim, inputs[0]!, inputs[1]!, frames);
    };
    play(G, 1);
    play(NEUTRAL, F.grab.start - 1);
    play(stick(127 * dir), 1);
    play(NEUTRAL, 40);
    return sim.state.posX[target]! * dir;
  }

  it('projette à la même distance que celui qui saisit soit le joueur 0 ou le joueur 1', () => {
    expect(throwFrom(1)).toBe(throwFrom(0));
  });

  it('libère au même instant dans les deux cas', () => {
    const duration = (grabber: 0 | 1): number[] => {
      const target = grabber === 0 ? 1 : 0;
      const dir = grabber === 0 ? 1 : -1;
      const sim = newSim();
      place(sim, grabber, 0, dir as 1 | -1);
      place(sim, target, 7 * dir, -dir as 1 | -1);
      const inputs = [NEUTRAL, NEUTRAL];
      inputs[grabber] = G;
      hold2(sim, inputs[0]!, inputs[1]!, 1);
      hold2(sim, NEUTRAL, NEUTRAL, F.grab.start - 1 + GRAB_HOLD_BASE_FRAMES + 12);
      return [sim.state.posX[grabber]! * dir, sim.state.posX[target]! * dir];
    };
    expect(duration(1)).toEqual(duration(0));
  });
});

describe('cas simultanés', () => {
  it('annule deux saisies mutuelles, de façon symétrique', () => {
    const sim = newSim();
    place(sim, 0, -3.5, 1);
    place(sim, 1, 3.5, -1);
    hold2(sim, G, G, 1);
    hold2(sim, NEUTRAL, NEUTRAL, F.grab.start - 1);
    expect(sim.state.action[0]).toBe(A_GRAB_RELEASE);
    expect(sim.state.action[1]).toBe(A_GRAB_RELEASE);
    expect(countEvents(sim, EV_GRAB)).toBe(0);

    hold2(sim, NEUTRAL, NEUTRAL, 10);
    expect(sim.state.posX[0]).toBe(-sim.state.posX[1]!);
    expect(sim.state.posX[0]).toBeLessThan(fx(-3.5));
  });

  it('donne la victime au plus proche quand deux joueurs la saisissent ensemble', () => {
    const sim = newSim(3);
    place(sim, 0, -7, 1);
    place(sim, 1, 0, 1);
    place(sim, 2, 6, -1);
    holdAll(sim, [G, NEUTRAL, G], 1);
    holdAll(sim, [NEUTRAL, NEUTRAL, NEUTRAL], F.grab.start - 1);
    expect(sim.state.action[2]).toBe(A_GRABBING);
    expect(sim.state.action[0]).toBe(A_GRAB);
    expect(sim.state.grabbedBy[1]).toBe(3);
  });

  it('libère la victime si celui qui la tient est frappé', () => {
    const sim = newSim(3);
    place(sim, 0, 0, 1);
    place(sim, 1, 7, -1);
    place(sim, 2, -7, 1);
    holdAll(sim, [G, NEUTRAL, NEUTRAL], 1);
    holdAll(sim, [NEUTRAL, NEUTRAL, NEUTRAL], F.grab.start - 1);
    expect(sim.state.action[1]).toBe(A_GRABBED);

    holdAll(sim, [NEUTRAL, NEUTRAL, A], 1);
    holdAll(sim, [NEUTRAL, NEUTRAL, NEUTRAL], 3);
    expect(sim.state.action[0]).toBe(A_HITSTUN);
    expect(sim.state.action[1]).toBe(A_GRAB_RELEASE);
    expect(sim.state.grabTarget[0]).toBe(0);
    expect(sim.state.grabbedBy[1]).toBe(0);
  });

  it('libère celui qui tient si sa victime est frappée par un tiers', () => {
    const sim = newSim(3);
    place(sim, 0, 0, 1);
    place(sim, 1, 7, -1);
    place(sim, 2, 13, -1);
    holdAll(sim, [G, NEUTRAL, NEUTRAL], 1);
    holdAll(sim, [NEUTRAL, NEUTRAL, NEUTRAL], F.grab.start - 1);

    holdAll(sim, [NEUTRAL, NEUTRAL, A], 1);
    holdAll(sim, [NEUTRAL, NEUTRAL, NEUTRAL], 3);
    expect(sim.state.action[1]).toBe(A_HITSTUN);
    expect(sim.state.action[0]).toBe(A_GRAB_RELEASE);
    expect(sim.state.grabTarget[0]).toBe(0);
  });
});
