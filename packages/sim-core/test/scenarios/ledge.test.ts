import { describe, expect, it } from 'vitest';
import {
  A_AIR,
  A_ATTACK,
  A_HITSTUN,
  A_IDLE,
  A_LEDGE,
  A_LEDGE_GETUP,
  A_LEDGE_ROLL,
} from '../../src/actions.ts';
import { fx } from '../../src/fixed.ts';
import { BTN_ATTACK, BTN_JUMP, BTN_SHIELD, EV_LEDGE, type Sim } from '../../src/index.ts';
import { M_LEDGE_ATTACK } from '../../src/moves.ts';
import {
  LEDGE_COOLDOWN_FRAMES,
  LEDGE_INVULN_FRAMES,
  LEDGE_INVULN_LOSS,
  LEDGE_MAX_HANG_FRAMES,
  LEDGE_MIN_HANG_FRAMES,
} from '../../src/systems/ledge.ts';
import { TEST_FIGHTER as F } from '../../src/testing/fixtures.ts';
import {
  NEUTRAL,
  countEvents,
  hold,
  hold2,
  newSim,
  place,
  press,
  stick,
  teleportAir,
} from './helpers.ts';

// Rebord gauche du bloc principal : (-60, 0). Rebord droit : (60, 0).
const HANG_X = fx(-60) - F.halfWidth;
const HANG_Y = -F.height;

/** Fait tomber le joueur à côté du rebord gauche jusqu'à ce qu'il s'y accroche. */
function fallToLedge(sim: Sim, player = 0, input = NEUTRAL): boolean {
  teleportAir(sim, player, -66, 10);
  const inputs: [number, number] = [NEUTRAL, NEUTRAL];
  inputs[player as 0 | 1] = input;
  for (let f = 0; f < 80; f++) {
    hold2(sim, inputs[0], inputs[1], 1);
    if (sim.state.action[player] === A_LEDGE) return true;
  }
  return false;
}

/** Joueur 0 accroché, après le délai minimal : prêt à choisir une option. */
function hanging(): Sim {
  const sim = newSim();
  expect(fallToLedge(sim)).toBe(true);
  hold(sim, NEUTRAL, LEDGE_MIN_HANG_FRAMES);
  return sim;
}

describe('accroche', () => {
  it('attrape le rebord en tombant à portée, et suspend le combattant face au stage', () => {
    const sim = newSim();
    expect(fallToLedge(sim)).toBe(true);
    const s = sim.state;
    expect(countEvents(sim, EV_LEDGE)).toBe(1);
    expect(s.posX[0]).toBe(HANG_X);
    expect(s.posY[0]).toBe(HANG_Y);
    expect(s.facing[0]).toBe(1);
    expect(s.velY[0]).toBe(0);
    expect(s.jumpsLeft[0]).toBe(F.airJumps);
    expect(s.intangible[0]).toBe(LEDGE_INVULN_FRAMES - 1);

    hold(sim, NEUTRAL, 60);
    expect(s.action[0]).toBe(A_LEDGE);
    expect(s.posY[0]).toBe(HANG_Y);
  });

  it('fonctionne en miroir sur le rebord droit', () => {
    const sim = newSim();
    teleportAir(sim, 0, 66, 10);
    for (let f = 0; f < 80 && sim.state.action[0] !== A_LEDGE; f++) hold(sim, NEUTRAL, 1);
    expect(sim.state.action[0]).toBe(A_LEDGE);
    expect(sim.state.posX[0]).toBe(fx(60) + F.halfWidth);
    expect(sim.state.facing[0]).toBe(-1);
  });

  it('ne s’accroche pas en montant', () => {
    const sim = newSim();
    teleportAir(sim, 0, -66, -8);
    sim.state.velY[0] = fx(2);
    hold(sim, NEUTRAL, 3);
    expect(sim.state.action[0]).toBe(A_AIR);
  });

  it('ne s’accroche pas stick vers le bas', () => {
    const sim = newSim();
    expect(fallToLedge(sim, 0, stick(0, -80))).toBe(false);
  });

  it('ne s’accroche pas hors de portée', () => {
    const sim = newSim();
    teleportAir(sim, 0, -75, 10);
    hold(sim, NEUTRAL, 60);
    expect(sim.state.action[0]).toBe(A_AIR);
    expect(sim.state.posY[0]).toBeLessThan(fx(-20));
  });

  it('refuse un second occupant', () => {
    const sim = newSim();
    expect(fallToLedge(sim, 1)).toBe(true);
    expect(fallToLedge(sim, 0)).toBe(false);
    expect(sim.state.action[1]).toBe(A_LEDGE);
    expect(sim.state.posY[0]).toBeLessThan(fx(-20));
  });
});

describe('options de remontée', () => {
  it('attend le délai minimal avant d’accepter une option', () => {
    const sim = newSim();
    expect(fallToLedge(sim)).toBe(true);
    hold(sim, press(BTN_JUMP), 1);
    hold(sim, NEUTRAL, LEDGE_MIN_HANG_FRAMES + 2);
    expect(sim.state.action[0]).toBe(A_LEDGE);
  });

  it('remonte simplement, stick vers le stage', () => {
    const sim = hanging();
    hold(sim, stick(127), 1);
    expect(sim.state.action[0]).toBe(A_LEDGE_GETUP);
    hold(sim, NEUTRAL, F.ledgeGetupFrames - 1);
    expect(sim.state.action[0]).toBe(A_LEDGE_GETUP);
    hold(sim, NEUTRAL, 1);
    expect(sim.state.action[0]).toBe(A_IDLE);
    expect(sim.state.grounded[0]).toBe(1);
    expect(sim.state.posX[0]).toBe(fx(-60) + F.halfWidth);
    expect(sim.state.posY[0]).toBe(0);
    expect(sim.state.ledge[0]).toBe(0);
  });

  it('remonte aussi stick vers le haut', () => {
    const sim = hanging();
    hold(sim, stick(0, 127), 1);
    expect(sim.state.action[0]).toBe(A_LEDGE_GETUP);
  });

  it('remonte en roulade sur appui bouclier, plus loin sur le stage', () => {
    const sim = hanging();
    hold(sim, press(BTN_SHIELD), 1);
    expect(sim.state.action[0]).toBe(A_LEDGE_ROLL);
    hold(sim, NEUTRAL, F.ledgeRollFrames);
    expect(sim.state.action[0]).toBe(A_IDLE);
    expect(sim.state.posX[0]).toBe(fx(-60) + F.ledgeRollDistance);
  });

  it('remonte en attaquant', () => {
    const sim = hanging();
    hold(sim, press(BTN_ATTACK), 1);
    expect(sim.state.action[0]).toBe(A_ATTACK);
    expect(sim.state.move[0]).toBe(M_LEDGE_ATTACK);
    expect(sim.state.grounded[0]).toBe(1);
    expect(sim.state.posY[0]).toBe(0);
  });

  it('saute depuis le rebord', () => {
    const sim = hanging();
    hold(sim, press(BTN_JUMP), 1);
    expect(sim.state.action[0]).toBe(A_AIR);
    expect(sim.state.velY[0]).toBe(F.jumpVelocity - F.gravity);
    expect(sim.state.ledge[0]).toBe(0);
  });

  it.each([
    ['vers l’extérieur', stick(-127)],
    ['vers le bas', stick(0, -127)],
  ])('lâche prise stick %s, sans se raccrocher aussitôt', (_name, input) => {
    const sim = hanging();
    hold(sim, input, 1);
    expect(sim.state.action[0]).toBe(A_AIR);
    expect(sim.state.ledgeCooldown[0]).toBe(LEDGE_COOLDOWN_FRAMES - 1);
    // Assez longtemps pour retomber sous la portée du rebord, pas assez pour sortir du stage.
    hold(sim, NEUTRAL, LEDGE_COOLDOWN_FRAMES + 5);
    expect(sim.state.action[0]).toBe(A_AIR);
    expect(sim.state.posY[0]).toBeLessThan(fx(-20));
  });

  it('ignore un stick déjà incliné au moment de l’accroche', () => {
    const sim = newSim();
    // Stick vers le haut : c'est une option de remontée, mais il était déjà tenu avant l'accroche.
    expect(fallToLedge(sim, 0, stick(0, 127))).toBe(true);
    hold(sim, stick(0, 127), LEDGE_MIN_HANG_FRAMES + 10);
    expect(sim.state.action[0]).toBe(A_LEDGE);
  });

  it('lâche prise tout seul au bout du temps maximal', () => {
    const sim = newSim();
    expect(fallToLedge(sim)).toBe(true);
    hold(sim, NEUTRAL, LEDGE_MAX_HANG_FRAMES - 1);
    expect(sim.state.action[0]).toBe(A_LEDGE);
    hold(sim, NEUTRAL, 1);
    expect(sim.state.action[0]).toBe(A_AIR);
  });
});

describe('intangibilité au rebord', () => {
  /** Lâche le rebord, puis revient s'y accrocher. */
  function regrab(sim: Sim): void {
    hold(sim, NEUTRAL, LEDGE_MIN_HANG_FRAMES);
    hold(sim, stick(0, -127), 1);
    hold(sim, NEUTRAL, LEDGE_COOLDOWN_FRAMES);
    expect(fallToLedge(sim)).toBe(true);
  }

  it('diminue à chaque nouvelle accroche sans retour au sol', () => {
    const sim = newSim();
    expect(fallToLedge(sim)).toBe(true);
    expect(sim.state.intangible[0]).toBe(LEDGE_INVULN_FRAMES - 1);
    regrab(sim);
    expect(sim.state.intangible[0]).toBe(LEDGE_INVULN_FRAMES - LEDGE_INVULN_LOSS - 1);
    regrab(sim);
    expect(sim.state.intangible[0]).toBe(0);
  });

  it('revient entière après un passage au sol', () => {
    const sim = newSim();
    expect(fallToLedge(sim)).toBe(true);
    regrab(sim);
    hold(sim, NEUTRAL, LEDGE_MIN_HANG_FRAMES);
    hold(sim, stick(127), 1);
    hold(sim, NEUTRAL, F.ledgeGetupFrames + LEDGE_COOLDOWN_FRAMES + 5);
    expect(sim.state.grounded[0]).toBe(1);
    expect(fallToLedge(sim)).toBe(true);
    expect(sim.state.intangible[0]).toBe(LEDGE_INVULN_FRAMES - 1);
  });

  it('protège au début, puis laisse le combattant se faire déloger', () => {
    const sim = newSim();
    place(sim, 1, -55, -1);
    expect(fallToLedge(sim)).toBe(true);

    // Tilt bas du joueur 1, au ras du sol : il atteint le combattant suspendu sous le rebord.
    const dtilt = () => {
      hold2(sim, NEUTRAL, stick(0, -80), 5);
      hold2(sim, NEUTRAL, stick(0, -80, BTN_ATTACK), 1);
      hold2(sim, NEUTRAL, stick(0, -80), 12);
    };
    dtilt();
    expect(sim.state.action[0]).toBe(A_LEDGE);
    expect(sim.state.damage[0]).toBe(0);

    hold2(sim, NEUTRAL, NEUTRAL, LEDGE_INVULN_FRAMES);
    dtilt();
    expect(sim.state.damage[0]).toBeGreaterThan(0);
    expect(sim.state.action[0]).toBe(A_HITSTUN);
    expect(sim.state.ledge[0]).toBe(0);
  });
});
