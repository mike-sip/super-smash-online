import { describe, expect, it } from 'vitest';
import { TEST_STAGE } from '@game/sim-core/testing';
import { buildStage, groundBelow, stageBounds, stageSurfaces } from '../src/stage.ts';

describe('stage', () => {
  const surfaces = stageSurfaces(TEST_STAGE);

  it('trouve la surface sous un point', () => {
    expect(groundBelow(surfaces, 0, 0)).toBe(0);
    expect(groundBelow(surfaces, 0, 15)).toBe(0);
    // Sous la plateforme latérale : le sol principal ; dessus : la plateforme.
    expect(groundBelow(surfaces, -30, 19)).toBe(0);
    expect(groundBelow(surfaces, -30, 20)).toBe(20);
    expect(groundBelow(surfaces, 0, 60)).toBe(40);
  });

  it('ne trouve rien au-dessus du vide ni sous le stage', () => {
    expect(groundBelow(surfaces, -80, 10)).toBe(-Infinity);
    expect(groundBelow(surfaces, 0, -5)).toBe(-Infinity);
  });

  it('englobe blocs et plateformes', () => {
    expect(stageBounds(TEST_STAGE)).toEqual({ minX: -60, maxX: 60, minY: -20, maxY: 40 });
  });

  it('construit un objet par bloc plein et par plateforme', () => {
    const group = buildStage(TEST_STAGE);
    expect(group.children.length).toBe(4);
    // Le dessus de la plateforme centrale est à y = 40 : son centre est juste en dessous.
    const top = group.children[3]!;
    expect(top.position.y).toBeLessThan(40);
    expect(top.position.y).toBeGreaterThan(38);
  });
});
