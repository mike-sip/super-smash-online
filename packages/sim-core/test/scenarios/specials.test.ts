/**
 * Extensions demandées par le module `fighters` (SPEC-fighters.md, E1 à E6) : élan d'un coup,
 * chute impuissante, invincibilité, armure, contre, attaque ultime.
 *
 * Le joueur 0 est `TEST_SPECIALIST`, le joueur 1 le combattant de test ordinaire.
 */
import { describe, expect, it } from 'vitest';
import { A_ATTACK, A_HELPLESS, A_HITSTUN, A_IDLE, A_LAND, A_LEDGE } from '../../src/actions.ts';
import { fx } from '../../src/fixed.ts';
import {
  BTN_ATTACK,
  BTN_JUMP,
  BTN_SHIELD,
  BTN_SPECIAL,
  createSim,
  type Sim,
} from '../../src/index.ts';
import { M_DAIR, M_SSPECIAL, M_USPECIAL } from '../../src/moves.ts';
import {
  TEST_ENTITIES,
  TEST_FIGHTER,
  TEST_SPECIALIST,
  TEST_STAGE,
} from '../../src/testing/fixtures.ts';
import { NEUTRAL, hold, hold2, holdUntil, place, press, stick, teleportAir } from './helpers.ts';

const SPECIAL = press(BTN_SPECIAL);
const UP_SPECIAL = stick(0, 127, BTN_SPECIAL);
const SIDE_SPECIAL = stick(127, 0, BTN_SPECIAL);
const JAB = press(BTN_ATTACK);

function specialistSim(): Sim {
  return createSim({
    stage: TEST_STAGE,
    fighters: [TEST_SPECIALIST, TEST_FIGHTER],
    entities: TEST_ENTITIES,
    seed: 1,
  });
}

describe('élan d’un coup (E1)', () => {
  it('impose la vitesse horizontale pendant sa fenêtre, dans le sens du regard', () => {
    const sim = specialistSim();
    const s = sim.state;
    hold(sim, SIDE_SPECIAL, 1);
    expect(s.move[0]).toBe(M_SSPECIAL);
    hold(sim, NEUTRAL, 3);
    const before = s.posX[0]!;
    // Frames 5 à 14 : 2 unités par frame.
    hold(sim, NEUTRAL, 10);
    expect(s.posX[0]! - before).toBe(fx(20));
    expect(s.action[0]).toBe(A_ATTACK);
  });

  it('fait décoller un coup lancé au sol dont la vitesse verticale est positive', () => {
    const sim = specialistSim();
    const s = sim.state;
    hold(sim, UP_SPECIAL, 1);
    expect(s.move[0]).toBe(M_USPECIAL);
    hold(sim, NEUTRAL, 2);
    expect(s.grounded[0]).toBe(1);
    hold(sim, NEUTRAL, 1);
    expect(s.grounded[0]).toBe(0);
    expect(s.action[0]).toBe(A_ATTACK);
    expect(s.jumpsLeft[0]).toBe(TEST_SPECIALIST.airJumps);
    // Frames 4 à 20 : 2,4 unités par frame, sans gravité tant que la fenêtre dure.
    hold(sim, NEUTRAL, 16);
    expect(s.posY[0]).toBe(17 * fx(2.4));
  });

  it('impose la vitesse verticale en l’air, au-delà de la chute maximale', () => {
    const sim = specialistSim();
    const s = sim.state;
    teleportAir(sim, 0, 0, 60);
    hold(sim, stick(0, -127, BTN_ATTACK), 1);
    expect(s.move[0]).toBe(M_DAIR);
    hold(sim, NEUTRAL, 1);
    const y = s.posY[0]!;
    const x = s.posX[0]!;
    hold(sim, NEUTRAL, 8);
    expect(s.posY[0]).toBe(y - 8 * fx(2));
    expect(s.posX[0]).toBe(x + 8 * fx(1));
  });

  it('laisse le contrôle aérien hors de sa fenêtre', () => {
    const sim = specialistSim();
    const s = sim.state;
    teleportAir(sim, 0, 0, 60);
    hold(sim, stick(0, -127, BTN_ATTACK), 1);
    // Frame 2, avant la fenêtre : la dérive au stick s'applique.
    hold(sim, stick(127), 1);
    expect(s.velX[0]).toBe(TEST_SPECIALIST.airAccel);
  });
});

describe('invincibilité d’un coup (E3)', () => {
  /** Le joueur 1 lance un jab qui couvre le joueur 0 aux frames 3 et 4 de son attaque. */
  function jabbedWhile(input0: number): Sim {
    const sim = specialistSim();
    place(sim, 0, 0, 1);
    place(sim, 1, 6, -1);
    hold2(sim, NEUTRAL, JAB, 1);
    hold2(sim, NEUTRAL, NEUTRAL, 1);
    // Frame 3 du jab : le joueur 0 lance son coup à cette même frame.
    hold2(sim, input0, NEUTRAL, 1);
    hold2(sim, NEUTRAL, NEUTRAL, 1);
    return sim;
  }

  it('protège dès la première frame du coup', () => {
    const sim = jabbedWhile(UP_SPECIAL);
    expect(sim.state.damage[0]).toBe(0);
  });

  it('ne protège pas un coup qui n’en a pas', () => {
    const sim = jabbedWhile(SPECIAL);
    expect(sim.state.damage[0]).toBeGreaterThan(0);
  });
});

describe('chute impuissante (E2)', () => {
  /**
   * Fente lancée en l'air, assez haut pour finir avant de toucher le sol, et assez à gauche pour
   * que l'élan gardé ensuite ne fasse pas sortir du stage avant l'atterrissage.
   */
  function helplessSim(): Sim {
    const sim = specialistSim();
    teleportAir(sim, 0, -50, 110);
    hold(sim, SIDE_SPECIAL, 1);
    hold(sim, NEUTRAL, TEST_SPECIALIST.moves[M_SSPECIAL]!.totalFrames);
    return sim;
  }

  it('suit un coup qui en déclare une, terminé en l’air', () => {
    const sim = helplessSim();
    expect(sim.state.action[0]).toBe(A_HELPLESS);
    expect(sim.state.grounded[0]).toBe(0);
  });

  it('interdit sauts, attaques et esquives', () => {
    const sim = helplessSim();
    const s = sim.state;
    const jumps = s.jumpsLeft[0]!;
    hold(sim, press(BTN_JUMP), 1);
    expect(s.jumpsLeft[0]).toBe(jumps);
    hold(sim, NEUTRAL, 1);
    hold(sim, JAB, 1);
    hold(sim, NEUTRAL, 1);
    hold(sim, SPECIAL, 1);
    hold(sim, NEUTRAL, 1);
    hold(sim, press(BTN_SHIELD), 1);
    expect(s.action[0]).toBe(A_HELPLESS);
    expect(s.velY[0]).toBeLessThan(0);
  });

  it('laisse dériver au stick', () => {
    const sim = helplessSim();
    const s = sim.state;
    // L'élan de la fente porte encore vers la droite ; le stick à gauche le freine.
    const before = s.velX[0]!;
    hold(sim, stick(-127), 3);
    expect(s.velX[0]).toBe(before - 3 * TEST_SPECIALIST.airAccel);
  });

  it('se termine à l’atterrissage, avec le lag d’atterrissage du coup', () => {
    const sim = helplessSim();
    const s = sim.state;
    // Stick à gauche : ramène au-dessus du stage malgré l'élan de la fente.
    holdUntil(sim, stick(-127), () => s.grounded[0] === 1);
    expect(s.action[0]).toBe(A_LAND);
    expect(s.landLag[0]).toBe(TEST_SPECIALIST.moves[M_SSPECIAL]!.landingLag);
  });

  it('permet de s’accrocher au rebord', () => {
    const sim = specialistSim();
    const s = sim.state;
    // Sous le rebord droit (x = 60, y = 0), à l'extérieur du stage.
    teleportAir(sim, 0, 66, -30);
    hold(sim, UP_SPECIAL, 1);
    let helpless = false;
    holdUntil(sim, NEUTRAL, () => {
      helpless ||= s.action[0] === A_HELPLESS;
      return s.action[0] === A_LEDGE;
    });
    expect(helpless).toBe(true);
  });

  it('prend fin si le combattant est frappé', () => {
    const sim = specialistSim();
    const s = sim.state;
    place(sim, 1, 6, -1);
    teleportAir(sim, 0, 0, 2);
    s.action[0] = A_HELPLESS;
    hold2(sim, NEUTRAL, JAB, 3);
    expect(s.action[0]).toBe(A_HITSTUN);
  });

  it('n’a pas lieu si le coup se termine au sol', () => {
    const sim = specialistSim();
    hold(sim, SIDE_SPECIAL, 1);
    hold(sim, NEUTRAL, TEST_SPECIALIST.moves[M_SSPECIAL]!.totalFrames);
    expect(sim.state.action[0]).toBe(A_IDLE);
  });
});
