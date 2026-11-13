/** Noms des commandes à afficher au joueur. Logique pure. */
import type { PhysicalInput } from './bindings.ts';

/** Touches sans caractère, ou dont le caractère ne dit rien : nommées d'après leur position. */
const KEY_NAMES: Readonly<Record<string, string>> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ShiftLeft: 'Maj gauche',
  ShiftRight: 'Maj droite',
  ControlLeft: 'Ctrl gauche',
  ControlRight: 'Ctrl droite',
  AltLeft: 'Alt gauche',
  AltRight: 'Alt droite',
  Space: 'Espace',
  Enter: 'Entrée',
  Tab: 'Tab',
  Backspace: 'Retour arrière',
  Escape: 'Échap',
  CapsLock: 'Verr. maj',
};

/** Boutons de la disposition « standard » de l'API Gamepad, par index. */
const BUTTON_NAMES: readonly string[] = [
  'Bouton bas',
  'Bouton droit',
  'Bouton gauche',
  'Bouton haut',
  'Épaule gauche',
  'Épaule droite',
  'Gâchette gauche',
  'Gâchette droite',
  'Sélection',
  'Start',
  'Clic stick gauche',
  'Clic stick droit',
  'Croix haut',
  'Croix bas',
  'Croix gauche',
  'Croix droite',
  'Accueil',
];

const STICK_NAMES = ['Stick gauche', 'Stick droit'];
/** Flèche de chaque demi-axe : axe horizontal puis vertical, sens négatif puis positif. */
const ARROWS = ['←', '→', '↑', '↓'];

/**
 * Nom d'une commande. `layout` associe la position d'une touche au caractère qu'elle porte sur le
 * clavier du joueur (`Keyboard.getLayoutMap()`), quand le navigateur sait le donner : la touche
 * `KeyW` s'affiche alors « Z » sur un AZERTY. Sans lui, c'est le nom de la position.
 */
export function describeInput(
  input: PhysicalInput,
  layout?: { get(code: string): string | undefined },
): string {
  if (input.type === 'key') {
    const named = KEY_NAMES[input.code];
    if (named !== undefined) return named;
    const printed = layout?.get(input.code);
    if (printed !== undefined && printed.trim() !== '') return printed.toUpperCase();
    if (input.code.startsWith('Key')) return input.code.slice(3);
    if (input.code.startsWith('Digit')) return input.code.slice(5);
    if (input.code.startsWith('Numpad')) return `Pavé ${input.code.slice(6)}`;
    return input.code;
  }
  if (input.type === 'button') return BUTTON_NAMES[input.index] ?? `Bouton ${input.index}`;
  const stick = STICK_NAMES[input.index >> 1];
  if (stick === undefined) return `Axe ${input.index} ${input.direction > 0 ? '+' : '-'}`;
  return `${stick} ${ARROWS[(input.index & 1) * 2 + (input.direction > 0 ? 1 : 0)]}`;
}
