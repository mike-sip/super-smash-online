/** Dispositions : quelle touche ou quel bouton déclenche quelle action. Logique pure. */
import { ACTIONS, REQUIRED_ACTIONS, type Action } from './actions.ts';

/** Ce qu'un joueur actionne physiquement : une touche, un bouton, ou un demi-axe de stick. */
export type PhysicalInput =
  | { readonly type: 'key'; readonly code: string }
  | { readonly type: 'button'; readonly index: number }
  | { readonly type: 'axis'; readonly index: number; readonly direction: 1 | -1 };

/** Disposition d'un périphérique : plusieurs commandes possibles par action. */
export type Bindings = Readonly<Record<Action, readonly PhysicalInput[]>>;

export type DeviceKind = 'keyboard' | 'gamepad';

/** Raison du refus d'une disposition. */
export type BindingError =
  /** Une action indispensable n'a aucune commande. */
  | { readonly reason: 'missing'; readonly action: Action }
  /** La commande est mal formée. */
  | { readonly reason: 'invalid'; readonly action: Action; readonly input: PhysicalInput }
  /** La commande n'existe pas sur ce périphérique (un bouton de manette pour un clavier…). */
  | { readonly reason: 'wrong-device'; readonly action: Action; readonly input: PhysicalInput }
  /** La même commande déclencherait deux actions. */
  | {
      readonly reason: 'conflict';
      readonly action: Action;
      readonly other: Action;
      readonly input: PhysicalInput;
    };

const key = (code: string): PhysicalInput => ({ type: 'key', code });
const button = (index: number): PhysicalInput => ({ type: 'button', index });
const axis = (index: number, direction: 1 | -1): PhysicalInput => ({
  type: 'axis',
  index,
  direction,
});

/**
 * Clavier : touches repérées par leur position physique (`KeyboardEvent.code`), pour que le
 * groupe saut-attaque-spécial-bouclier-saisie reste sous la main gauche quelle que soit la
 * disposition du clavier. `KeyW` est la touche marquée Z sur un AZERTY : le saut répond aux deux.
 */
export const DEFAULT_KEYBOARD: Bindings = {
  left: [key('ArrowLeft')],
  right: [key('ArrowRight')],
  up: [key('ArrowUp')],
  down: [key('ArrowDown')],
  attack: [key('KeyX')],
  special: [key('KeyC')],
  jump: [key('KeyZ'), key('KeyW')],
  shield: [key('KeyV')],
  grab: [key('KeyB')],
  taunt: [],
  cLeft: [key('KeyJ')],
  cRight: [key('KeyL')],
  cUp: [key('KeyI')],
  cDown: [key('KeyK')],
  walk: [key('ShiftLeft'), key('ShiftRight')],
};

/**
 * Manette à la disposition « standard » de l'API Gamepad : bas du losange pour attaquer, droite
 * pour le spécial, gauche et haut pour sauter, boutons d'épaule pour la saisie, gâchettes pour le
 * bouclier, croix vers le haut pour la provocation. L'axe vertical de l'API pointe vers le bas.
 */
export const DEFAULT_GAMEPAD: Bindings = {
  left: [axis(0, -1)],
  right: [axis(0, 1)],
  up: [axis(1, -1)],
  down: [axis(1, 1)],
  attack: [button(0)],
  special: [button(1)],
  jump: [button(2), button(3)],
  shield: [button(6), button(7)],
  grab: [button(4), button(5)],
  taunt: [button(12)],
  cLeft: [axis(2, -1)],
  cRight: [axis(2, 1)],
  cUp: [axis(3, -1)],
  cDown: [axis(3, 1)],
  walk: [],
};

export function sameInput(a: PhysicalInput, b: PhysicalInput): boolean {
  if (a.type === 'key') return b.type === 'key' && a.code === b.code;
  if (a.type === 'button') return b.type === 'button' && a.index === b.index;
  return b.type === 'axis' && a.index === b.index && a.direction === b.direction;
}

const isIndex = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 64;

function wellFormed(input: PhysicalInput): boolean {
  if (typeof input !== 'object' || input === null) return false;
  if (input.type === 'key') return typeof input.code === 'string' && input.code.length > 0;
  if (input.type === 'button') return isIndex(input.index);
  if (input.type === 'axis') {
    return isIndex(input.index) && (input.direction === 1 || input.direction === -1);
  }
  return false;
}

/**
 * Vérifie une disposition pour un type de périphérique. Renvoie la première raison de la refuser,
 * ou `null` si elle est utilisable. Sert aussi à écarter des données enregistrées corrompues :
 * la disposition n'est supposée ni complète ni bien typée.
 */
export function validateBindings(kind: DeviceKind, bindings: Bindings): BindingError | null {
  for (const action of ACTIONS) {
    const inputs: unknown = bindings[action];
    if (!Array.isArray(inputs)) return { reason: 'missing', action };
  }
  for (const action of REQUIRED_ACTIONS) {
    if (bindings[action].length === 0) return { reason: 'missing', action };
  }
  for (let a = 0; a < ACTIONS.length; a++) {
    const action = ACTIONS[a]!;
    const inputs = bindings[action];
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i]!;
      if (!wellFormed(input)) return { reason: 'invalid', action, input };
      if ((input.type === 'key') !== (kind === 'keyboard')) {
        return { reason: 'wrong-device', action, input };
      }
      // Conflit : la même commande plus loin, dans cette action ou dans une suivante.
      for (let b = a; b < ACTIONS.length; b++) {
        const other = ACTIONS[b]!;
        const others = bindings[other];
        for (let j = b === a ? i + 1 : 0; j < others.length; j++) {
          if (sameInput(input, others[j]!)) return { reason: 'conflict', action, other, input };
        }
      }
    }
  }
  return null;
}
