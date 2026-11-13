/**
 * Test de contrat : les `InputFrame` produits par le module, joués dans la vraie simulation,
 * déclenchent chaque action de `sim-core`. C'est la preuve que tout le jeu est accessible depuis
 * un périphérique, et le filet contre une régression du ressenti.
 */
import { describe, expect, it } from 'vitest';
import {
  A_AIR,
  A_AIRDODGE,
  A_ATTACK,
  A_DASH,
  A_GRAB,
  A_IDLE,
  A_LEDGE,
  A_LEDGE_GETUP,
  A_LEDGE_ROLL,
  A_ROLL,
  A_RUN,
  A_SHIELD,
  A_SPOTDODGE,
  A_WALK,
  M_DASH_ATTACK,
  M_DSMASH,
  M_FSMASH,
  M_FTILT,
  M_JAB,
  M_LEDGE_ATTACK,
  M_NAIR,
  M_NSPECIAL,
  M_USMASH,
  M_UTILT,
  createFighterView,
  createSim,
  fx,
  readFighter,
  step,
} from '@game/sim-core';
import { testConfig } from '@game/sim-core/testing';
import { KEYBOARD_ID, createInput } from '../src/index.ts';
import { fakeWindow } from './helpers.ts';

/** Une simulation à deux joueurs, le joueur 0 piloté au clavier par le module. */
function rig() {
  const sim = createSim(testConfig(2));
  const fake = fakeWindow();
  const input = createInput({ target: fake.window, players: 1 });
  input.assign(0, KEYBOARD_ID);
  const inputs = new Uint32Array(2);
  const view = createFighterView();

  /** Avance d'une frame, comme la boucle de jeu : lecture des inputs, puis simulation. */
  const frame = (count = 1) => {
    for (let f = 0; f < count; f++) {
      input.sample(inputs);
      step(sim, inputs);
    }
    readFighter(sim, 0, view);
    return view;
  };
  /** Avance jusqu'à ce que `done` soit vrai ; échoue au-delà de `limit` frames. */
  const until = (what: string, done: () => boolean, limit = 90): number => {
    for (let f = 1; f <= limit; f++) {
      frame();
      if (done()) return f;
    }
    throw new Error(`Jamais atteint en ${limit} frames : ${what}.`);
  };
  const action = (): number => sim.state.action[0]!;
  const move = (): number => sim.state.move[0]!;
  /** Suspend le joueur 0 au rebord gauche du stage de test. */
  const hang = (): void => {
    sim.state.posX[0] = fx(-66);
    sim.state.posY[0] = fx(-5);
    sim.state.grounded[0] = 0;
    sim.state.surface[0] = 0;
    sim.state.action[0] = A_AIR;
    until('accroche au rebord', () => action() === A_LEDGE);
    // Les options de rebord ne sont disponibles qu'après quelques frames suspendu.
    frame(10);
  };
  /** Hauteur maximale atteinte pendant le saut en cours, jusqu'au retour au sol. */
  const peak = (): number => {
    let best = 0;
    until('décollage', () => !view.grounded, 20);
    until(
      'atterrissage',
      () => {
        best = Math.max(best, view.y);
        return view.grounded;
      },
      200,
    );
    return best;
  };
  return { sim, fake, frame, until, action, move, hang, peak, view };
}

describe('contrat clavier : déplacements', () => {
  it('marche avec la touche de marche, sans jamais courir', () => {
    const t = rig();
    t.fake.keyDown('ShiftLeft');
    t.fake.keyDown('ArrowRight');
    for (let f = 0; f < 40; f++) {
      t.frame();
      expect([A_IDLE, A_WALK]).toContain(t.action());
    }
    expect(t.action()).toBe(A_WALK);
    expect(t.view.x).toBeGreaterThan(-35);
  });

  it('part en dash puis court quand la direction est tenue', () => {
    const t = rig();
    t.fake.keyDown('ArrowRight');
    t.until('dash', () => t.action() === A_DASH, 3);
    t.until('course', () => t.action() === A_RUN, 30);
  });

  it('fait demi-tour dès que la direction opposée est enfoncée, l’autre encore tenue', () => {
    const t = rig();
    t.fake.keyDown('ArrowRight');
    t.until('course', () => t.action() === A_RUN, 30);
    t.fake.keyDown('ArrowLeft');
    t.until('demi-tour', () => t.view.facing === -1 && t.view.velX < 0, 30);
  });

  it('fait un grand saut bouton tenu, un petit saut sur un appui bref', () => {
    const tall = rig();
    tall.fake.keyDown('KeyZ');
    const high = tall.peak();

    const short = rig();
    // Appui plus court qu'une frame : enfoncé et relâché avant la lecture suivante.
    short.fake.keyDown('KeyZ');
    short.fake.keyUp('KeyZ');
    const low = short.peak();

    expect(low).toBeGreaterThan(5);
    expect(high).toBeGreaterThan(low * 1.5);
  });

  it('saute une seconde fois en l’air', () => {
    const t = rig();
    t.fake.keyDown('KeyZ');
    t.until('décollage', () => !t.view.grounded, 20);
    t.fake.keyUp('KeyZ');
    t.frame(10);
    const before = t.view.jumpsLeft;
    t.fake.keyDown('KeyZ');
    t.frame(2);
    expect(t.view.jumpsLeft).toBe(before - 1);
    expect(t.view.velY).toBeGreaterThan(0);
  });
});

describe('contrat clavier : attaques', () => {
  it('lance le jab sans direction', () => {
    const t = rig();
    t.fake.keyDown('KeyX');
    t.frame();
    expect([t.action(), t.move()]).toEqual([A_ATTACK, M_JAB]);
  });

  it('lance une attaque dirigée avec la touche de marche', () => {
    const forward = rig();
    forward.fake.keyDown('ShiftLeft');
    forward.fake.keyDown('ArrowRight');
    forward.frame(6);
    forward.fake.keyDown('KeyX');
    forward.frame();
    expect([forward.action(), forward.move()]).toEqual([A_ATTACK, M_FTILT]);

    const up = rig();
    up.fake.keyDown('ShiftLeft');
    up.fake.keyDown('ArrowUp');
    up.frame(6);
    up.fake.keyDown('KeyX');
    up.frame();
    expect([up.action(), up.move()]).toEqual([A_ATTACK, M_UTILT]);
  });

  it('lance un smash quand direction et attaque partent ensemble', () => {
    const t = rig();
    t.fake.keyDown('ArrowRight');
    t.fake.keyDown('KeyX');
    t.frame();
    expect([t.action(), t.move()]).toEqual([A_ATTACK, M_FSMASH]);
  });

  it('lance les smash au stick droit', () => {
    for (const [code, slot] of [
      ['KeyL', M_FSMASH],
      ['KeyI', M_USMASH],
      ['KeyK', M_DSMASH],
    ] as const) {
      const t = rig();
      t.fake.keyDown(code);
      t.frame();
      expect([t.action(), t.move()]).toEqual([A_ATTACK, slot]);
    }
    // Vers la gauche : le même smash, retourné.
    const left = rig();
    left.fake.keyDown('KeyJ');
    left.frame();
    expect([left.action(), left.move(), left.view.facing]).toEqual([A_ATTACK, M_FSMASH, -1]);
  });

  it('lance l’attaque de dash en pleine course', () => {
    const t = rig();
    t.fake.keyDown('ArrowRight');
    t.until('course', () => t.action() === A_RUN, 30);
    t.fake.keyDown('KeyX');
    t.frame();
    expect([t.action(), t.move()]).toEqual([A_ATTACK, M_DASH_ATTACK]);
  });

  it('lance le coup spécial', () => {
    const t = rig();
    t.fake.keyDown('KeyC');
    t.frame();
    expect([t.action(), t.move()]).toEqual([A_ATTACK, M_NSPECIAL]);
  });

  it('lance une attaque aérienne', () => {
    const t = rig();
    t.fake.keyDown('KeyZ');
    t.until('décollage', () => !t.view.grounded, 20);
    t.fake.keyDown('KeyX');
    t.frame();
    expect([t.action(), t.move()]).toEqual([A_ATTACK, M_NAIR]);
  });

  it('saisit', () => {
    const t = rig();
    t.fake.keyDown('KeyB');
    t.frame();
    expect(t.action()).toBe(A_GRAB);
  });
});

describe('contrat clavier : défense', () => {
  it('lève le bouclier', () => {
    const t = rig();
    t.fake.keyDown('KeyV');
    t.frame(2);
    expect(t.action()).toBe(A_SHIELD);
  });

  it('roule sur un coup de stick latéral, bouclier levé', () => {
    const t = rig();
    t.fake.keyDown('KeyV');
    t.frame(6);
    t.fake.keyDown('ArrowRight');
    t.until('roulade', () => t.action() === A_ROLL, 4);
  });

  it('esquive sur place sur un coup de stick vers le bas, bouclier levé', () => {
    const t = rig();
    t.fake.keyDown('KeyV');
    t.frame(6);
    t.fake.keyDown('ArrowDown');
    t.until('esquive sur place', () => t.action() === A_SPOTDODGE, 4);
  });

  it('esquive en l’air', () => {
    const t = rig();
    t.fake.keyDown('KeyZ');
    t.until('décollage', () => !t.view.grounded, 20);
    t.fake.keyUp('KeyZ');
    t.frame(5);
    t.fake.keyDown('KeyV');
    t.until('esquive aérienne', () => t.action() === A_AIRDODGE, 3);
  });
});

describe('contrat clavier : options de rebord', () => {
  it('remonte en poussant vers le haut', () => {
    const t = rig();
    t.hang();
    t.fake.keyDown('ArrowUp');
    t.until('remontée', () => t.action() === A_LEDGE_GETUP, 3);
  });

  it('remonte en roulade avec le bouclier', () => {
    const t = rig();
    t.hang();
    t.fake.keyDown('KeyV');
    t.until('remontée en roulade', () => t.action() === A_LEDGE_ROLL, 3);
  });

  it('remonte en attaquant', () => {
    const t = rig();
    t.hang();
    t.fake.keyDown('KeyX');
    t.until('attaque de rebord', () => t.action() === A_ATTACK, 3);
    expect(t.move()).toBe(M_LEDGE_ATTACK);
  });

  it('saute depuis le rebord', () => {
    const t = rig();
    t.hang();
    t.fake.keyDown('KeyZ');
    t.until('saut', () => t.action() === A_AIR && t.view.velY > 0, 3);
  });

  it('lâche prise en poussant vers le bas', () => {
    const t = rig();
    t.hang();
    t.fake.keyDown('ArrowDown');
    t.until('lâcher', () => t.action() === A_AIR, 3);
    expect(t.view.velY).toBeLessThanOrEqual(0);
  });
});
