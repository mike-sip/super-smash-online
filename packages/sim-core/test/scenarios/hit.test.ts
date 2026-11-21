import { describe, expect, it } from 'vitest';
import { A_ATTACK, A_DEAD, A_HITSTUN } from '../../src/actions.ts';
import { fx, fxMul } from '../../src/fixed.ts';
import { BTN_ATTACK, EV_HIT, events, type Sim } from '../../src/index.ts';
import { M_FTILT, M_JAB2, M_JAB3 } from '../../src/moves.ts';
import { hitlagFrames } from '../../src/systems/knockback.ts';
import { TEST_FIGHTER as F } from '../../src/testing/fixtures.ts';
import {
  NEUTRAL,
  countEvents,
  hold,
  hold2,
  holdAll,
  newSim,
  place,
  press,
  stick,
} from './helpers.ts';

const A = press(BTN_ATTACK);
const JAB_DAMAGE = fx(3);

/** Joueur 0 en x = 0 tourné vers la droite, joueur 1 à `distance` devant lui. */
function duel(distance: number, players = 2): Sim {
  const sim = newSim(players);
  place(sim, 0, 0, 1);
  place(sim, 1, distance, -1);
  return sim;
}

/** Joue `frames` frames et renvoie le nombre total de coups portés. */
function playCounting(sim: Sim, input0: number, frames: number): number {
  let hits = 0;
  for (let f = 0; f < frames; f++) {
    hold(sim, input0, 1);
    hits += countEvents(sim, EV_HIT);
  }
  return hits;
}

/** Lance un tilt avant sans marcher au préalable. */
function ftilt(sim: Sim): void {
  sim.state.tilt[0] = 10;
  hold(sim, stick(60, 0, BTN_ATTACK), 1);
  expect(sim.state.move[0]).toBe(M_FTILT);
}

describe('contact', () => {
  it('touche à la première frame active, pas avant', () => {
    const sim = duel(7);
    hold(sim, A, 1);
    hold(sim, NEUTRAL, 1);
    expect(sim.state.damage[1]).toBe(0);
    expect(events(sim).count).toBe(0);

    hold(sim, NEUTRAL, 1);
    const q = events(sim);
    expect(q.count).toBe(1);
    expect(q.type[0]).toBe(EV_HIT);
    expect(q.a[0]).toBe(0);
    expect(q.b[0]).toBe(1);
    expect(sim.state.damage[1]).toBe(JAB_DAMAGE);
    expect(sim.state.action[1]).toBe(A_HITSTUN);
    expect(sim.state.connected[0]).toBe(1);
  });

  it('manque une cible hors de portée', () => {
    const sim = duel(12);
    expect(playCounting(sim, A, 1) + playCounting(sim, NEUTRAL, 20)).toBe(0);
    expect(sim.state.damage[1]).toBe(0);
    expect(sim.state.damage[0]).toBe(0);
  });

  it('ne touche qu’une fois par attaque, même si la hitbox reste active', () => {
    const sim = duel(7);
    expect(playCounting(sim, A, 1) + playCounting(sim, NEUTRAL, 30)).toBe(1);
    expect(sim.state.damage[1]).toBe(JAB_DAMAGE);
  });

  it('suit l’orientation de l’attaquant', () => {
    const behind = newSim();
    place(behind, 0, 0, -1);
    place(behind, 1, 7, -1);
    expect(playCounting(behind, A, 1) + playCounting(behind, NEUTRAL, 20)).toBe(0);

    const front = newSim();
    place(front, 0, 0, -1);
    place(front, 1, -7, 1);
    expect(playCounting(front, A, 1) + playCounting(front, NEUTRAL, 20)).toBe(1);
  });

  it('ignore un joueur mort', () => {
    const sim = duel(7);
    sim.state.action[1] = A_DEAD;
    expect(playCounting(sim, A, 1) + playCounting(sim, NEUTRAL, 20)).toBe(0);
  });

  it('atteint toute la longueur d’une hitbox en capsule', () => {
    const near = duel(14);
    hold(near, stick(127, 0, BTN_ATTACK), 1);
    expect(playCounting(near, NEUTRAL, 20)).toBe(1);

    const far = duel(16);
    hold(far, stick(127, 0, BTN_ATTACK), 1);
    expect(playCounting(far, NEUTRAL, 20)).toBe(0);
  });
});

describe('priorité entre hitbox', () => {
  it('applique la première hitbox de la liste quand plusieurs touchent', () => {
    const sim = duel(8);
    ftilt(sim);
    hold(sim, NEUTRAL, 10);
    expect(sim.state.damage[1]).toBe(fx(12));
  });

  it('applique la suivante quand la première ne touche pas', () => {
    const sim = duel(14);
    ftilt(sim);
    hold(sim, NEUTRAL, 10);
    expect(sim.state.damage[1]).toBe(fx(9));
  });
});

describe('coups multiples', () => {
  it('touche une fois par groupe', () => {
    const sim = duel(5);
    hold(sim, stick(0, -127, BTN_ATTACK), 1);
    expect(playCounting(sim, NEUTRAL, 40)).toBe(2);
    expect(sim.state.damage[1]).toBe(fx(5 + 8));
  });

  it('laisse la victime au sol après un coup sans éjection', () => {
    const sim = duel(5);
    hold(sim, stick(0, -127, BTN_ATTACK), 1);
    for (let f = 0; f < 12; f++) {
      hold(sim, NEUTRAL, 1);
      expect(sim.state.grounded[1]).toBe(1);
    }
    expect(sim.state.damage[1]).toBe(fx(5));
  });
});

describe('hitlag', () => {
  it('gèle l’attaquant et la victime, puis éjecte la victime', () => {
    const sim = duel(7);
    hold(sim, A, 1);
    hold(sim, NEUTRAL, 2);
    const lag = hitlagFrames(JAB_DAMAGE);
    expect(sim.state.hitlag[0]).toBe(lag);
    expect(sim.state.hitlag[1]).toBe(lag);
    const frame = sim.state.actionFrame[0];
    const x1 = sim.state.posX[1];

    hold(sim, NEUTRAL, lag);
    expect(sim.state.actionFrame[0]).toBe(frame);
    expect(sim.state.posX[1]).toBe(x1);
    expect(sim.state.posY[1]).toBe(0);
    // L'éjection est calculée à la dernière frame de gel et s'applique à la suivante.
    expect(sim.state.velY[1]).toBeGreaterThan(0);

    hold(sim, NEUTRAL, 1);
    expect(sim.state.actionFrame[0]).toBe(frame! + 1);
    expect(sim.state.posY[1]).toBeGreaterThan(0);
    expect(sim.state.posX[1]).toBeGreaterThan(x1!);
  });

  it('dure plus longtemps pour un coup plus fort', () => {
    expect(hitlagFrames(fx(16))).toBeGreaterThan(hitlagFrames(JAB_DAMAGE));
  });
});

describe('attaque chargée', () => {
  it('inflige les dégâts multipliés à pleine charge', () => {
    const sim = duel(10);
    hold(sim, stick(127, 0, BTN_ATTACK), 1);
    hold(sim, A, 80);
    expect(sim.state.damage[1]).toBe(fxMul(fx(16), F.moves[7]!.charge!.maxScale));
  });

  it('inflige les dégâts de base sans charge', () => {
    const sim = duel(10);
    hold(sim, stick(127, 0, BTN_ATTACK), 1);
    hold(sim, NEUTRAL, 20);
    expect(sim.state.damage[1]).toBe(fx(16));
  });
});

describe('annulation réservée aux coups qui ont touché', () => {
  /** Martèle le bouton d'attaque et renvoie l'emplacement le plus avancé atteint. */
  function mash(sim: Sim): number {
    let furthest = 0;
    for (let f = 0; f < 70; f++) {
      hold(sim, f % 3 === 0 ? A : NEUTRAL, 1);
      if (sim.state.action[0] === A_ATTACK) furthest = Math.max(furthest, sim.state.move[0]!);
    }
    return furthest;
  }

  it('va jusqu’au jab 3 quand le jab 2 touche', () => {
    const sim = duel(7);
    expect(mash(sim)).toBe(M_JAB3);
    expect(sim.state.damage[1]).toBeGreaterThanOrEqual(fx(3 + 4));
  });

  it('s’arrête au jab 2 dans le vide', () => {
    expect(mash(duel(40))).toBe(M_JAB2);
  });
});

describe('coups simultanés', () => {
  /** Deux joueurs face à face se frappent à la même frame. */
  function trade(first: number, second: number, players: number): Sim {
    const sim = newSim(players);
    for (let p = 0; p < players; p++) place(sim, p, 40 + p * 2, 1);
    place(sim, first, -3.5, 1);
    place(sim, second, 3.5, -1);
    const inputs = new Array<number>(players).fill(NEUTRAL);
    inputs[first] = A;
    inputs[second] = A;
    holdAll(sim, inputs, 1);
    holdAll(sim, new Array<number>(players).fill(NEUTRAL), 40);
    return sim;
  }

  it('fait porter les deux coups, avec un résultat parfaitement symétrique', () => {
    const { state: s } = trade(0, 1, 2);
    expect(s.damage[0]).toBe(JAB_DAMAGE);
    expect(s.damage[1]).toBe(JAB_DAMAGE);
    expect(s.posX[0]).toBe(-s.posX[1]!);
    expect(s.posY[0]).toBe(s.posY[1]);
    expect(s.velX[0]! + s.velX[1]!).toBe(0);
    expect(s.action[0]).toBe(s.action[1]);
  });

  it('ne dépend ni de l’index des joueurs ni de leur ordre', () => {
    const ref = trade(0, 1, 2).state;
    const swapped = trade(1, 0, 2).state;
    const late = trade(5, 2, 6).state;
    expect(swapped.posX[1]).toBe(ref.posX[0]);
    expect(swapped.posX[0]).toBe(ref.posX[1]);
    expect(late.posX[5]).toBe(ref.posX[0]);
    expect(late.posX[2]).toBe(ref.posX[1]);
    expect(late.damage[5]).toBe(ref.damage[0]);
    expect(late.posY[2]).toBe(ref.posY[1]);
  });

  it('additionne les dégâts de deux attaquants sur la même victime', () => {
    const sim = newSim(3);
    place(sim, 0, -7, 1);
    place(sim, 1, 0, 1);
    place(sim, 2, 7, -1);
    holdAll(sim, [A, NEUTRAL, A], 1);
    holdAll(sim, [NEUTRAL, NEUTRAL, NEUTRAL], 2);
    expect(countEvents(sim, EV_HIT)).toBe(2);
    expect(sim.state.damage[1]).toBe(fx(6));
    expect(sim.state.damage[0]).toBe(0);
    expect(sim.state.damage[2]).toBe(0);
  });
});

describe('joueur 1 piloté', () => {
  it('peut frapper lui aussi', () => {
    const sim = duel(7);
    hold2(sim, NEUTRAL, A, 1);
    hold2(sim, NEUTRAL, NEUTRAL, 2);
    expect(sim.state.damage[0]).toBe(JAB_DAMAGE);
    expect(sim.state.damage[1]).toBe(0);
  });
});
