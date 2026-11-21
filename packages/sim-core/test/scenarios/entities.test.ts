import { describe, expect, it } from 'vitest';
import { A_HITSTUN, A_SHIELDSTUN } from '../../src/actions.ts';
import { fx } from '../../src/fixed.ts';
import {
  BTN_SHIELD,
  BTN_SPECIAL,
  EV_HIT,
  EV_SHIELD,
  MAX_ENTITIES,
  STATE_BYTES,
  checksum,
  events,
  loadState,
  saveState,
  spawnEntity,
  type Sim,
} from '../../src/index.ts';
import { M_NSPECIAL } from '../../src/moves.ts';
import { E_BALL, E_SHOT, TEST_ENTITIES, TEST_FIGHTER as F } from '../../src/testing/fixtures.ts';
import { NEUTRAL, countEvents, hold, hold2, newSim, place, press, stick } from './helpers.ts';

const SHOT = TEST_ENTITIES[E_SHOT - 1]!;
const BALL = TEST_ENTITIES[E_BALL - 1]!;

const alive = (sim: Sim): number => {
  let n = 0;
  for (let e = 0; e < MAX_ENTITIES; e++) if (sim.state.eKind[e] !== 0) n++;
  return n;
};

/** Simulation où les deux joueurs sont loin, pour observer une entité seule. */
function emptyField(): Sim {
  const sim = newSim();
  place(sim, 0, -50, 1);
  place(sim, 1, 50, -1);
  return sim;
}

describe('création et durée de vie', () => {
  it('occupe le premier emplacement libre avec les valeurs données', () => {
    const sim = emptyField();
    const e = spawnEntity(sim, E_SHOT, 0, fx(0), fx(30), fx(1), fx(0));
    expect(e).toBe(0);
    expect(sim.state.eKind[0]).toBe(E_SHOT);
    expect(sim.state.eOwner[0]).toBe(1);
    expect(sim.state.eLife[0]).toBe(SHOT.lifetime);
    expect(spawnEntity(sim, E_SHOT, 0, 0, fx(30), 0, 0)).toBe(1);
  });

  it('avance en ligne droite sans gravité', () => {
    const sim = emptyField();
    spawnEntity(sim, E_SHOT, -1, fx(-20), fx(30), fx(1), fx(0));
    hold(sim, NEUTRAL, 10);
    expect(sim.state.ePosX[0]).toBe(fx(-10));
    expect(sim.state.ePosY[0]).toBe(fx(30));
  });

  it('disparaît à la fin de sa durée de vie', () => {
    const sim = emptyField();
    spawnEntity(sim, E_SHOT, -1, fx(-20), fx(30), 0, 0);
    hold(sim, NEUTRAL, SHOT.lifetime - 1);
    expect(alive(sim)).toBe(1);
    hold(sim, NEUTRAL, 1);
    expect(alive(sim)).toBe(0);
  });

  it('disparaît en sortant des zones limites', () => {
    const sim = emptyField();
    spawnEntity(sim, E_SHOT, -1, fx(140), fx(30), fx(3), 0);
    hold(sim, NEUTRAL, 5);
    expect(alive(sim)).toBe(0);
  });

  it('refuse un type inconnu', () => {
    const sim = emptyField();
    expect(spawnEntity(sim, 99, -1, 0, 0, 0, 0)).toBe(-1);
    expect(spawnEntity(sim, 0, -1, 0, 0, 0, 0)).toBe(-1);
    expect(alive(sim)).toBe(0);
  });
});

describe('réserve fixe', () => {
  it('échoue proprement quand elle est pleine, puis réutilise un emplacement libéré', () => {
    const sim = emptyField();
    for (let k = 0; k < MAX_ENTITIES; k++) {
      expect(spawnEntity(sim, E_SHOT, -1, fx(k - 16), fx(60), 0, 0)).toBe(k);
    }
    expect(spawnEntity(sim, E_SHOT, -1, 0, fx(60), 0, 0)).toBe(-1);
    expect(alive(sim)).toBe(MAX_ENTITIES);
    hold(sim, NEUTRAL, 5);
    expect(alive(sim)).toBe(MAX_ENTITIES);

    sim.state.eKind[7] = 0;
    expect(spawnEntity(sim, E_BALL, -1, 0, fx(60), 0, 0)).toBe(7);
  });
});

describe('collision avec le décor', () => {
  it('détruit un tir qui percute le stage', () => {
    const sim = emptyField();
    spawnEntity(sim, E_SHOT, -1, fx(-70), fx(-10), fx(2), 0);
    hold(sim, NEUTRAL, 3);
    expect(alive(sim)).toBe(1);
    hold(sim, NEUTRAL, 3);
    expect(alive(sim)).toBe(0);
  });

  it('fait rebondir une balle sur le sol, de moins en moins haut, sans jamais le traverser', () => {
    const sim = emptyField();
    spawnEntity(sim, E_BALL, -1, fx(0), fx(20), 0, 0);
    let bounces = 0;
    let wasFalling = false;
    for (let f = 0; f < 200; f++) {
      hold(sim, NEUTRAL, 1);
      expect(sim.state.ePosY[0]).toBeGreaterThanOrEqual(BALL.radius);
      const falling = sim.state.eVelY[0]! < 0;
      if (wasFalling && !falling) bounces++;
      wasFalling = falling;
    }
    expect(bounces).toBeGreaterThanOrEqual(2);
    // Elle finit au repos, posée sur le sol.
    expect(sim.state.ePosY[0]).toBe(BALL.radius);
    expect(sim.state.eVelY[0]).toBe(0);
  });

  it('renvoie une balle qui heurte le flanc du stage', () => {
    const sim = emptyField();
    spawnEntity(sim, E_BALL, -1, fx(-70), fx(-5), fx(2), fx(1));
    hold(sim, NEUTRAL, 6);
    expect(sim.state.eVelX[0]).toBeLessThan(0);
    expect(sim.state.ePosX[0]).toBeLessThan(fx(-60));
  });
});

describe('coups', () => {
  /** Joueur 1 en x = 0, tir venant de la gauche à hauteur de torse. */
  function shotAt(owner: number): Sim {
    const sim = newSim();
    place(sim, 0, -40, 1);
    place(sim, 1, 0, -1);
    spawnEntity(sim, E_SHOT, owner, fx(-10), fx(6), fx(2), 0);
    return sim;
  }

  it('frappe le premier combattant touché, l’éjecte dans son sens de marche, et disparaît', () => {
    const sim = shotAt(0);
    let hits = 0;
    for (let f = 0; f < 10; f++) {
      hold(sim, NEUTRAL, 1);
      if (countEvents(sim, EV_HIT) === 1) {
        hits++;
        expect(events(sim).a[0]).toBe(0);
        expect(events(sim).b[0]).toBe(1);
      }
    }
    expect(hits).toBe(1);
    expect(sim.state.damage[1]).toBe(SHOT.hit!.damage);
    expect(alive(sim)).toBe(0);
    expect(sim.state.action[1]).toBe(A_HITSTUN);
    hold(sim, NEUTRAL, 10);
    expect(sim.state.posX[1]).toBeGreaterThan(0);
  });

  it('éjecte vers la gauche quand il vient de la droite', () => {
    const sim = newSim();
    place(sim, 0, -40, 1);
    place(sim, 1, 0, -1);
    spawnEntity(sim, E_SHOT, 0, fx(10), fx(6), fx(-2), 0);
    hold(sim, NEUTRAL, 20);
    expect(sim.state.posX[1]).toBeLessThan(0);
  });

  it('épargne son propriétaire', () => {
    const sim = shotAt(1);
    hold(sim, NEUTRAL, 15);
    expect(sim.state.damage[1]).toBe(0);
    expect(alive(sim)).toBe(1);
  });

  it('frappe tout le monde quand il n’a pas de propriétaire', () => {
    const sim = shotAt(-1);
    hold(sim, NEUTRAL, 10);
    expect(sim.state.damage[1]).toBe(SHOT.hit!.damage);
  });

  it('est bloqué par un bouclier, et disparaît quand même', () => {
    const sim = shotAt(0);
    let blocked = 0;
    for (let f = 0; f < 10; f++) {
      hold2(sim, NEUTRAL, press(BTN_SHIELD), 1);
      blocked += countEvents(sim, EV_SHIELD);
    }
    expect(blocked).toBe(1);
    expect(sim.state.damage[1]).toBe(0);
    expect(sim.state.shield[1]).toBeLessThan(F.shieldMax - SHOT.hit!.damage);
    expect([A_SHIELDSTUN, 16]).toContain(sim.state.action[1]);
    expect(alive(sim)).toBe(0);
  });

  it('traverse un combattant intangible sans le toucher', () => {
    const sim = shotAt(0);
    sim.state.intangible[1] = 30;
    hold(sim, NEUTRAL, 15);
    expect(sim.state.damage[1]).toBe(0);
    expect(alive(sim)).toBe(1);
  });

  it('ne touche qu’une fois chaque combattant quand il ne se détruit pas à l’impact', () => {
    const sim = newSim();
    place(sim, 0, -40, 1);
    place(sim, 1, 0, -1);
    // Balle lente, sans propriétaire, qui traverse le joueur 1 pendant de nombreuses frames.
    spawnEntity(sim, E_BALL, -1, fx(-4), fx(8), fx(0.2), fx(0.5));
    let hits = 0;
    for (let f = 0; f < 30; f++) {
      hold(sim, NEUTRAL, 1);
      hits += countEvents(sim, EV_HIT);
    }
    expect(hits).toBe(1);
    expect(sim.state.damage[1]).toBe(BALL.hit!.damage);
    expect(alive(sim)).toBe(1);
  });
});

describe('projectile lancé par une attaque', () => {
  const spawn = F.moves[M_NSPECIAL]!.spawn!;

  it('apparaît à la frame prévue, devant le combattant', () => {
    const sim = emptyField();
    hold(sim, press(BTN_SPECIAL), 1);
    expect(sim.state.move[0]).toBe(M_NSPECIAL);
    hold(sim, NEUTRAL, spawn.frame - 2);
    expect(alive(sim)).toBe(0);
    hold(sim, NEUTRAL, 1);
    expect(alive(sim)).toBe(1);
    expect(sim.state.eOwner[0]).toBe(1);
    expect(sim.state.eVelX[0]).toBe(spawn.velX);
    // Créé pendant la phase de décision, il a déjà avancé d'une frame.
    expect(sim.state.ePosX[0]).toBe(fx(-50) + spawn.x + spawn.velX);
    expect(sim.state.ePosY[0]).toBe(spawn.y);
  });

  it('part dans l’autre sens quand le combattant regarde à gauche', () => {
    const sim = emptyField();
    place(sim, 0, 20, -1);
    hold(sim, press(BTN_SPECIAL), 1);
    hold(sim, NEUTRAL, spawn.frame - 1);
    expect(sim.state.eVelX[0]).toBe(-spawn.velX);
    expect(sim.state.ePosX[0]).toBe(fx(20) - spawn.x - spawn.velX);
  });

  it('touche un adversaire à distance', () => {
    const sim = newSim();
    place(sim, 0, -30, 1);
    place(sim, 1, 10, -1);
    hold(sim, press(BTN_SPECIAL), 1);
    hold(sim, NEUTRAL, 40);
    expect(sim.state.damage[1]).toBe(SHOT.hit!.damage);
  });

  it('n’en crée qu’un par attaque', () => {
    const sim = emptyField();
    hold(sim, press(BTN_SPECIAL), 1);
    hold(sim, stick(0, 0), 25);
    expect(alive(sim)).toBe(1);
  });
});

describe('rollback', () => {
  it('sauvegarde et restaure les entités avec le reste de l’état', () => {
    const sim = emptyField();
    spawnEntity(sim, E_BALL, -1, fx(0), fx(20), fx(0.5), 0);
    hold(sim, NEUTRAL, 10);
    const snap = new Uint8Array(STATE_BYTES);
    saveState(sim, snap);
    hold(sim, NEUTRAL, 40);
    const later = checksum(sim);
    const y = sim.state.ePosY[0];

    loadState(sim, snap);
    hold(sim, NEUTRAL, 40);
    expect(checksum(sim)).toBe(later);
    expect(sim.state.ePosY[0]).toBe(y);
  });
});
