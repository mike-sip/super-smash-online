import { describe, expect, it } from 'vitest';
import {
  BTN_ATTACK,
  BTN_CSTICK_UP,
  BTN_GRAB,
  BTN_JUMP,
  BTN_SHIELD,
  BTN_SPECIAL,
  inputButtons,
  inputStickX,
  inputStickY,
} from '@game/sim-core';
import { DEFAULT_KEYBOARD, type Bindings } from '../src/bindings.ts';
import { HALF_STICK, createKeyboardState } from '../src/keyboard.ts';

/** Lit l'état comme le ferait une frame simulée. */
function read(state: ReturnType<typeof createKeyboardState>) {
  const frame = state.sample();
  return { x: inputStickX(frame), y: inputStickY(frame), buttons: inputButtons(frame) };
}

describe('clavier : boutons', () => {
  it('ne produit rien au repos', () => {
    const kb = createKeyboardState(DEFAULT_KEYBOARD);
    expect(kb.sample()).toBe(0);
  });

  it('tient un bouton tant que sa touche est enfoncée', () => {
    const kb = createKeyboardState(DEFAULT_KEYBOARD);
    kb.press('KeyX');
    expect(read(kb).buttons).toBe(BTN_ATTACK);
    expect(read(kb).buttons).toBe(BTN_ATTACK);
    kb.release('KeyX');
    expect(read(kb).buttons).toBe(0);
  });

  it('cumule les boutons de plusieurs touches', () => {
    const kb = createKeyboardState(DEFAULT_KEYBOARD);
    kb.press('KeyC');
    kb.press('KeyV');
    kb.press('KeyB');
    kb.press('KeyI');
    expect(read(kb).buttons).toBe(BTN_SPECIAL | BTN_SHIELD | BTN_GRAB | BTN_CSTICK_UP);
  });

  it('compte un appui plus court qu’une frame pour une frame exactement', () => {
    const kb = createKeyboardState(DEFAULT_KEYBOARD);
    kb.press('KeyZ');
    kb.release('KeyZ');
    // Ni perdu…
    expect(read(kb).buttons).toBe(BTN_JUMP);
    // …ni prolongé : c'est ce qui fait un petit saut.
    expect(read(kb).buttons).toBe(0);
  });

  it('ne prolonge pas un appui relâché juste après la lecture', () => {
    const kb = createKeyboardState(DEFAULT_KEYBOARD);
    kb.press('KeyZ');
    expect(read(kb).buttons).toBe(BTN_JUMP);
    kb.release('KeyZ');
    expect(read(kb).buttons).toBe(0);
  });

  it('garde un bouton tenu par deux touches jusqu’au relâchement de la dernière', () => {
    const kb = createKeyboardState(DEFAULT_KEYBOARD);
    kb.press('KeyZ');
    kb.press('KeyW');
    expect(read(kb).buttons).toBe(BTN_JUMP);
    kb.release('KeyZ');
    expect(read(kb).buttons).toBe(BTN_JUMP);
    kb.release('KeyW');
    expect(read(kb).buttons).toBe(0);
  });

  it('ignore la répétition automatique d’une touche tenue', () => {
    const kb = createKeyboardState(DEFAULT_KEYBOARD);
    kb.press('KeyX');
    kb.press('KeyX');
    kb.press('KeyX');
    kb.release('KeyX');
    kb.sample();
    expect(read(kb).buttons).toBe(0);
  });

  it('ignore une touche sans action et un relâchement sans appui', () => {
    const kb = createKeyboardState(DEFAULT_KEYBOARD);
    expect(kb.press('KeyQ')).toBe(false);
    kb.release('KeyX');
    expect(kb.sample()).toBe(0);
    expect(kb.press('KeyX')).toBe(true);
  });

  it('dit quelles touches il gère', () => {
    const kb = createKeyboardState(DEFAULT_KEYBOARD);
    expect(kb.handles('ArrowUp')).toBe(true);
    expect(kb.handles('ShiftLeft')).toBe(true);
    expect(kb.handles('KeyP')).toBe(false);
  });
});

describe('clavier : stick', () => {
  it('pousse le stick à fond dans la direction tenue', () => {
    const kb = createKeyboardState(DEFAULT_KEYBOARD);
    kb.press('ArrowRight');
    expect(read(kb)).toMatchObject({ x: 127, y: 0 });
    kb.release('ArrowRight');
    kb.press('ArrowLeft');
    kb.press('ArrowUp');
    expect(read(kb)).toMatchObject({ x: -127, y: 127 });
    kb.release('ArrowUp');
    kb.press('ArrowDown');
    expect(read(kb)).toMatchObject({ x: -127, y: -127 });
  });

  it('réduit le stick à une demi-inclinaison avec la touche de marche', () => {
    const kb = createKeyboardState(DEFAULT_KEYBOARD);
    kb.press('ShiftLeft');
    kb.press('ArrowRight');
    kb.press('ArrowUp');
    expect(read(kb)).toMatchObject({ x: HALF_STICK, y: HALF_STICK });
    kb.release('ShiftLeft');
    expect(read(kb)).toMatchObject({ x: 127, y: 127 });
    // Au-dessus du seuil des attaques dirigées (40), sous celui de la course (64).
    expect(HALF_STICK).toBeGreaterThanOrEqual(40);
    expect(HALF_STICK).toBeLessThan(64);
  });

  it('donne la priorité à la dernière touche enfoncée quand gauche et droite se croisent', () => {
    const kb = createKeyboardState(DEFAULT_KEYBOARD);
    kb.press('ArrowLeft');
    expect(read(kb).x).toBe(-127);
    kb.press('ArrowRight');
    expect(read(kb).x).toBe(127);
    // Relâcher la dernière rend la main à l'autre, toujours tenue.
    kb.release('ArrowRight');
    expect(read(kb).x).toBe(-127);
    kb.press('ArrowRight');
    kb.release('ArrowLeft');
    expect(read(kb).x).toBe(127);
  });

  it('fait de même pour haut et bas', () => {
    const kb = createKeyboardState(DEFAULT_KEYBOARD);
    kb.press('ArrowUp');
    kb.press('ArrowDown');
    expect(read(kb).y).toBe(-127);
    kb.release('ArrowDown');
    expect(read(kb).y).toBe(127);
  });

  it('compte une direction tapée brièvement pour une frame, même contre une direction tenue', () => {
    const kb = createKeyboardState(DEFAULT_KEYBOARD);
    kb.press('ArrowLeft');
    kb.sample();
    kb.press('ArrowRight');
    kb.release('ArrowRight');
    expect(read(kb).x).toBe(127);
    expect(read(kb).x).toBe(-127);
  });
});

describe('clavier : relâchement général et changement de disposition', () => {
  it('relâche tout d’un coup', () => {
    const kb = createKeyboardState(DEFAULT_KEYBOARD);
    kb.press('ArrowRight');
    kb.press('KeyX');
    kb.press('KeyZ');
    kb.release('KeyZ');
    kb.releaseAll();
    expect(kb.sample()).toBe(0);
    // Une touche restée physiquement enfoncée doit être relâchée puis renfoncée pour compter.
    kb.release('KeyX');
    kb.press('KeyX');
    expect(read(kb).buttons).toBe(BTN_ATTACK);
  });

  it('applique une nouvelle disposition et relâche les touches de l’ancienne', () => {
    const kb = createKeyboardState(DEFAULT_KEYBOARD);
    kb.press('KeyX');
    const remapped: Bindings = {
      ...DEFAULT_KEYBOARD,
      attack: [{ type: 'key', code: 'KeyQ' }],
      grab: [{ type: 'key', code: 'KeyX' }],
    };
    kb.setBindings(remapped);
    expect(kb.sample()).toBe(0);
    kb.press('KeyQ');
    expect(read(kb).buttons).toBe(BTN_ATTACK);
    kb.release('KeyQ');
    kb.press('KeyX');
    expect(read(kb).buttons).toBe(BTN_GRAB);
  });

  it('ignore les commandes qui ne sont pas des touches', () => {
    const mixed: Bindings = { ...DEFAULT_KEYBOARD, taunt: [{ type: 'button', index: 3 }] };
    const kb = createKeyboardState(mixed);
    expect(kb.sample()).toBe(0);
  });
});
