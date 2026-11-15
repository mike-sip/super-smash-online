/**
 * Logique pure de départage : partage des dégâts et classement. Aucune allocation : appelée
 * depuis le crochet de règles.
 */

/**
 * Part de `delta` revenant à `player` quand les attaquants de `mask` (un bit par joueur) se
 * partagent une même hausse de dégâts : parts égales en division entière, le reste au plus
 * petit index. 0 si `player` n'est pas dans `mask`.
 */
export function splitShare(delta: number, mask: number, player: number): number {
  if ((mask & (1 << player)) === 0) return 0;
  let n = 0;
  let lowest = -1;
  for (let p = 0; p < 31; p++) {
    if ((mask & (1 << p)) === 0) continue;
    if (lowest < 0) lowest = p;
    n++;
  }
  const share = Math.trunc(delta / n);
  return player === lowest ? delta - share * (n - 1) : share;
}

/**
 * Rang de compétition (1 + nombre d'unités strictement meilleures) de chaque unité du tour,
 * selon `keyA` puis `keyB`, décroissants. Les unités hors du tour (`inRound[u] === 0`)
 * reçoivent 0. Écrit dans `out` les `count` premiers rangs.
 */
export function rankUnits(
  keyA: Int32Array,
  keyB: Int32Array,
  inRound: Int32Array,
  count: number,
  out: Int32Array,
): void {
  for (let u = 0; u < count; u++) {
    if (inRound[u] === 0) {
      out[u] = 0;
      continue;
    }
    let better = 0;
    for (let v = 0; v < count; v++) {
      if (v === u || inRound[v] === 0) continue;
      if (keyA[v]! > keyA[u]! || (keyA[v] === keyA[u] && keyB[v]! > keyB[u]!)) better++;
    }
    out[u] = 1 + better;
  }
}
