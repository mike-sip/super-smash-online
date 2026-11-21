import { describe, expect, it } from 'vitest';
import { createMenuPad, type PadSnapshot } from '../src/menu-pad.ts';

function pad(overrides: Partial<PadSnapshot> = {}): PadSnapshot {
  return {
    index: 0,
    standard: true,
    buttons: Array.from({ length: 17 }, () => false),
    axes: [0, 0, 0, 0],
    ...overrides,
  };
}

function press(button: number, base = pad()): PadSnapshot {
  const buttons = [...base.buttons];
  buttons[button] = true;
  return { ...base, buttons };
}

describe('manette dans les menus', () => {
  it('A valide, B revient, Start : sur le front montant seulement', () => {
    const m = createMenuPad();
    expect(m.update([pad()], 0)).toEqual([]);
    expect(m.update([press(0)], 16)).toEqual([{ type: 'confirm', pad: 0 }]);
    expect(m.update([press(0)], 32)).toEqual([]);
    expect(m.update([pad()], 48)).toEqual([]);
    expect(m.update([press(1)], 64)).toEqual([{ type: 'back', pad: 0 }]);
    expect(m.update([press(9)], 80)).toEqual([{ type: 'start', pad: 0 }]);
  });

  it('croix : un déplacement, puis répétition après 400 ms toutes les 120 ms', () => {
    const m = createMenuPad();
    m.update([pad()], 0);
    expect(m.update([press(13)], 100)).toEqual([{ type: 'move', dir: 'down', pad: 0 }]);
    expect(m.update([press(13)], 300)).toEqual([]);
    expect(m.update([press(13)], 500)).toEqual([{ type: 'move', dir: 'down', pad: 0 }]);
    expect(m.update([press(13)], 560)).toEqual([]);
    expect(m.update([press(13)], 620)).toEqual([{ type: 'move', dir: 'down', pad: 0 }]);
    expect(m.update([pad()], 640)).toEqual([]);
    expect(m.update([press(14)], 650)).toEqual([{ type: 'move', dir: 'left', pad: 0 }]);
  });

  it('stick gauche avec zone morte', () => {
    const m = createMenuPad();
    m.update([pad()], 0);
    expect(m.update([pad({ axes: [0.3, 0, 0, 0] })], 16)).toEqual([]);
    expect(m.update([pad({ axes: [0.9, 0.1, 0, 0] })], 32)).toEqual([
      { type: 'move', dir: 'right', pad: 0 },
    ]);
    expect(m.update([pad({ axes: [0, -0.8, 0, 0] })], 48)).toEqual([
      { type: 'move', dir: 'up', pad: 0 },
    ]);
  });

  it('ce qui est enfoncé à l’apparition de la manette ne compte pas avant relâchement', () => {
    const m = createMenuPad();
    expect(m.update([press(0)], 0)).toEqual([]);
    expect(m.update([press(0)], 16)).toEqual([]);
    m.update([pad()], 32);
    expect(m.update([press(0)], 48)).toEqual([{ type: 'confirm', pad: 0 }]);
  });

  it('suspend() fait de même pour toutes les manettes (retour de combat)', () => {
    const m = createMenuPad();
    m.update([pad()], 0);
    m.suspend();
    expect(m.update([press(0)], 16)).toEqual([]);
    m.update([pad()], 32);
    expect(m.update([press(0)], 48)).toEqual([{ type: 'confirm', pad: 0 }]);
  });

  it('disposition non standard : stick, premier bouton valide, deuxième revient', () => {
    const m = createMenuPad();
    const raw = pad({ standard: false, buttons: [false, false, false, false] });
    m.update([raw], 0);
    expect(m.update([press(0, raw)], 16)).toEqual([{ type: 'confirm', pad: 0 }]);
    expect(m.update([press(1, raw)], 32)).toEqual([{ type: 'back', pad: 0 }]);
    expect(m.update([{ ...raw, axes: [0, 1] }], 48)).toEqual([
      { type: 'move', dir: 'down', pad: 0 },
    ]);
  });

  it('plusieurs manettes, chacune désignée par son index', () => {
    const m = createMenuPad();
    m.update([pad(), pad({ index: 2 })], 0);
    expect(m.update([pad(), press(0, pad({ index: 2 }))], 16)).toEqual([
      { type: 'confirm', pad: 2 },
    ]);
  });

  it('une manette débranchée puis rebranchée repart de zéro', () => {
    const m = createMenuPad();
    m.update([pad()], 0);
    m.update([], 16);
    expect(m.update([press(0)], 32)).toEqual([]);
  });
});
