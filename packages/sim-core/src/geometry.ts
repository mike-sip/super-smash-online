/**
 * Test de recouvrement entre capsules.
 *
 * Le calcul passe par des divisions, donc par des nombres non entiers. Il reste déterministe :
 * seules `+ - * /` sont utilisées, toutes spécifiées par IEEE 754, et le résultat n'est qu'un
 * booléen qui ne réinjecte aucune valeur flottante dans l'état.
 *
 * Contrainte d'écriture : aucun nombre non entier ne doit traverser un appel de fonction, ni en
 * valeur de retour ni autrement. Le moteur JavaScript alloue un tel nombre sur le tas dès que
 * l'appel n'est pas intégré à l'appelant, ce qui violerait la règle « aucune allocation dans
 * `step` ». D'où le résultat écrit dans `scratch` et les bornages écrits sur place plutôt que
 * dans une petite fonction : c'est le benchmark qui a révélé les deux cas.
 */

const scratch = new Float64Array(1);

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

  // s et t : position du point le plus proche sur chaque segment, bornée à [0, 1].
  let s = 0;
  let t = 0;
  if (a === 0 && e === 0) {
    scratch[0] = rx * rx + ry * ry;
    return;
  }
  if (a === 0) {
    t = f / e;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  } else {
    const c = d1x * rx + d1y * ry;
    if (e === 0) {
      s = -c / a;
      s = s < 0 ? 0 : s > 1 ? 1 : s;
    } else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      if (denom !== 0) {
        s = (b * f - c * e) / denom;
        s = s < 0 ? 0 : s > 1 ? 1 : s;
      }
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = -c / a;
        s = s < 0 ? 0 : s > 1 ? 1 : s;
      } else if (t > 1) {
        t = 1;
        s = (b - c) / a;
        s = s < 0 ? 0 : s > 1 ? 1 : s;
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
