/** Actions de jeu réassignables, et le bouton de l'`InputFrame` que chacune enfonce. */
import {
  BTN_ATTACK,
  BTN_CSTICK_DOWN,
  BTN_CSTICK_LEFT,
  BTN_CSTICK_RIGHT,
  BTN_CSTICK_UP,
  BTN_GRAB,
  BTN_JUMP,
  BTN_SHIELD,
  BTN_SPECIAL,
  BTN_TAUNT,
} from '@game/sim-core';

/**
 * Toutes les actions, dans un ordre fixe : leur position dans cette liste sert d'index dans les
 * tableaux internes. Les quatre directions du stick sont des actions comme les autres ; `walk`
 * est la touche de modification qui réduit le stick du clavier à une demi-inclinaison.
 */
export const ACTIONS = [
  'left',
  'right',
  'up',
  'down',
  'attack',
  'special',
  'jump',
  'shield',
  'grab',
  'taunt',
  'cLeft',
  'cRight',
  'cUp',
  'cDown',
  'walk',
] as const;

export type Action = (typeof ACTIONS)[number];

/** Bouton de l'`InputFrame` enfoncé par l'action ; 0 pour celles qui agissent sur le stick. */
export const ACTION_BUTTON: Readonly<Record<Action, number>> = {
  left: 0,
  right: 0,
  up: 0,
  down: 0,
  attack: BTN_ATTACK,
  special: BTN_SPECIAL,
  jump: BTN_JUMP,
  shield: BTN_SHIELD,
  grab: BTN_GRAB,
  taunt: BTN_TAUNT,
  cLeft: BTN_CSTICK_LEFT,
  cRight: BTN_CSTICK_RIGHT,
  cUp: BTN_CSTICK_UP,
  cDown: BTN_CSTICK_DOWN,
  walk: 0,
};

/** Actions sans lesquelles on ne peut pas jouer : une disposition doit leur donner une commande. */
export const REQUIRED_ACTIONS: readonly Action[] = [
  'left',
  'right',
  'up',
  'down',
  'attack',
  'special',
  'jump',
  'shield',
  'grab',
];

// Index des actions lues directement par le code du stick.
export const A_LEFT = 0;
export const A_RIGHT = 1;
export const A_UP = 2;
export const A_DOWN = 3;
export const A_WALK = 14;
