/**
 * Composants de l'interface : boutons, menus, choix à valeurs, interrupteurs, curseurs. Tous sont
 * de vrais éléments de formulaire, utilisables au clavier, à la manette (par la navigation de
 * l'application) et par les lecteurs d'écran.
 */
import { el, setAdjust } from './dom.ts';

export interface ButtonOptions {
  readonly id?: string;
  readonly detail?: string;
  readonly primary?: boolean;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  /** Description lue par les lecteurs d'écran en plus du libellé. */
  readonly description?: string;
}

export function button(
  label: string,
  onClick: () => void,
  options: ButtonOptions = {},
): HTMLButtonElement {
  const classes = ['btn'];
  if (options.primary === true) classes.push('primary');
  if (options.danger === true) classes.push('danger');
  const b = el('button', { className: classes.join(' '), attrs: { type: 'button' } }, [
    el('span', { className: 'label', text: label }),
    options.detail === undefined ? null : el('span', { className: 'detail', text: options.detail }),
  ]);
  if (options.id !== undefined) b.id = options.id;
  if (options.description !== undefined) b.setAttribute('aria-description', options.description);
  b.disabled = options.disabled === true;
  b.addEventListener('click', () => {
    if (!b.disabled) onClick();
  });
  return b;
}

/** Liste verticale de boutons (menu). */
export function menu(label: string, items: readonly HTMLElement[]): HTMLElement {
  return el(
    'ul',
    { className: 'menu', attrs: { 'aria-label': label } },
    items.map((item) => el('li', {}, [item])),
  );
}

export interface ChoiceOption<T> {
  readonly value: T;
  readonly label: string;
}

export interface Choice<T> {
  readonly element: HTMLButtonElement;
  value(): T;
  set(value: T): void;
}

/**
 * Choix parmi des valeurs : gauche et droite (ou Entrée, qui avance) changent la valeur. Lu
 * « Mode : Stock » par les lecteurs d'écran.
 */
export function choice<T>(
  label: string,
  options: readonly ChoiceOption<T>[],
  initial: T,
  onChange: (value: T) => void,
  id?: string,
): Choice<T> {
  let index = Math.max(
    0,
    options.findIndex((o) => o.value === initial),
  );
  const valueEl = el('span', { className: 'detail' });
  const b = el('button', { className: 'btn choice', attrs: { type: 'button' } }, [
    el('span', { className: 'label', text: label }),
    valueEl,
  ]);
  if (id !== undefined) b.id = id;
  const render = (): void => {
    const current = options[index]!;
    valueEl.textContent = `‹ ${current.label} ›`;
    b.setAttribute('aria-label', `${label} : ${current.label}`);
    b.dataset.value = String(current.value);
  };
  const move = (delta: number): void => {
    index = (index + delta + options.length) % options.length;
    render();
    onChange(options[index]!.value);
  };
  b.addEventListener('click', () => move(1));
  setAdjust(b, move);
  render();
  return {
    element: b,
    value: () => options[index]!.value,
    set(value) {
      const at = options.findIndex((o) => o.value === value);
      if (at >= 0) index = at;
      render();
    },
  };
}

/** Interrupteur oui/non (`aria-pressed`). */
export function toggle(
  label: string,
  initial: boolean,
  onChange: (on: boolean) => void,
  id?: string,
): Choice<boolean> {
  return choice(
    label,
    [
      { value: true, label: 'Oui' },
      { value: false, label: 'Non' },
    ],
    initial,
    onChange,
    id,
  );
}

/** Curseur de 0 à 100 %, gauche et droite par pas de 10. */
export function slider(
  label: string,
  initial: number,
  onChange: (value: number) => void,
  id?: string,
): HTMLElement {
  const input = el('input', {
    attrs: { type: 'range', min: '0', max: '100', step: '5', 'aria-label': label },
  });
  if (id !== undefined) input.id = id;
  input.value = String(Math.round(initial * 100));
  const value = el('span', { className: 'value', text: `${input.value} %` });
  const update = (): void => {
    value.textContent = `${input.value} %`;
    onChange(Number(input.value) / 100);
  };
  input.addEventListener('input', update);
  setAdjust(input, (delta) => {
    input.value = String(Math.min(100, Math.max(0, Number(input.value) + delta * 10)));
    update();
  });
  return el('div', { className: 'setting' }, [
    el('span', { className: 'label', text: label }),
    el('div', { className: 'row' }, [input, value]),
  ]);
}

/** Ligne de réglage : libellé visible à gauche, contrôle à droite. */
export function setting(label: string, control: HTMLElement): HTMLElement {
  return el('div', { className: 'setting' }, [
    el('span', { className: 'label', text: label }),
    control,
  ]);
}

/** Aide en bas d'écran : touches clavier et boutons de manette. */
export function hints(items: readonly (readonly [keys: string, action: string])[]): HTMLElement {
  return el(
    'footer',
    { attrs: { 'aria-label': 'Commandes' } },
    items.map(([keys, action]) =>
      el('span', {}, [
        ...keys.split(' / ').flatMap((k, i) => [i > 0 ? ' / ' : null, el('kbd', { text: k })]),
        ` ${action}`,
      ]),
    ),
  );
}

export const STANDARD_HINTS: readonly (readonly [string, string])[] = [
  ['↑ ↓ ← →', 'se déplacer'],
  ['Entrée / A', 'valider'],
  ['Échap / B', 'retour'],
];
