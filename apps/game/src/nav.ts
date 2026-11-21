/**
 * Déplacement du focus par direction (flèches du clavier, croix et stick de la manette), d'après
 * la position des éléments à l'écran. Pur : reçoit des rectangles, renvoie un identifiant.
 */
export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Poids de l'écart perpendiculaire : un voisin aligné gagne sur un voisin en diagonale. */
const PERPENDICULAR_WEIGHT = 3;

function overlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

/**
 * Prochain élément dans `direction` depuis `from`, ou `null` (on reste sur place). Seuls
 * comptent les candidats dont le centre est au-delà de celui de `from` dans la direction ; parmi
 * eux, le plus proche, l'écart perpendiculaire comptant triple (et pour rien si les deux
 * éléments se recouvrent sur l'axe perpendiculaire).
 */
export function nextFocus(
  from: Rect,
  candidates: readonly { readonly id: string; readonly rect: Rect }[],
  direction: Direction,
): string | null {
  const fx = from.x + from.width / 2;
  const fy = from.y + from.height / 2;
  let best: string | null = null;
  let bestScore = Infinity;
  for (const { id, rect } of candidates) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (
      rect.x === from.x &&
      rect.y === from.y &&
      rect.width === from.width &&
      rect.height === from.height
    )
      continue;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    let primary: number;
    let perpendicular: number;
    if (direction === 'down' || direction === 'up') {
      const ahead = direction === 'down' ? cy - fy : fy - cy;
      if (ahead <= 1) continue;
      primary =
        direction === 'down'
          ? Math.max(0, rect.y - (from.y + from.height))
          : Math.max(0, from.y - (rect.y + rect.height));
      perpendicular = overlap(from.x, from.x + from.width, rect.x, rect.x + rect.width)
        ? 0
        : Math.abs(cx - fx);
    } else {
      const ahead = direction === 'right' ? cx - fx : fx - cx;
      if (ahead <= 1) continue;
      primary =
        direction === 'right'
          ? Math.max(0, rect.x - (from.x + from.width))
          : Math.max(0, from.x - (rect.x + rect.width));
      perpendicular = overlap(from.y, from.y + from.height, rect.y, rect.y + rect.height)
        ? 0
        : Math.abs(cy - fy);
    }
    // À égalité, le plus proche par les centres (élément large : celui de gauche ou du haut).
    const score =
      primary +
      PERPENDICULAR_WEIGHT * perpendicular +
      0.001 * (Math.abs(cx - fx) + Math.abs(cy - fy));
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}
