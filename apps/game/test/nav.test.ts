import { describe, expect, it } from 'vitest';
import { nextFocus, type Rect } from '../src/nav.ts';

const r = (x: number, y: number, w = 100, h = 40): Rect => ({ x, y, width: w, height: h });
const c = (id: string, rect: Rect) => ({ id, rect });

describe('focus par direction', () => {
  // Liste verticale de trois boutons.
  const list = [c('a', r(0, 0)), c('b', r(0, 50)), c('c', r(0, 100))];

  it('liste : bas et haut vers le voisin', () => {
    expect(nextFocus(list[0]!.rect, list, 'down')).toBe('b');
    expect(nextFocus(list[1]!.rect, list, 'down')).toBe('c');
    expect(nextFocus(list[1]!.rect, list, 'up')).toBe('a');
  });

  it('bord : null (on reste sur place)', () => {
    expect(nextFocus(list[0]!.rect, list, 'up')).toBeNull();
    expect(nextFocus(list[2]!.rect, list, 'down')).toBeNull();
    expect(nextFocus(list[0]!.rect, list, 'left')).toBeNull();
  });

  // Grille 3 × 2.
  const grid = [
    c('g00', r(0, 0)),
    c('g10', r(120, 0)),
    c('g20', r(240, 0)),
    c('g01', r(0, 60)),
    c('g11', r(120, 60)),
    c('g21', r(240, 60)),
  ];

  it('grille : aligné plutôt qu’en diagonale', () => {
    expect(nextFocus(grid[0]!.rect, grid, 'right')).toBe('g10');
    expect(nextFocus(grid[0]!.rect, grid, 'down')).toBe('g01');
    expect(nextFocus(grid[4]!.rect, grid, 'up')).toBe('g10');
    expect(nextFocus(grid[5]!.rect, grid, 'left')).toBe('g11');
  });

  it('trou dans la grille : le plus proche dans la direction', () => {
    const holes = grid.filter((g) => g.id !== 'g11');
    expect(nextFocus(grid[1]!.rect, holes, 'down')).toMatch(/g01|g21/);
    expect(nextFocus(grid[3]!.rect, holes, 'right')).toBe('g21');
  });

  it('élément large au-dessus d’une rangée', () => {
    const items = [
      c('top', r(0, 0, 360)),
      c('l', r(0, 60)),
      c('m', r(130, 60)),
      c('rr', r(260, 60)),
    ];
    expect(nextFocus(items[3]!.rect, items, 'up')).toBe('top');
    expect(nextFocus(items[0]!.rect, items, 'down')).toBe('m');
  });

  it('ignore l’élément de départ et les rectangles vides', () => {
    const items = [c('a', r(0, 0)), c('hidden', r(0, 50, 0, 0)), c('b', r(0, 100))];
    expect(nextFocus(items[0]!.rect, items, 'down')).toBe('b');
  });
});
