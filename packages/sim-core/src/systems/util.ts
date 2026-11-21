/** Rapproche `v` de `target` d'au plus `delta`, sans le dépasser. */
export function approach(v: number, target: number, delta: number): number {
  if (v < target) return v + delta > target ? target : v + delta;
  return v - delta < target ? target : v - delta;
}
