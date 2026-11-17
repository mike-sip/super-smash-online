/**
 * Pile d'écrans de l'application (pure). Chaque entrée déclare ce que fait « retour » :
 * dépiler, demander confirmation, ou rien (compte à rebours, chargement). La racine ne se
 * dépile jamais.
 */
export type BackRule = 'pop' | 'confirm' | 'block';

export interface StackEntry {
  readonly id: string;
  readonly back: BackRule;
}

export type BackOutcome = 'popped' | 'confirm' | 'blocked' | 'root';

export interface ScreenStack<E extends StackEntry> {
  top(): E;
  depth(): number;
  ids(): string[];
  push(entry: E): void;
  /** Remplace le sommet. */
  replace(entry: E): void;
  /** Vide la pile, qui ne contient plus que `entry`. */
  reset(entry: E): void;
  /** Applique la règle du sommet. */
  back(): BackOutcome;
  /** Dépile après une confirmation (jamais la racine). */
  confirmBack(): void;
  /** Dépile jusqu'à l'écran `id` ; faux (et rien ne change) s'il n'est pas dans la pile. */
  popTo(id: string): boolean;
}

export function createScreenStack<E extends StackEntry>(root: E): ScreenStack<E> {
  let entries: E[] = [root];
  const top = (): E => entries[entries.length - 1]!;
  return {
    top,
    depth: () => entries.length,
    ids: () => entries.map((e) => e.id),
    push(entry) {
      entries.push(entry);
    },
    replace(entry) {
      entries[entries.length - 1] = entry;
    },
    reset(entry) {
      entries = [entry];
    },
    back() {
      if (entries.length === 1) return 'root';
      const rule = top().back;
      if (rule === 'block') return 'blocked';
      if (rule === 'confirm') return 'confirm';
      entries.pop();
      return 'popped';
    },
    confirmBack() {
      if (entries.length > 1) entries.pop();
    },
    popTo(id) {
      const at = entries.map((e) => e.id).lastIndexOf(id);
      if (at < 0) return false;
      entries = entries.slice(0, at + 1);
      return true;
    },
  };
}
