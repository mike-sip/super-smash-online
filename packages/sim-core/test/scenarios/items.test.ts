import { describe, expect, it } from 'vitest';
import { A_ATTACK, A_DEAD, A_ITEM_SWING, A_ITEM_THROW, A_LEDGE } from '../../src/actions.ts';
import type { StageDef } from '../../src/defs.ts';
import { fx } from '../../src/fixed.ts';
import {
  BTN_ATTACK,
  BTN_GRAB,
  EV_HEAL,
  EV_HIT,
  EV_ITEM_BREAK,
  EV_ITEM_PICKUP,
  EV_ITEM_THROW,
  MAX_ENTITIES,
  createEntityView,
  createSim,
  readEntity,
  spawnEntity,
  type Sim,
} from '../../src/index.ts';
import { ITEM_MODE_FREE, ITEM_MODE_HELD, ITEM_MODE_THROWN } from '../../src/systems/items.ts';
import { TEST_FIGHTER as F, TEST_STAGE } from '../../src/testing/fixtures.ts';
import {
  NEUTRAL,
  countEvents,
  hold,
  hold2,
  holdUntil,
  place,
  press,
  stick,
  teleportAir,
} from './helpers.ts';
import {
  BOMB,
  HEAL,
  ITEM_STAGE,
  K_BOMB,
  K_BOOM,
  K_HEAL,
  K_ROCK,
  K_STICK,
  ROCK,
  itemConfig,
  itemSim,
} from './item-fixtures.ts';

const ATTACK = press(BTN_ATTACK);
const GRAB = press(BTN_GRAB);

/** Pose un objet libre au sol (y = 0) ou en l'air, et renvoie son emplacement. */
function put(sim: Sim, kind: number, x: number, y = 0): number {
  const r = sim.entityDefs[kind - 1]!.radius;
  const e = spawnEntity(sim, kind, -1, fx(x), fx(y) + r, 0, 0);
  expect(e).toBeGreaterThanOrEqual(0);
  return e;
}

/** Joueur 0 au centre, tourné vers la droite ; joueur 1 loin à gauche, pour qu'il ne gêne pas. */
function apart(sim: Sim): void {
  place(sim, 0, 0, 1);
  place(sim, 1, -55, 1);
}

/** Ramasse un objet posé juste devant le joueur 0, et renvoie son emplacement. */
function pickUp(sim: Sim, kind: number): number {
  apart(sim);
  place(sim, 0, 0, 1);
  const e = put(sim, kind, 2);
  hold(sim, NEUTRAL, 2);
  hold(sim, ATTACK, 1);
  expect(sim.state.held[0]).toBe(e + 1);
  hold(sim, NEUTRAL, 1);
  return e;
}

const view = createEntityView();
function count(sim: Sim, kind: number): number {
  let n = 0;
  for (let e = 0; e < MAX_ENTITIES; e++) if (readEntity(sim, e, view) && view.kind === kind) n++;
  return n;
}

describe('objets libres', () => {
  it('tombent et se posent sur une plateforme fine', () => {
    const sim = itemSim();
    apart(sim);
    const e = put(sim, K_ROCK, 30, 35);
    hold(sim, NEUTRAL, 60);
    expect(sim.state.eSurface[e]).toBe(TEST_STAGE.solids.length + 2);
    expect(sim.state.ePosY[e]).toBe(fx(20) + ROCK.radius);
    expect(sim.state.eMode[e]).toBe(ITEM_MODE_FREE);
    expect(sim.state.eVelY[e]).toBe(0);
  });

  it('sont portés par une plateforme mobile', () => {
    const stage: StageDef = {
      ...ITEM_STAGE,
      platforms: [
        {
          x1: fx(-15),
          x2: fx(15),
          y: fx(60),
          motion: { dx: fx(40), dy: fx(0), period: 240, phase: 0 },
        },
      ],
    };
    const sim = createSim({ ...itemConfig(2), stage });
    apart(sim);
    const e = put(sim, K_ROCK, 0, 62);
    hold(sim, NEUTRAL, 10);
    expect(sim.state.eSurface[e]).toBe(2);
    hold(sim, NEUTRAL, 110);
    // La plateforme a avancé de près de 40 : l'objet aussi.
    expect(sim.state.ePosX[e]!).toBeGreaterThan(fx(35));
    expect(sim.state.ePosY[e]).toBe(fx(60) + ROCK.radius);
  });

  it('disparaissent au bout de leur durée de vie, ou hors des zones limites', () => {
    const sim = itemSim();
    apart(sim);
    put(sim, K_ROCK, 30);
    hold(sim, NEUTRAL, ROCK.lifetime - 2);
    expect(count(sim, K_ROCK)).toBe(1);
    hold(sim, NEUTRAL, 3);
    expect(count(sim, K_ROCK)).toBe(0);

    const fall = itemSim();
    apart(fall);
    put(fall, K_ROCK, 100, 10);
    hold(fall, NEUTRAL, 200);
    expect(count(fall, K_ROCK)).toBe(0);
  });
});

describe('ramasser, lancer, frapper', () => {
  it('ramasse un objet à portée au lieu d’attaquer', () => {
    const sim = itemSim();
    apart(sim);
    const e = put(sim, K_ROCK, 4);
    hold(sim, NEUTRAL, 2);
    hold(sim, ATTACK, 1);
    expect(countEvents(sim, EV_ITEM_PICKUP)).toBe(1);
    expect(sim.state.held[0]).toBe(e + 1);
    expect(sim.state.eMode[e]).toBe(ITEM_MODE_HELD);
    expect(sim.state.action[0]).not.toBe(A_ATTACK);
  });

  it('attaque normalement si l’objet est hors de portée', () => {
    const sim = itemSim();
    apart(sim);
    put(sim, K_ROCK, 25);
    hold(sim, NEUTRAL, 2);
    hold(sim, ATTACK, 1);
    expect(sim.state.held[0]).toBe(0);
    expect(sim.state.action[0]).toBe(A_ATTACK);
  });

  it('ne ramasse pas un objet de soin : il se prend au contact', () => {
    const sim = itemSim();
    apart(sim);
    sim.state.damage[0] = fx(30);
    put(sim, K_HEAL, 1);
    hold(sim, NEUTRAL, 1);
    expect(countEvents(sim, EV_HEAL)).toBe(1);
    expect(sim.state.damage[0]).toBe(fx(18));
    expect(count(sim, K_HEAL)).toBe(0);
    expect(sim.state.held[0]).toBe(0);
  });

  it('garde l’objet tenu devant lui pendant qu’il se déplace', () => {
    const sim = itemSim();
    const e = pickUp(sim, K_ROCK);
    hold(sim, stick(60), 30);
    const s = sim.state;
    expect(s.posX[0]!).toBeGreaterThan(fx(5));
    expect(s.ePosX[e]! - s.posX[0]!).toBe(s.facing[0]! * (F.halfWidth + ROCK.radius));
    expect(s.ePosY[e]).toBe(s.posY[0]! + (F.height >> 1));
  });

  it('lance vers l’avant au bouton de saisie, puis l’objet vole', () => {
    const sim = itemSim();
    const e = pickUp(sim, K_ROCK);
    hold(sim, GRAB, 1);
    expect(sim.state.action[0]).toBe(A_ITEM_THROW);
    let thrown = 0;
    for (let f = 0; f < 5; f++) {
      hold(sim, NEUTRAL, 1);
      thrown += countEvents(sim, EV_ITEM_THROW);
    }
    expect(thrown).toBe(1);
    expect(sim.state.held[0]).toBe(0);
    expect(sim.state.eMode[e]).toBe(ITEM_MODE_THROWN);
    expect(sim.state.eOwner[e]).toBe(1);
    expect(sim.state.eVelX[e]!).toBeGreaterThan(fx(2.5));
  });

  it('lance dans les quatre directions', () => {
    const throwWith = (input: number): Sim => {
      const sim = itemSim();
      pickUp(sim, K_ROCK);
      hold(sim, input, 1);
      hold(sim, NEUTRAL, 6);
      return sim;
    };
    const e = (sim: Sim): number => sim.state.held[0]! - 1;
    const up = throwWith(stick(0, 127, BTN_GRAB));
    const slot = (sim: Sim): number => {
      for (let k = 0; k < MAX_ENTITIES; k++) if (sim.state.eKind[k] === K_ROCK) return k;
      return -1;
    };
    expect(e(up)).toBe(-1);
    expect(up.state.eVelY[slot(up)]!).toBeGreaterThan(fx(2));
    expect(up.state.eVelX[slot(up)]).toBe(0);

    const back = throwWith(stick(-127, 0, BTN_GRAB));
    expect(back.state.eVelX[slot(back)]!).toBeLessThan(fx(-2.5));
    expect(back.state.facing[0]).toBe(-1);

    // Au sol, vers le bas : l'objet est simplement posé.
    const down = throwWith(stick(0, -127, BTN_GRAB));
    expect(down.state.eMode[slot(down)]).toBe(ITEM_MODE_FREE);
    expect(down.state.eVelX[slot(down)]).toBe(0);
  });

  it('lance aussi en l’air, vers le bas', () => {
    const sim = itemSim();
    pickUp(sim, K_ROCK);
    // Loin des plateformes, pour que l'objet descende jusqu'au sol.
    teleportAir(sim, 0, 50, 40);
    hold(sim, stick(0, -127, BTN_GRAB), 1);
    expect(sim.state.action[0]).toBe(A_ITEM_THROW);
    hold(sim, NEUTRAL, 5);
    let slot = -1;
    for (let k = 0; k < MAX_ENTITIES; k++) if (sim.state.eKind[k] === K_ROCK) slot = k;
    expect(sim.state.eMode[slot]).toBe(ITEM_MODE_THROWN);
    expect(sim.state.eVelY[slot]!).toBeLessThan(fx(-2));
  });

  it('lance un objet à lancer au bouton d’attaque', () => {
    const sim = itemSim();
    pickUp(sim, K_ROCK);
    hold(sim, ATTACK, 1);
    expect(sim.state.action[0]).toBe(A_ITEM_THROW);
  });

  it('le galet lancé blesse l’adversaire et se brise, sans toucher le lanceur', () => {
    const sim = itemSim();
    const e = pickUp(sim, K_ROCK);
    place(sim, 1, 25, -1);
    hold(sim, GRAB, 1);
    let hit = false;
    for (let f = 0; f < 30 && !hit; f++) {
      hold(sim, NEUTRAL, 1);
      hit = countEvents(sim, EV_HIT) > 0;
    }
    expect(hit).toBe(true);
    expect(sim.state.damage[1]).toBe(fx(8));
    expect(sim.state.damage[0]).toBe(0);
    expect(sim.state.eKind[e]).toBe(0);
    expect(countEvents(sim, EV_ITEM_BREAK)).toBe(1);
  });

  it('le bâton lancé blesse puis rebondit et redevient un objet libre', () => {
    const sim = itemSim();
    const e = pickUp(sim, K_STICK);
    place(sim, 1, 25, -1);
    hold(sim, GRAB, 1);
    holdUntil(sim, NEUTRAL, () => sim.state.damage[1]! > 0, 30);
    expect(sim.state.damage[1]).toBe(fx(9));
    expect(sim.state.eKind[e]).toBe(K_STICK);
    expect(sim.state.eMode[e]).toBe(ITEM_MODE_FREE);
  });

  it('un objet lancé qui ne touche personne retombe et se ramasse à nouveau', () => {
    const sim = itemSim();
    const e = pickUp(sim, K_ROCK);
    // Vers le haut : il retombe sur le stage.
    hold(sim, stick(0, 127, BTN_GRAB), 1);
    holdUntil(sim, NEUTRAL, () => sim.state.eSurface[e] !== 0, 120);
    expect(sim.state.eMode[e]).toBe(ITEM_MODE_FREE);
    expect(sim.state.eKind[e]).toBe(K_ROCK);
  });

  it('le bâton tenu remplace l’attaque par son coup', () => {
    const sim = itemSim();
    pickUp(sim, K_STICK);
    place(sim, 1, 9, -1);
    hold(sim, ATTACK, 1);
    expect(sim.state.action[0]).toBe(A_ITEM_SWING);
    holdUntil(sim, NEUTRAL, () => sim.state.damage[1]! > 0, 20);
    expect(sim.state.damage[1]).toBe(fx(12));
    hold(sim, NEUTRAL, 30);
    // Le bâton est toujours en main.
    expect(sim.state.held[0]).not.toBe(0);
  });

  it('lâche l’objet en s’accrochant au rebord, le perd au KO', () => {
    const sim = itemSim();
    const e = pickUp(sim, K_ROCK);
    // Le joueur tombe à côté du rebord droit (x = 60).
    teleportAir(sim, 0, 64, -4);
    holdUntil(sim, NEUTRAL, () => sim.state.action[0] === A_LEDGE, 30);
    expect(sim.state.held[0]).toBe(0);
    expect(sim.state.eMode[e]).toBe(ITEM_MODE_FREE);

    const ko = itemSim();
    const k = pickUp(ko, K_ROCK);
    teleportAir(ko, 0, 0, -78);
    holdUntil(ko, NEUTRAL, () => ko.state.action[0] === A_DEAD, 30);
    expect(ko.state.held[0]).toBe(0);
    expect(ko.state.eKind[k]).toBe(0);
  });

  it('deux joueurs qui ramassent le même objet à la même frame : le plus petit index l’obtient', () => {
    const sim = itemSim();
    place(sim, 0, -3, 1);
    place(sim, 1, 3, -1);
    const e = put(sim, K_ROCK, 0);
    hold(sim, NEUTRAL, 2);
    hold2(sim, ATTACK, ATTACK, 1);
    expect(sim.state.held[0]).toBe(e + 1);
    expect(sim.state.held[1]).toBe(0);
  });
});

describe('soin et explosion', () => {
  it('le soin ne descend pas sous 0 %', () => {
    const sim = itemSim();
    apart(sim);
    sim.state.damage[0] = fx(5);
    put(sim, K_HEAL, 0);
    hold(sim, NEUTRAL, 1);
    expect(sim.state.damage[0]).toBe(0);
    expect(sim.events.b[0]).toBe(Math.round(HEAL.item!.heal! / 4096));
  });

  it('le pétard lancé explose au contact du sol et blesse aussi son lanceur', () => {
    const sim = itemSim();
    pickUp(sim, K_BOMB);
    // Lancer vers le bas en l'air, juste au-dessus du sol : l'explosion englobe le lanceur.
    teleportAir(sim, 0, 0, 6);
    hold(sim, stick(0, -127, BTN_GRAB), 1);
    let boom = false;
    for (let f = 0; f < 20 && !boom; f++) {
      hold(sim, NEUTRAL, 1);
      boom = countEvents(sim, EV_ITEM_BREAK) > 0;
    }
    expect(boom).toBe(true);
    expect(count(sim, K_BOMB)).toBe(0);
    expect(count(sim, K_BOOM)).toBe(1);
    hold(sim, NEUTRAL, 2);
    expect(sim.state.damage[0]).toBe(fx(18));
  });

  it('le pétard lancé explose sur l’adversaire', () => {
    const sim = itemSim();
    pickUp(sim, K_BOMB);
    place(sim, 1, 25, -1);
    hold(sim, GRAB, 1);
    holdUntil(sim, NEUTRAL, () => sim.state.damage[1]! > 0, 30);
    expect(sim.state.damage[1]).toBe(fx(18));
  });

  it('le pétard qui traîne explose à la fin de sa mèche', () => {
    const sim = itemSim();
    apart(sim);
    put(sim, K_BOMB, 40);
    hold(sim, NEUTRAL, BOMB.lifetime - 2);
    expect(count(sim, K_BOOM)).toBe(0);
    hold(sim, NEUTRAL, 3);
    expect(count(sim, K_BOMB)).toBe(0);
    expect(count(sim, K_BOOM)).toBe(1);
  });
});
