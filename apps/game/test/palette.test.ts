import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PALETTE, TEXT_PAIRS, contrast } from '../src/palette.ts';

describe('palette', () => {
  it('calcule le contraste WCAG', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it.each(TEXT_PAIRS)('%s sur %s : au moins 4,5:1', (fg, bg) => {
    expect(contrast(PALETTE[fg], PALETTE[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it('le focus se distingue du fond d’au moins 3:1 (élément non textuel)', () => {
    for (const bg of ['bg', 'surface', 'surface2'] as const) {
      expect(contrast(PALETTE.focus, PALETTE[bg])).toBeGreaterThanOrEqual(3);
    }
  });

  it('les variables CSS reprennent exactement la palette', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    for (const [name, value] of Object.entries(PALETTE)) {
      const variable = `--${name.replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`)}`;
      expect(css).toContain(`${variable}: ${value};`);
    }
  });
});
