import { describe, expect, it } from 'vitest';
import {
  A_AIR,
  A_AIRDODGE,
  A_IDLE,
  A_JUMPSQUAT,
  A_LAND,
  A_ROLL,
  A_SHIELD,
  A_SHIELDSTUN,
  A_SHIELD_BREAK,
  A_SHIELD_DROP,
  A_SPOTDODGE,
  A_TUMBLE,
} from '../../src/actions.ts';
import { fx } from '../../src/fixed.ts';
import {
  BTN_ATTACK,
  BTN_JUMP,
  BTN_SHIELD,
  EV_HIT,
  EV_PARRY,
  EV_SHIELD,
  EV_SHIELD_BREAK,
  type Sim,
} from '../../src/index.ts';
import {
  PARRY_ATTACKER_LAG,
  SHIELD_BREAK_FRAMES,
  SHIELD_BREAK_RESTORE,
  SHIELD_DRAIN,
  SHIELD_DROP_FRAMES,
  SHIELD_REGEN,
} from '../../src/systems/defense.ts';
import { hitlagFrames } from '../../src/systems/knockback.ts';
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

const A = press(BTN_ATTACK);
const SH = press(BTN_SHIELD);
const JAB_DAMAGE = fx(3);

/** Joueur 0 en x = 0 tourné vers la droite, joueur 1 à portée de jab. */
function duel(): Sim {
  const sim = newSim();
  place(sim, 0, 0, 1);
  place(sim, 1, 7, -1);
  return sim;
}

/** Joue `frames` frames et compte les événements d'un type. */
function count2(sim: Sim, in0: number, in1: number, frames: number, type: number): number {
  let n = 0;
  for (let f = 0; f < frames; f++) {
    hold2(sim, in0, in1, 1);
    n += countEvents(sim, type);
  }
  return n;
}

describe('bouclier', () => {
  it('se lève tant que le bouton est tenu et s’use à chaque frame', () => {
    const sim = newSim();
    hold(sim, SH, 1);
    expect(sim.state.action[0]).toBe(A_SHIELD);
    expect(sim.state.shield[0]).toBe(F.shieldMax);
    hold(sim, SH, 10);
    expect(sim.state.shield[0]).toBe(F.shieldMax - 10 * SHIELD_DRAIN);
  });

  it('s’abaisse au relâchement, en SHIELD_DROP_FRAMES frames', () => {
    const sim = newSim();
    hold(sim, SH, 10);
    hold(sim, NEUTRAL, 1);
    expect(sim.state.action[0]).toBe(A_SHIELD_DROP);
    hold(sim, NEUTRAL, SHIELD_DROP_FRAMES - 1);
    expect(sim.state.action[0]).toBe(A_SHIELD_DROP);
    hold(sim, NEUTRAL, 1);
    expect(sim.state.action[0]).toBe(A_IDLE);
  });

  it('dure au moins 3 frames, même sur un appui bref', () => {
    const sim = newSim();
    hold(sim, SH, 1);
    hold(sim, NEUTRAL, 2);
    expect(sim.state.action[0]).toBe(A_SHIELD);
    hold(sim, NEUTRAL, 1);
    expect(sim.state.action[0]).toBe(A_SHIELD_DROP);
  });

  it('se régénère une fois baissé, sans dépasser le maximum', () => {
    const sim = newSim();
    sim.state.shield[0] = fx(10);
    hold(sim, NEUTRAL, 100);
    expect(sim.state.shield[0]).toBe(fx(10) + 100 * SHIELD_REGEN);
    hold(sim, NEUTRAL, 2000);
    expect(sim.state.shield[0]).toBe(F.shieldMax);
  });

  it('se brise tout seul s’il est tenu trop longtemps, à une frame précise', () => {
    const sim = newSim();
    const breakFrame = Math.ceil(F.shieldMax / SHIELD_DRAIN) + 1;
    hold(sim, SH, breakFrame - 1);
    expect(sim.state.action[0]).toBe(A_SHIELD);
    hold(sim, SH, 1);
    expect(sim.state.action[0]).toBe(A_SHIELD_BREAK);
    expect(countEvents(sim, EV_SHIELD_BREAK)).toBe(1);
  });

  it('peut être annulé par un saut', () => {
    const sim = newSim();
    hold(sim, SH, 5);
    hold(sim, press(BTN_SHIELD | BTN_JUMP), 1);
    expect(sim.state.action[0]).toBe(A_JUMPSQUAT);
  });
});

describe('blocage', () => {
  it('encaisse le coup à la place du combattant', () => {
    const sim = duel();
    hold2(sim, A, SH, 1);
    hold2(sim, NEUTRAL, SH, 1);
    const before = sim.state.shield[1]!;
    hold2(sim, NEUTRAL, SH, 1);

    expect(countEvents(sim, EV_SHIELD)).toBe(1);
    expect(countEvents(sim, EV_HIT)).toBe(0);
    expect(sim.state.damage[1]).toBe(0);
    expect(sim.state.shield[1]).toBe(before - SHIELD_DRAIN - JAB_DAMAGE);
    expect(sim.state.action[1]).toBe(A_SHIELDSTUN);
    expect(sim.state.velX[1]).toBeGreaterThan(0);
    expect(sim.state.hitlag[0]).toBe(hitlagFrames(JAB_DAMAGE));
    expect(sim.state.hitlag[1]).toBe(hitlagFrames(JAB_DAMAGE));
  });

  it('maintient le bouclier de force quelques frames, puis le rend au joueur', () => {
    const sim = duel();
    hold2(sim, A, SH, 3);
    hold2(sim, NEUTRAL, NEUTRAL, hitlagFrames(JAB_DAMAGE) + 1);
    // Bouton relâché, mais le blocage n'est pas terminé.
    expect(sim.state.action[1]).toBe(A_SHIELDSTUN);
    hold2(sim, NEUTRAL, NEUTRAL, 10);
    expect([A_SHIELD_DROP, A_IDLE]).toContain(sim.state.action[1]);
    expect(sim.state.damage[1]).toBe(0);
  });

  it('se brise sous un coup plus fort que ce qu’il lui reste', () => {
    const sim = duel();
    hold2(sim, NEUTRAL, SH, 1);
    sim.state.shield[1] = fx(2);
    expect(count2(sim, A, SH, 3, EV_SHIELD_BREAK)).toBe(1);
    expect(sim.state.action[1]).toBe(A_SHIELD_BREAK);
    expect(sim.state.damage[1]).toBe(0);
    expect(sim.state.grounded[1]).toBe(0);
  });

  it('laisse le combattant étourdi et vulnérable après un bris', () => {
    const sim = newSim();
    place(sim, 0, 0, 1);
    hold(sim, SH, 1);
    sim.state.shield[0] = SHIELD_DRAIN;
    hold(sim, SH, 1);
    expect(sim.state.action[0]).toBe(A_SHIELD_BREAK);

    let guard = 0;
    while (sim.state.grounded[0] === 0 && guard++ < 200) hold(sim, NEUTRAL, 1);
    hold(sim, stick(127, 0, BTN_JUMP), SHIELD_BREAK_FRAMES - 1);
    expect(sim.state.action[0]).toBe(A_SHIELD_BREAK);
    expect(sim.state.posX[0]).toBe(0);

    hold(sim, NEUTRAL, 1);
    expect(sim.state.action[0]).toBe(A_IDLE);
    expect(sim.state.shield[0]).toBeGreaterThanOrEqual(SHIELD_BREAK_RESTORE);
    expect(sim.state.shield[0]).toBeLessThan(SHIELD_BREAK_RESTORE + fx(1));
  });

  it('ne protège plus pendant l’étourdissement', () => {
    const sim = duel();
    hold2(sim, NEUTRAL, SH, 1);
    sim.state.shield[1] = SHIELD_DRAIN;
    hold2(sim, NEUTRAL, SH, 1);
    let guard = 0;
    while (sim.state.grounded[1] === 0 && guard++ < 200) hold2(sim, NEUTRAL, NEUTRAL, 1);
    place(sim, 1, 7, -1);
    expect(count2(sim, A, NEUTRAL, 5, EV_HIT)).toBe(1);
    expect(sim.state.damage[1]).toBe(JAB_DAMAGE);
  });
});

describe('parade parfaite', () => {
  it('annule le coup reçu juste après avoir relâché le bouclier, et gèle l’attaquant', () => {
    const sim = duel();
    hold2(sim, NEUTRAL, SH, 5);
    const shield = sim.state.shield[1]!;
    hold2(sim, A, NEUTRAL, 2);
    expect(sim.state.action[1]).toBe(A_SHIELD_DROP);
    hold2(sim, NEUTRAL, NEUTRAL, 1);

    expect(countEvents(sim, EV_PARRY)).toBe(1);
    expect(countEvents(sim, EV_HIT)).toBe(0);
    expect(sim.state.damage[1]).toBe(0);
    // Une dernière frame d'usure au relâchement, une frame de régénération une fois libre :
    // les dégâts du jab, eux, ne sont pas retirés.
    expect(sim.state.shield[1]).toBe(shield - SHIELD_DRAIN + SHIELD_REGEN);
    expect(sim.state.action[1]).toBe(A_IDLE);
    expect(sim.state.hitlag[1]).toBe(0);
    expect(sim.state.hitlag[0]).toBe(hitlagFrames(JAB_DAMAGE) + PARRY_ATTACKER_LAG);
  });

  it('échoue si le bouclier a été relâché trop tôt : le coup porte', () => {
    const sim = duel();
    hold2(sim, NEUTRAL, SH, 5);
    hold2(sim, NEUTRAL, NEUTRAL, 4);
    expect(count2(sim, A, NEUTRAL, 1, EV_HIT) + count2(sim, NEUTRAL, NEUTRAL, 2, EV_HIT)).toBe(1);
    expect(sim.state.damage[1]).toBe(JAB_DAMAGE);
  });
});

describe('fenêtre de rétablissement', () => {
  it('ne se rouvre pas en martelant le bouton', () => {
    const sim = newSim();
    hold(sim, SH, 1);
    expect(sim.state.techWindow[0]).toBe(20);
    hold(sim, NEUTRAL, 23);
    expect(sim.state.techWindow[0]).toBe(0);
    hold(sim, SH, 1);
    expect(sim.state.techWindow[0]).toBe(0);
    hold(sim, NEUTRAL, 20);
    hold(sim, SH, 1);
    expect(sim.state.techWindow[0]).toBe(20);
  });
});

describe('esquive sur place', () => {
  const DODGE = stick(0, -127, BTN_SHIELD);

  /** Le joueur 1 lève son bouclier puis esquive ; le joueur 0 lance un jab `delay` frames après. */
  function jabVsDodge(delay: number): Sim {
    const sim = duel();
    hold2(sim, NEUTRAL, SH, 3);
    if (delay >= 0) {
      hold2(sim, delay === 0 ? A : NEUTRAL, DODGE, 1);
      for (let f = 1; f <= delay; f++) hold2(sim, f === delay ? A : NEUTRAL, NEUTRAL, 1);
    } else {
      hold2(sim, A, SH, 1);
      hold2(sim, NEUTRAL, DODGE, 1);
    }
    hold2(sim, NEUTRAL, NEUTRAL, 6);
    return sim;
  }

  it('part d’un coup de stick vers le bas sous bouclier, et dure totalFrames', () => {
    const sim = newSim();
    hold(sim, SH, 3);
    hold(sim, DODGE, 1);
    expect(sim.state.action[0]).toBe(A_SPOTDODGE);
    hold(sim, NEUTRAL, F.spotDodge.totalFrames - 1);
    expect(sim.state.action[0]).toBe(A_SPOTDODGE);
    hold(sim, NEUTRAL, 1);
    expect(sim.state.action[0]).toBe(A_IDLE);
    expect(sim.state.posX[0]).toBe(fx(-35));
  });

  it('laisse passer un coup pendant les frames d’intangibilité', () => {
    const sim = jabVsDodge(0);
    expect(sim.state.damage[1]).toBe(0);
    expect(sim.state.connected[0]).toBe(0);
  });

  it('n’est pas encore intangible à sa frame 2', () => {
    expect(jabVsDodge(-1).state.damage[1]).toBe(JAB_DAMAGE);
  });

  it('n’est plus intangible en fin d’esquive : elle se punit', () => {
    expect(jabVsDodge(16).state.damage[1]).toBe(JAB_DAMAGE);
  });

  it('s’use : une esquive répétée est plus longue et moins intangible, puis récupère', () => {
    const sim = newSim();
    const dodge = () => {
      hold(sim, SH, 3);
      hold(sim, DODGE, 1);
      expect(sim.state.action[0]).toBe(A_SPOTDODGE);
    };
    const full = F.spotDodge.invEnd - F.spotDodge.invStart + 1;

    dodge();
    expect(sim.state.dodgeTotal[0]).toBe(F.spotDodge.totalFrames);
    expect(sim.state.dodgeInv[0]).toBe(full);
    hold(sim, NEUTRAL, F.spotDodge.totalFrames);

    dodge();
    expect(sim.state.dodgeTotal[0]).toBe(F.spotDodge.totalFrames + 3);
    expect(sim.state.dodgeInv[0]).toBe(full - 2);

    hold(sim, NEUTRAL, 300);
    expect(sim.state.dodgeStale[0]).toBe(0);
    dodge();
    expect(sim.state.dodgeTotal[0]).toBe(F.spotDodge.totalFrames);
  });
});

describe('roulade', () => {
  const travel = (F.roll.invEnd - F.roll.invStart + 1) * F.roll.speed;

  it('avance en traversant, et finit retournée', () => {
    const sim = newSim();
    hold(sim, SH, 3);
    hold(sim, stick(127, 0, BTN_SHIELD), 1);
    expect(sim.state.action[0]).toBe(A_ROLL);
    hold(sim, NEUTRAL, F.roll.totalFrames);
    expect(sim.state.action[0]).toBe(A_IDLE);
    expect(sim.state.posX[0]).toBe(fx(-35) + travel);
    expect(sim.state.facing[0]).toBe(-1);
  });

  it('recule sans changer d’orientation', () => {
    const sim = newSim();
    hold(sim, SH, 3);
    hold(sim, stick(-127, 0, BTN_SHIELD), 1);
    hold(sim, NEUTRAL, F.roll.totalFrames);
    expect(sim.state.posX[0]).toBe(fx(-35) - travel);
    expect(sim.state.facing[0]).toBe(1);
  });

  it('s’arrête au bord de la plateforme', () => {
    const sim = newSim();
    place(sim, 0, 55, 1);
    hold(sim, SH, 3);
    hold(sim, stick(127, 0, BTN_SHIELD), 1);
    hold(sim, NEUTRAL, F.roll.totalFrames);
    expect(sim.state.posX[0]).toBe(fx(60));
    expect(sim.state.grounded[0]).toBe(1);
  });

  it('est intangible pendant son déplacement', () => {
    const sim = duel();
    hold2(sim, NEUTRAL, SH, 3);
    // La roulade part une frame avant le jab : sa frame 4, première intangible, tombe sur la
    // première frame active du jab.
    hold2(sim, NEUTRAL, stick(127, 0, BTN_SHIELD), 1);
    hold2(sim, A, NEUTRAL, 1);
    expect(count2(sim, NEUTRAL, NEUTRAL, 10, EV_HIT)).toBe(0);
    expect(sim.state.damage[1]).toBe(0);
  });
});

describe('esquive aérienne', () => {
  /** Joueur 0 très haut au-dessus du sol principal, hors de toute plateforme. */
  function airborne(): Sim {
    const sim = newSim();
    teleportAir(sim, 0, 50, 90);
    return sim;
  }

  it('neutre : conserve l’élan et la gravité', () => {
    const sim = airborne();
    sim.state.velX[0] = fx(1);
    hold(sim, SH, 1);
    expect(sim.state.action[0]).toBe(A_AIRDODGE);
    hold(sim, NEUTRAL, 10);
    expect(sim.state.velX[0]).toBe(fx(1));
    expect(sim.state.velY[0]).toBe(-11 * F.gravity);
  });

  it('directionnelle : part dans la direction du stick, sans gravité au début', () => {
    const sim = airborne();
    hold(sim, stick(127, 0, BTN_SHIELD), 1);
    expect(sim.state.velX[0]).toBe(F.airDodge.speed);
    const y = sim.state.posY[0];
    hold(sim, NEUTRAL, 11);
    expect(sim.state.posY[0]).toBe(y);
    expect(sim.state.posX[0]).toBeGreaterThan(fx(50));
    hold(sim, NEUTRAL, 10);
    expect(sim.state.posY[0]).toBeLessThan(y!);
  });

  it('peut partir vers le haut', () => {
    const sim = airborne();
    hold(sim, stick(0, 127, BTN_SHIELD), 2);
    expect(sim.state.posY[0]).toBeGreaterThan(fx(90));
  });

  it('n’est disponible qu’une fois par envol', () => {
    const sim = airborne();
    hold(sim, SH, 1);
    hold(sim, NEUTRAL, F.airDodge.totalFrames);
    expect(sim.state.action[0]).toBe(A_AIR);
    hold(sim, SH, 1);
    expect(sim.state.action[0]).toBe(A_AIR);

    let guard = 0;
    while (sim.state.grounded[0] === 0 && guard++ < 300) hold(sim, NEUTRAL, 1);
    expect(sim.state.airDodged[0]).toBe(0);
  });

  it('impose son propre lag d’atterrissage', () => {
    const sim = newSim();
    teleportAir(sim, 0, 0, 3);
    hold(sim, SH, 1);
    let guard = 0;
    while (sim.state.grounded[0] === 0 && guard++ < 60) hold(sim, NEUTRAL, 1);
    expect(sim.state.action[0]).toBe(A_LAND);
    expect(sim.state.landLag[0]).toBe(F.airDodgeLandingLag);
    expect(sim.state.intangible[0]).toBe(0);
  });

  it('évite un coup', () => {
    const sim = newSim();
    place(sim, 0, 0, 1);
    teleportAir(sim, 1, 7, 1.5);
    sim.state.velY[1] = fx(0.5);
    hold2(sim, A, SH, 1);
    expect(count2(sim, NEUTRAL, NEUTRAL, 8, EV_HIT)).toBe(0);
  });

  it('est impossible en chute désordonnée : le bouton y sert au rétablissement', () => {
    const sim = airborne();
    sim.state.action[0] = A_TUMBLE;
    hold(sim, SH, 1);
    expect(sim.state.action[0]).toBe(A_TUMBLE);
  });
});
