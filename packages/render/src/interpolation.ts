/**
 * Interpolation entre les deux dernières frames simulées. Logique pure, sans Three.js.
 *
 * La simulation avance à 60 Hz, l'écran à sa propre fréquence : on affiche un point situé entre
 * la frame précédente et la frame courante. Un déplacement instantané (réapparition, accroche au
 * rebord) n'est pas interpolé, sinon le combattant traverserait l'écran en une image.
 */
import { A_ATTACK, A_DEAD, A_LEDGE, A_LEDGE_GETUP, A_LEDGE_ROLL } from '@game/sim-core';

export interface Track {
  readonly prevX: Float64Array;
  readonly prevY: Float64Array;
  readonly currX: Float64Array;
  readonly currY: Float64Array;
  /** 1 dès qu'un échantillon a été reçu pour cet emplacement. */
  readonly seen: Uint8Array;
}

export function createTrack(capacity: number): Track {
  return {
    prevX: new Float64Array(capacity),
    prevY: new Float64Array(capacity),
    currX: new Float64Array(capacity),
    currY: new Float64Array(capacity),
    seen: new Uint8Array(capacity),
  };
}

/** Oublie tous les échantillons : le prochain de chaque emplacement ne sera pas interpolé. */
export function resetTrack(track: Track): void {
  track.seen.fill(0);
}

/**
 * Enregistre la position de l'emplacement `i` pour la frame courante. Avec `snap`, ou pour un
 * premier échantillon, la position précédente est alignée sur la nouvelle : pas d'interpolation.
 */
export function pushSample(track: Track, i: number, x: number, y: number, snap: boolean): void {
  if (snap || track.seen[i] === 0) {
    track.prevX[i] = x;
    track.prevY[i] = y;
  } else {
    track.prevX[i] = track.currX[i]!;
    track.prevY[i] = track.currY[i]!;
  }
  track.currX[i] = x;
  track.currY[i] = y;
  track.seen[i] = 1;
}

/** Position affichée : `alpha` = 0 donne la frame précédente, 1 la frame courante. */
export function sampleX(track: Track, i: number, alpha: number): number {
  const from = track.prevX[i]!;
  return from + (track.currX[i]! - from) * alpha;
}

export function sampleY(track: Track, i: number, alpha: number): number {
  const from = track.prevY[i]!;
  return from + (track.currY[i]! - from) * alpha;
}

/**
 * Vrai si le passage de `prevAction` à `action` s'accompagne d'un déplacement instantané dans la
 * simulation : réapparition, accroche à un rebord, remontée depuis un rebord.
 */
export function isTeleport(prevAction: number, action: number): boolean {
  if (prevAction === action) return false;
  if (prevAction === A_DEAD) return true;
  if (action === A_LEDGE) return true;
  if (prevAction === A_LEDGE_GETUP || prevAction === A_LEDGE_ROLL) return true;
  // Attaque de rebord : le combattant est posé sur le stage à la frame où elle démarre.
  return prevAction === A_LEDGE && action === A_ATTACK;
}
