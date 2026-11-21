/**
 * Petits outils DOM de l'interface. Tout texte passe par `textContent` : pseudos, codes et
 * messages viennent d'autres joueurs ou du serveur, jamais de `innerHTML`.
 */
type Child = Node | string | null | undefined | false;

export interface ElementOptions {
  readonly className?: string;
  readonly id?: string;
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly data?: Readonly<Record<string, string>>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className !== undefined) node.className = options.className;
  if (options.id !== undefined) node.id = options.id;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [k, v] of Object.entries(options.attrs ?? {})) node.setAttribute(k, v);
  for (const [k, v] of Object.entries(options.data ?? {})) node.dataset[k] = v;
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

/** Remplace tout le contenu de `node`. */
export function replaceChildren(node: Element, children: readonly Child[]): void {
  node.replaceChildren(
    ...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false),
  );
}

/** Éléments où l'on peut poser le focus dans `root`, visibles et actifs, dans l'ordre du DOM. */
export function focusables(root: Element): HTMLElement[] {
  const all = root.querySelectorAll<HTMLElement>(
    'button, input, select, a[href], [tabindex]:not([tabindex="-1"])',
  );
  return [...all].filter((e) => {
    if ((e as HTMLButtonElement).disabled || e.tabIndex < 0) return false;
    if (e.closest('[hidden], [inert]') !== null) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

/**
 * Réglage par les directions gauche et droite (choix à valeurs, curseurs) : l'élément qui en a un
 * ne déplace pas le focus sur ces directions, il change de valeur.
 */
const adjusters = new WeakMap<Element, (delta: number) => void>();

export function setAdjust(node: Element, adjust: (delta: number) => void): void {
  adjusters.set(node, adjust);
}

export function adjusterOf(node: Element | null): ((delta: number) => void) | undefined {
  return node === null ? undefined : adjusters.get(node);
}
