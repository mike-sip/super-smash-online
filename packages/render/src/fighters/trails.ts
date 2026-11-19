/**
 * Traînées des coups (SPEC-visuals.md, phase 5) : un ruban lumineux suit la main ou le pied qui
 * frappe pendant les frames actives, s'amincit et s'éteint en quelques frames. Tous les rubans de
 * tous les joueurs tiennent dans un seul objet : un appel de dessin.
 *
 * Le temps est celui de la simulation (frames) : en pause, le ruban se fige ; un échantillon n'est
 * ajouté que lorsque le temps a avancé.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
} from 'three';

/** Échantillons gardés par ruban, durée de vie d'un échantillon (frames), écart minimal. */
const SAMPLES = 24;
export const TRAIL_LIFE = 5;
const MIN_GAP = 0.2;
/** Demi-largeur du ruban à sa tête, en unités de jeu. */
const HALF_WIDTH = 0.9;

export interface Trails {
  readonly mesh: Mesh;
  /** Ajoute la position (x, y, z) du membre qui frappe pour le joueur, à l'instant `time`. */
  push(player: number, time: number, x: number, y: number, z: number): void;
  /** Couleur (en lumière, composantes pouvant dépasser 1) du ruban d'un joueur. */
  color(player: number, r: number, g: number, b: number): void;
  /** Reconstruit les rubans pour l'instant `time`. */
  update(time: number): void;
  /** Échantillons vivants d'un joueur à l'instant `time` (pour les tests). */
  live(player: number, time: number): number;
  dispose(): void;
}

export function createTrails(players: number): Trails {
  const xs = new Float32Array(players * SAMPLES);
  const ys = new Float32Array(players * SAMPLES);
  const zs = new Float32Array(players * SAMPLES);
  const ts = new Float32Array(players * SAMPLES).fill(-Infinity);
  const head = new Int32Array(players);
  const tint = new Float32Array(players * 3).fill(2);

  const vertices = players * SAMPLES * 2;
  const positions = new Float32Array(vertices * 3);
  const colors = new Float32Array(vertices * 4);
  const geometry = new BufferGeometry();
  const position = new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage);
  const color = new BufferAttribute(colors, 4).setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', position);
  geometry.setAttribute('color', color);
  const index: number[] = [];
  for (let p = 0; p < players; p++) {
    for (let k = 0; k < SAMPLES - 1; k++) {
      const a = (p * SAMPLES + k) * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geometry.setIndex(index);
  const material = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'trails';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.userData.noShadow = true;

  return {
    mesh,
    push(player, time, x, y, z) {
      const base = player * SAMPLES;
      const last = base + head[player]!;
      if (time - ts[last]! < MIN_GAP && Number.isFinite(ts[last]!)) return;
      const next = (head[player]! + 1) % SAMPLES;
      head[player] = next;
      xs[base + next] = x;
      ys[base + next] = y;
      zs[base + next] = z;
      ts[base + next] = time;
    },
    color(player, r, g, b) {
      tint[player * 3] = r;
      tint[player * 3 + 1] = g;
      tint[player * 3 + 2] = b;
    },
    update(time) {
      for (let p = 0; p < players; p++) {
        const base = p * SAMPLES;
        // Du plus ancien (k = 0) au plus récent (k = SAMPLES - 1).
        for (let k = 0; k < SAMPLES; k++) {
          const s = base + ((head[p]! + 1 + k) % SAMPLES);
          const age = time - ts[s]!;
          const alive = age >= 0 && age < TRAIL_LIFE;
          const fade = alive ? 1 - age / TRAIL_LIFE : 0;
          // Direction locale du ruban : vers l'échantillon suivant (ou précédent pour le dernier).
          const n = base + ((head[p]! + 1 + Math.min(k + 1, SAMPLES - 1)) % SAMPLES);
          const m = base + ((head[p]! + 1 + Math.max(k - 1, 0)) % SAMPLES);
          let dx = xs[n]! - xs[m]!;
          let dy = ys[n]! - ys[m]!;
          const len = Math.hypot(dx, dy) || 1;
          dx /= len;
          dy /= len;
          const w = HALF_WIDTH * fade;
          const v = (base + k) * 2;
          positions[v * 3] = xs[s]! - dy * w;
          positions[v * 3 + 1] = ys[s]! + dx * w;
          positions[v * 3 + 2] = zs[s]!;
          positions[v * 3 + 3] = xs[s]! + dy * w;
          positions[v * 3 + 4] = ys[s]! - dx * w;
          positions[v * 3 + 5] = zs[s]!;
          const a = fade * fade;
          for (let e = 0; e < 2; e++) {
            const c = (v + e) * 4;
            colors[c] = tint[p * 3]!;
            colors[c + 1] = tint[p * 3 + 1]!;
            colors[c + 2] = tint[p * 3 + 2]!;
            colors[c + 3] = a;
          }
        }
      }
      position.needsUpdate = true;
      color.needsUpdate = true;
    },
    live(player, time) {
      let n = 0;
      for (let k = 0; k < SAMPLES; k++) {
        const age = time - ts[player * SAMPLES + k]!;
        if (age >= 0 && age < TRAIL_LIFE) n++;
      }
      return n;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
