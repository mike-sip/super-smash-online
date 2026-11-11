/**
 * Test de recouvrement entre capsules.
 *
 * Le calcul passe par des divisions, donc par des nombres non entiers. Il reste déterministe :
 * seules `+ - * /` sont utilisées, toutes spécifiées par IEEE 754, et le résultat n'est qu'un
 * booléen qui ne réinjecte aucune valeur flottante dans l'état.
 *
 * Le résultat intermédiaire passe par `scratch` plutôt que par une valeur de retour : un nombre
 * non entier renvoyé par une fonction est alloué sur le tas par le moteur tant que l'appel
 * n'est pas intégré, ce qui violerait la règle « aucune allocation dans `step` ».
 */

const scratch = new Float64Array(1);

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Écrit dans `scratch[0]` le carré de la distance minimale entre [P1, Q1] et [P2, Q2]. */
function computeDistanceSq(
  p1x: number,
  p1y: number,
  q1x: number,
  q1y: number,
  p2x: number,
  p2y: number,
  q2x: number,
  q2y: number,
): void {
  const d1x = q1x - p1x;
  const d1y = q1y - p1y;
  const d2x = q2x - p2x;
  const d2y = q2y - p2y;
  const rx = p1x - p2x;
  const ry = p1y - p2y;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;

  let s = 0;
  let t = 0;
  if (a === 0 && e === 0) {
    scratch[0] = rx * rx + ry * ry;
    return;
  }
  if (a === 0) {
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry;
    if (e === 0) {
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const dx = p1x + d1x * s - (p2x + d2x * t);
  const dy = p1y + d1y * s - (p2y + d2y * t);
  scratch[0] = dx * dx + dy * dy;
}

/** Carré de la distance minimale entre les segments [P1, Q1] et [P2, Q2]. Pour les tests. */
export function segmentDistanceSq(
  p1x: number,
  p1y: number,
  q1x: number,
  q1y: number,
  p2x: number,
  p2y: number,
  q2x: number,
  q2y: number,
): number {
  computeDistanceSq(p1x, p1y, q1x, q1y, p2x, p2y, q2x, q2y);
  return scratch[0]!;
}

/** Vrai si les deux capsules se touchent ou se recouvrent. */
export function capsulesOverlap(
  p1x: number,
  p1y: number,
  q1x: number,
  q1y: number,
  r1: number,
  p2x: number,
  p2y: number,
  q2x: number,
  q2y: number,
  r2: number,
): boolean {
  const reach = r1 + r2;
  computeDistanceSq(p1x, p1y, q1x, q1y, p2x, p2y, q2x, q2y);
  return scratch[0]! <= reach * reach;
}
