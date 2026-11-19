/**
 * Projectiles : une sphère lumineuse par entité, dessinées ensemble par instances, à la couleur du
 * thème de celui qui l'a lancée (SPEC-visuals.md, phase 4). Leur traînée est faite de particules
 * (`vfx/library.ts`).
 */
import { MAX_ENTITIES, fxToFloat, type SimConfig } from '@game/sim-core';
import { Color, InstancedMesh, Matrix4, MeshBasicMaterial, SphereGeometry } from 'three';

/** Couleurs par type d'entité, reprises en boucle au-delà. */
export const ENTITY_COLORS: readonly number[] = [0xfff3b0, 0xffffff, 0x9bf6ff, 0xffadad];

/** Couleur des projectiles de chaque thème d'effets. */
export const THEME_ENTITY_COLORS: Readonly<Record<string, number>> = {
  wind: 0xc8f6ff,
  feather: 0xffe6b0,
  ember: 0xff8a3d,
  pearl: 0xf4f8ff,
};
/** Intensité lumineuse des projectiles (au-delà de 1 : ils rayonnent). */
const ENTITY_GLOW = 2.2;

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
  /** Montre l'entité de l'emplacement `slot` lancée par `owner` (-1 : personne) ; `kind` = 0 la cache. */
  set(slot: number, kind: number, x: number, y: number, owner: number): void;
  dispose(): void;
}

export function createEntityVisuals(
  config: SimConfig,
  themeOf: (owner: number) => string | undefined = () => undefined,
): EntityVisuals {
  const defs = config.entities ?? [];
  const radii = defs.map((def) => fxToFloat(def.radius));
  const geometry = new SphereGeometry(1, 12, 8);
  const material = new MeshBasicMaterial({
    color: new Color(ENTITY_GLOW, ENTITY_GLOW, ENTITY_GLOW),
  });
  const mesh = new InstancedMesh(geometry, material, MAX_ENTITIES);
  mesh.name = 'entities';
  mesh.frustumCulled = false;

  const matrix = new Matrix4();
  const color = new Color();
  const shownKind = new Int32Array(MAX_ENTITIES).fill(-1);
  const shownOwner = new Int32Array(MAX_ENTITIES).fill(-2);
  for (let slot = 0; slot < MAX_ENTITIES; slot++) {
    mesh.setMatrixAt(slot, matrix.makeScale(0, 0, 0));
    mesh.setColorAt(slot, color.setHex(0xffffff));
  }

  return {
    mesh,
    set(slot, kind, x, y, owner) {
      const radius = kind === 0 ? 0 : (radii[kind - 1] ?? 1);
      mesh.setMatrixAt(slot, matrix.makeScale(radius, radius, radius).setPosition(x, y, 0));
      mesh.instanceMatrix.needsUpdate = true;
      if (kind !== 0 && (shownKind[slot] !== kind || shownOwner[slot] !== owner)) {
        shownKind[slot] = kind;
        shownOwner[slot] = owner;
        const themed = THEME_ENTITY_COLORS[themeOf(owner) ?? ''];
        mesh.setColorAt(
          slot,
          color.setHex(themed ?? ENTITY_COLORS[(kind - 1) % ENTITY_COLORS.length]!),
        );
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
