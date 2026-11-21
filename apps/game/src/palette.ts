/**
 * Palette de l'interface. Les mêmes valeurs sont déclarées en variables CSS dans `style.css` ;
 * un test vérifie que les deux concordent et que chaque paire texte/fond atteint le contraste
 * demandé par la spec (4,5:1, WCAG 2.2 niveau AA pour le texte courant).
 */
export const PALETTE = {
  bg: '#0e1220',
  surface: '#171d30',
  surface2: '#222a42',
  border: '#3a4566',
  text: '#eef2f8',
  muted: '#b3bdd1',
  accent: '#ffb547',
  onAccent: '#1d1405',
  focus: '#ffd84d',
  danger: '#ff8a80',
  success: '#7ee2a8',
  info: '#8ec5ff',
} as const;

export type PaletteName = keyof typeof PALETTE;

/** Paires texte sur fond affichées par l'interface. */
export const TEXT_PAIRS: readonly (readonly [PaletteName, PaletteName])[] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'surface2'],
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['muted', 'surface2'],
  ['onAccent', 'accent'],
  ['accent', 'surface'],
  ['accent', 'bg'],
  ['danger', 'surface'],
  ['success', 'surface'],
  ['info', 'surface'],
  ['focus', 'surface2'],
];

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luminance relative WCAG d'une couleur `#rrggbb`. */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** Rapport de contraste WCAG entre deux couleurs, de 1 à 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
