import { describe, expect, it } from 'vitest';
import { A_ATTACK, A_IDLE, A_JUMPSQUAT, A_LAND } from '../../src/actions.ts';
import {
  BTN_ATTACK,
  BTN_CSTICK_DOWN,
  BTN_CSTICK_LEFT,
  BTN_CSTICK_RIGHT,
  BTN_CSTICK_UP,
  BTN_JUMP,
  BTN_SPECIAL,
  createSim,
} from '../../src/index.ts';
import {
  M_BAIR,
  M_DAIR,
  M_DASH_ATTACK,
  M_DSMASH,
  M_DTILT,
  M_FAIR,
  M_FSMASH,
  M_FTILT,
  M_JAB,
  M_JAB2,
  M_NAIR,
  M_UAIR,
  M_USMASH,
  M_UTILT,
} from '../../src/moves.ts';
import { TEST_FIGHTER as F, TEST_HEAVY, TEST_STAGE } from '../../src/testing/fixtures.ts';
import { NEUTRAL, hold, newSim, play, press, stick, teleportAir } from './helpers.ts';

const A = press(BTN_ATTACK);
const JUMP = press(BTN_JUMP);
const move = (slot: number) => F.moves[slot]!;

/** Répète un input n fois. */
const times = (input: number, n: number): number[] => Array.from({ length: n }, () => input);

describe('déroulement d’une attaque', () => {
  it('dure exactement totalFrames, puis rend la main', () => {
    const sim = newSim();
    hold(sim, A, 1);
    expect(sim.state.action[0]).toBe(A_ATTACK);
    expect(sim.state.move[0]).toBe(M_JAB);
    hold(sim, NEUTRAL, move(M_JAB).totalFrames - 1);
    expect(sim.state.action[0]).toBe(A_ATTACK);
    hold(sim, NEUTRAL, 1);
    expect(sim.state.action[0]).toBe(A_IDLE);
  });

  it('ne fait rien si le combattant n’a pas d’attaque à cet emplacement', () => {
    const sim = newSim();
    // Le combattant de test n'a pas de spécial haut.
    hold(sim, stick(0, 127, BTN_SPECIAL), 3);
    expect(sim.state.action[0]).toBe(A_IDLE);
  });

  it('freine le combattant pendant une attaque au sol', () => {
    const sim = newSim();
    hold(sim, stick(127), 3);
    hold(sim, stick(127, 0, BTN_ATTACK), 1);
    expect(sim.state.move[0]).toBe(M_DASH_ATTACK);
    const fast = sim.state.velX[0]!;
    hold(sim, NEUTRAL, 25);
    expect(sim.state.velX[0]).toBe(0);
    expect(fast).toBeGreaterThan(0);
  });
});

describe('choix de l’attaque au sol', () => {
  const slow = (x: number, y: number) => times(stick(x, y), 5);

  it.each<[string, number[], number, number, 1 | -1]>([
    ['jab, stick au neutre', [], A, M_JAB, 1],
    ['tilt avant', slow(60, 0), stick(60, 0, BTN_ATTACK), M_FTILT, 1],
    [
      'tilt avant vers l’arrière : le combattant se retourne',
      [],
      stick(-60, 0, BTN_ATTACK),
      M_FTILT,
      -1,
    ],
    ['tilt haut', slow(0, 60), stick(0, 60, BTN_ATTACK), M_UTILT, 1],
    ['tilt bas, depuis accroupi', slow(0, -80), stick(0, -80, BTN_ATTACK), M_DTILT, 1],
    ['smash avant, sur un coup de stick', [], stick(127, 0, BTN_ATTACK), M_FSMASH, 1],
    ['smash avant vers l’arrière', [], stick(-127, 0, BTN_ATTACK), M_FSMASH, -1],
    ['smash haut', [], stick(0, 127, BTN_ATTACK), M_USMASH, 1],
    ['smash bas', [], stick(0, -127, BTN_ATTACK), M_DSMASH, 1],
    [
      'tilt haut si le stick est à fond depuis longtemps',
      slow(0, 127),
      stick(0, 127, BTN_ATTACK),
      M_UTILT,
      1,
    ],
    ['smash haut au stick droit', [], press(BTN_CSTICK_UP), M_USMASH, 1],
    ['smash bas au stick droit', [], press(BTN_CSTICK_DOWN), M_DSMASH, 1],
    ['smash avant au stick droit, vers la gauche', [], press(BTN_CSTICK_LEFT), M_FSMASH, -1],
    ['attaque de dash', times(stick(127), 3), stick(127, 0, BTN_ATTACK), M_DASH_ATTACK, 1],
    [
      'attaque de dash en pleine course',
      times(stick(127), 20),
      stick(127, 0, BTN_ATTACK),
      M_DASH_ATTACK,
      1,
    ],
  ])('%s', (_name, before, input, slot, facing) => {
    const sim = newSim();
    play(sim, before);
    hold(sim, input, 1);
    expect(sim.state.action[0]).toBe(A_ATTACK);
    expect(sim.state.move[0]).toBe(slot);
    expect(sim.state.facing[0]).toBe(facing);
  });
});

describe('choix de l’attaque en l’air', () => {
  it.each<[string, number, number]>([
    ['neutre', A, M_NAIR],
    ['avant', stick(60, 0, BTN_ATTACK), M_FAIR],
    ['arrière', stick(-60, 0, BTN_ATTACK), M_BAIR],
    ['haut', stick(0, 60, BTN_ATTACK), M_UAIR],
    ['bas', stick(0, -60, BTN_ATTACK), M_DAIR],
    ['haut au stick droit', press(BTN_CSTICK_UP), M_UAIR],
    ['arrière au stick droit', press(BTN_CSTICK_LEFT), M_BAIR],
    ['avant au stick droit', press(BTN_CSTICK_RIGHT), M_FAIR],
  ])('aérienne %s', (_name, input, slot) => {
    const sim = newSim();
    hold(sim, JUMP, 4);
    hold(sim, NEUTRAL, 3);
    hold(sim, input, 1);
    expect(sim.state.action[0]).toBe(A_ATTACK);
    expect(sim.state.move[0]).toBe(slot);
    // Une attaque aérienne ne retourne jamais le combattant.
    expect(sim.state.facing[0]).toBe(1);
  });

  it('garde le contrôle aérien pendant l’attaque', () => {
    const sim = newSim();
    hold(sim, JUMP, 4);
    hold(sim, A, 1);
    hold(sim, stick(127), 15);
    expect(sim.state.action[0]).toBe(A_ATTACK);
    expect(sim.state.velX[0]).toBeGreaterThan(0);
  });
});

describe('tampon d’inputs', () => {
  const TOTAL = move(M_FTILT).totalFrames;

  /** Lance un tilt avant, joue `input` à la frame `at` de l'attaque, puis va jusqu'à la frame libre. */
  function duringFtilt(at: number, input: number) {
    const sim = newSim();
    sim.state.tilt[0] = 10;
    hold(sim, stick(60, 0, BTN_ATTACK), 1);
    expect(sim.state.move[0]).toBe(M_FTILT);
    for (let f = 2; f <= TOTAL + 1; f++) hold(sim, f === at ? input : NEUTRAL, 1);
    return sim;
  }

  it('lance l’attaque demandée jusqu’à 6 frames trop tôt, dès la première frame libre', () => {
    const sim = duringFtilt(TOTAL - 4, A);
    expect(sim.state.action[0]).toBe(A_ATTACK);
    expect(sim.state.move[0]).toBe(M_JAB);
    expect(sim.state.actionFrame[0]).toBe(1);
  });

  it('oublie un appui trop ancien', () => {
    const sim = duringFtilt(TOTAL - 5, A);
    expect(sim.state.action[0]).toBe(A_IDLE);
  });

  it('met aussi le saut en tampon', () => {
    const sim = duringFtilt(TOTAL - 1, JUMP);
    expect(sim.state.action[0]).toBe(A_JUMPSQUAT);
  });
});

describe('annulations', () => {
  it('enchaîne jab puis jab 2 dans la fenêtre prévue', () => {
    const sim = newSim();
    hold(sim, A, 1);
    hold(sim, NEUTRAL, 5);
    hold(sim, A, 1);
    expect(sim.state.move[0]).toBe(M_JAB2);
    expect(sim.state.actionFrame[0]).toBe(1);
  });

  it('attend l’ouverture de la fenêtre quand l’appui arrive en avance', () => {
    const sim = newSim();
    play(sim, [A, NEUTRAL, A, NEUTRAL, NEUTRAL]);
    expect(sim.state.move[0]).toBe(M_JAB);
    hold(sim, NEUTRAL, 1);
    expect(sim.state.move[0]).toBe(M_JAB2);
  });

  it('refuse une annulation réservée aux coups qui ont touché', () => {
    const sim = newSim();
    hold(sim, A, 1);
    hold(sim, NEUTRAL, 5);
    hold(sim, A, 1);
    hold(sim, NEUTRAL, 8);
    hold(sim, A, 1);
    expect(sim.state.move[0]).toBe(M_JAB2);
    expect(sim.state.connected[0]).toBe(0);
  });
});

describe('attaques chargées', () => {
  const smash = move(M_FSMASH);
  const charge = smash.charge!;

  it('dure totalFrames sans charge', () => {
    const sim = newSim();
    hold(sim, stick(127, 0, BTN_ATTACK), 1);
    hold(sim, NEUTRAL, smash.totalFrames - 1);
    expect(sim.state.action[0]).toBe(A_ATTACK);
    expect(sim.state.charge[0]).toBe(0);
    hold(sim, NEUTRAL, 1);
    expect(sim.state.action[0]).toBe(A_IDLE);
  });

  it('se fige sur sa frame de charge tant que le bouton est tenu, jusqu’au maximum', () => {
    const sim = newSim();
    hold(sim, stick(127, 0, BTN_ATTACK), 1);
    hold(sim, A, charge.frame + 20);
    expect(sim.state.actionFrame[0]).toBe(charge.frame - 1);
    hold(sim, A, smash.totalFrames + charge.maxFrames - 1 - (charge.frame + 20));
    expect(sim.state.action[0]).toBe(A_ATTACK);
    expect(sim.state.charge[0]).toBe(charge.maxFrames);
    hold(sim, A, 1);
    expect(sim.state.action[0]).toBe(A_IDLE);
  });

  it('repart dès que le bouton est relâché', () => {
    const sim = newSim();
    hold(sim, stick(127, 0, BTN_ATTACK), 1);
    hold(sim, A, 13);
    hold(sim, NEUTRAL, 1);
    expect(sim.state.charge[0]).toBe(10);
    expect(sim.state.actionFrame[0]).toBe(charge.frame);
  });

  it('se charge aussi au stick droit', () => {
    const sim = newSim();
    hold(sim, press(BTN_CSTICK_RIGHT), 30);
    expect(sim.state.move[0]).toBe(M_FSMASH);
    expect(sim.state.charge[0]).toBe(30 - (charge.frame - 1));
  });
});

describe('atterrissage pendant une attaque aérienne', () => {
  it('impose le lag d’atterrissage de l’attaque', () => {
    const sim = newSim();
    teleportAir(sim, 0, 0, 3);
    hold(sim, stick(60, 0, BTN_ATTACK), 1);
    expect(sim.state.move[0]).toBe(M_FAIR);
    let guard = 0;
    while (sim.state.grounded[0] === 0 && guard++ < 60) hold(sim, NEUTRAL, 1);
    const lag = move(M_FAIR).landingLag!;
    expect(sim.state.action[0]).toBe(A_LAND);
    expect(sim.state.landLag[0]).toBe(lag);
    hold(sim, NEUTRAL, lag - 1);
    expect(sim.state.action[0]).toBe(A_LAND);
    hold(sim, NEUTRAL, 1);
    expect(sim.state.action[0]).toBe(A_IDLE);
  });

  it('garde le lag normal sans attaque', () => {
    const sim = newSim();
    teleportAir(sim, 0, 0, 3);
    let guard = 0;
    while (sim.state.grounded[0] === 0 && guard++ < 60) hold(sim, NEUTRAL, 1);
    expect(sim.state.landLag[0]).toBe(F.landFrames);
  });
});

describe('second combattant, aux données très différentes', () => {
  const heavySim = () => createSim({ stage: TEST_STAGE, fighters: [TEST_HEAVY, F], seed: 1 });

  it('utilise ses propres durées d’attaque', () => {
    const sim = heavySim();
    const total = TEST_HEAVY.moves[M_JAB]!.totalFrames;
    hold(sim, A, 1);
    hold(sim, NEUTRAL, total - 1);
    expect(sim.state.action[0]).toBe(A_ATTACK);
    hold(sim, NEUTRAL, 1);
    expect(sim.state.action[0]).toBe(A_IDLE);
  });

  it('n’a pas de suite de jab : un second appui relance un jab après la fin', () => {
    const sim = heavySim();
    hold(sim, A, 1);
    hold(sim, NEUTRAL, 10);
    hold(sim, A, 1);
    expect(sim.state.move[0]).toBe(M_JAB);
    expect(sim.state.actionFrame[0]).toBe(12);
  });

  it('a son propre pré-saut et deux sauts aériens', () => {
    const sim = heavySim();
    hold(sim, JUMP, TEST_HEAVY.jumpSquatFrames);
    expect(sim.state.grounded[0]).toBe(1);
    hold(sim, JUMP, 1);
    expect(sim.state.grounded[0]).toBe(0);
    expect(sim.state.jumpsLeft[0]).toBe(2);
  });

  it('ignore les emplacements qu’il ne définit pas', () => {
    const sim = heavySim();
    hold(sim, stick(0, 127, BTN_ATTACK), 2);
    expect(sim.state.action[0]).not.toBe(A_ATTACK);
  });
});
