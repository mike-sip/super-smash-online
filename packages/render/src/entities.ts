/** Projectiles et objets : une sphère par entité, dessinées ensemble par instances. */
import { MAX_ENTITIES, fxToFloat, type SimConfig } from '@game/sim-core';
import { Color, InstancedMesh, Matrix4, MeshLambertMaterial, SphereGeometry } from 'three';

/** Couleurs par type d'entité, reprises en boucle au-delà. */
export const ENTITY_COLORS: readonly number[] = [0xfff3b0, 0xffffff, 0x9bf6ff, 0xffadad];

/**
 * Vrai si l'emplacement contient une autre entité qu'à la frame précédente : sa position ne doit
 * pas être interpolée depuis celle de l'ancienne. Une durée de vie ne fait que décroître ; si
 * elle remonte, l'emplacement a été réutilisé.
 */
export function isNewEntity(
  prevKind: number,
  prevLife: number,
  kind: number,
  life: number,
): boolean {
  return prevKind !== kind || life > prevLife;
}

export interface EntityVisuals {
  readonly mesh: InstancedMesh;
  /** Montre l'entité de l'emplacement `slot` ; `kind` = 0 la cache. */
  set(slot: number, kind: number, x: number, y: number): void;
  dispose(): void;
}

export function createEntityVisuals(config: SimConfig): EntityVisuals {
  const defs = config.entities ?? [];
  const radii = defs.map((def) => fxToFloat(def.radius));
  const geometry = new SphereGeometry(1, 12, 8);
  const material = new MeshLambertMaterial({ color: 0xffffff, emissive: 0x333333 });
  const mesh = new InstancedMesh(geometry, material, MAX_ENTITIES);
  mesh.name = 'entities';
  mesh.frustumCulled = false;

  const matrix = new Matrix4();
  const color = new Color();
  const shownKind = new Int32Array(MAX_ENTITIES).fill(-1);
  for (let slot = 0; slot < MAX_ENTITIES; slot++) {
    mesh.setMatrixAt(slot, matrix.makeScale(0, 0, 0));
    mesh.setColorAt(slot, color.setHex(0xffffff));
  }

  return {
    mesh,
    set(slot, kind, x, y) {
      const radius = kind === 0 ? 0 : (radii[kind - 1] ?? 1);
      mesh.setMatrixAt(slot, matrix.makeScale(radius, radius, radius).setPosition(x, y, 0));
      mesh.instanceMatrix.needsUpdate = true;
      if (kind !== 0 && shownKind[slot] !== kind) {
        shownKind[slot] = kind;
        mesh.setColorAt(slot, color.setHex(ENTITY_COLORS[(kind - 1) % ENTITY_COLORS.length]!));
        mesh.instanceColor!.needsUpdate = true;
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
