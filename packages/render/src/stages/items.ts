/**
 * Objets et dangers du module stages-items, chacun sous sa forme : galet, bâton, pétard, baie,
 * fiole, explosion, jet de geyser. Une forme = un `InstancedMesh` ; une forme absente de l'écran
 * ne coûte aucun appel de dessin (zéro instance).
 *
 * Les autres entités (projectiles des personnages) restent dessinées par `entities.ts`.
 */
import {
  ITEM_MODE_FREE,
  ITEM_MODE_HELD,
  ITEM_MODE_THROWN,
  MAX_ENTITIES,
  createEntityView,
  createFighterView,
  fxToFloat,
  readEntity,
  readFighter,
  type MoveDef,
  type Sim,
  type SimConfig,
} from '@game/sim-core';
import { isHazardEntity, itemOf, type ItemId } from '@game/stages-items';
import {
  CylinderGeometry,
  DodecahedronGeometry,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  TetrahedronGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { at, facets, merge, seeded } from './lowpoly.ts';

export type ShapeId = ItemId | 'explosion' | 'geyser';

/** Frames de clignotement d'un objet libre avant sa disparition, et durée d'un clignement. */
const BLINK_FRAMES = 120;
const BLINK_PERIOD = 6;

export interface ItemVisuals {
  readonly root: Group;
  /** Vrai si ce type d'entité est dessiné ici plutôt que par `entities.ts`. */
  handles(kind: number): boolean;
  /** Mémorise mode, durée de vie et orientation de chaque emplacement. */
  capture(sim: Sim): void;
  /** Avant de placer les entités d'une image. */
  begin(): void;
  /** Place l'entité de l'emplacement `slot` (gérée ici) à la position interpolée (x, y). */
  set(slot: number, x: number, y: number, frame: number): void;
  /** Après avoir placé les entités d'une image. */
  end(): void;
  /** Nombre d'instances visibles d'une forme à la dernière image (tests). */
  count(shape: ShapeId): number;
}

/** Géométrie d'une forme, à l'échelle 1 (rayon de l'entité = 1). */
function shapeGeometry(shape: ShapeId): BufferGeometry {
  const random = seeded(shape.length * 31 + shape.charCodeAt(0));
  switch (shape) {
    case 'galet':
      return facets(
        at(new IcosahedronGeometry(1, 0), 0, 0, 0, 1.25, 0.8, 1),
        0x9aa0a6,
        0.12,
        random,
      );
    case 'baton':
      // Couché le long de x : 5 fois son rayon de long.
      return facets(
        new CylinderGeometry(0.22, 0.3, 5, 6).rotateZ(Math.PI / 2),
        0x8b5a2b,
        0.1,
        random,
      );
    case 'petard':
      return merge([
        facets(new DodecahedronGeometry(1, 0), 0xc0392b, 0.1, random),
        facets(at(new CylinderGeometry(0.12, 0.12, 0.8, 5), 0, 1.2, 0), 0x2d2d2d, 0, random),
      ]);
    case 'baie':
      return merge([
        facets(new IcosahedronGeometry(1, 1), 0x9b2d6f, 0.1, random),
        facets(at(new TetrahedronGeometry(0.5), 0.2, 1.05, 0, 1, 0.6, 1), 0x4caf50, 0.1, random),
      ]);
    case 'fiole':
      return merge([
        facets(new CylinderGeometry(0.55, 0.8, 1.7, 6), 0x6fe3a8, 0.08, random),
        facets(at(new CylinderGeometry(0.3, 0.3, 0.6, 6), 0, 1.1, 0), 0xc49a6c, 0.05, random),
      ]);
    case 'explosion':
      return facets(new IcosahedronGeometry(1, 1), 0xffa53d, 0.25, random);
    case 'geyser':
      // Colonne qui part de sa base (y = 0) ; mise à l'échelle par le rayon et la hauteur.
      return facets(
        new CylinderGeometry(0.85, 1, 1, 8, 3, true).translate(0, 0.5, 0),
        0xe4f7ff,
        0.1,
        random,
      );
  }
}

function shapeMaterial(shape: ShapeId): Material {
  if (shape === 'explosion') {
    return new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75 });
  }
  if (shape === 'geyser') {
    return new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
  }
  return new MeshStandardMaterial({ vertexColors: true, flatShading: true });
}

const SHAPES: readonly ShapeId[] = [
  'galet',
  'baton',
  'petard',
  'baie',
  'fiole',
  'explosion',
  'geyser',
];

export function createItemVisuals(config: SimConfig): ItemVisuals {
  const defs = config.entities ?? [];
  // Forme de chaque type d'entité (index + 1), ou -1 si elle n'est pas dessinée ici.
  const shapeOfKind = new Int32Array(defs.length + 1).fill(-1);
  const radius = new Float64Array(defs.length + 1);
  const height = new Float64Array(defs.length + 1);
  const lifetime = new Int32Array(defs.length + 1);
  const bursts = new Set(defs.map((def) => def.item?.burst).filter((k) => k !== undefined));
  defs.forEach((def, k) => {
    const kind = k + 1;
    const item = itemOf(config, kind);
    const shape: ShapeId | undefined =
      item ??
      (isHazardEntity(config, kind) ? 'geyser' : bursts.has(kind) ? 'explosion' : undefined);
    if (shape === undefined) return;
    shapeOfKind[kind] = SHAPES.indexOf(shape);
    radius[kind] = fxToFloat(def.radius);
    height[kind] = def.height === undefined ? 0 : fxToFloat(def.height);
    lifetime[kind] = def.lifetime;
  });

  const root = new Group();
  root.name = 'items';
  const meshes = SHAPES.map((shape) => {
    const mesh = new InstancedMesh(shapeGeometry(shape), shapeMaterial(shape), MAX_ENTITIES);
    mesh.name = `item-${shape}`;
    mesh.frustumCulled = false;
    mesh.count = 0;
    root.add(mesh);
    return mesh;
  });
  const counts = new Int32Array(SHAPES.length);
  const shown = new Int32Array(SHAPES.length);

  const kindAt = new Int32Array(MAX_ENTITIES);
  const modeAt = new Int32Array(MAX_ENTITIES);
  const lifeAt = new Int32Array(MAX_ENTITIES);
  const facingAt = new Int8Array(MAX_ENTITIES);
  const entity = createEntityView();
  const fighter = createFighterView();

  const matrix = new Matrix4();
  const position = new Vector3();
  const rotation = new Quaternion();
  const euler = new Euler();
  const scale = new Vector3();

  return {
    root,
    handles: (kind) => kind > 0 && kind < shapeOfKind.length && shapeOfKind[kind]! >= 0,

    capture(sim) {
      for (let slot = 0; slot < MAX_ENTITIES; slot++) {
        if (!readEntity(sim, slot, entity)) {
          kindAt[slot] = 0;
          continue;
        }
        kindAt[slot] = entity.kind;
        modeAt[slot] = entity.mode;
        lifeAt[slot] = entity.life;
        let facing = entity.velX < 0 ? -1 : 1;
        if (entity.mode === ITEM_MODE_HELD && entity.owner >= 0) {
          readFighter(sim, entity.owner, fighter);
          facing = fighter.facing;
        }
        facingAt[slot] = facing;
      }
    },

    begin() {
      counts.fill(0);
    },

    set(slot, x, y, frame) {
      const kind = kindAt[slot]!;
      if (kind === 0) return;
      const s = shapeOfKind[kind]!;
      if (s < 0) return;
      const shape = SHAPES[s]!;
      const mode = modeAt[slot]!;
      const life = lifeAt[slot]!;
      // Un objet libre qui va disparaître clignote.
      if (mode === ITEM_MODE_FREE && life < BLINK_FRAMES && ((life / BLINK_PERIOD) | 0) % 2 === 1) {
        return;
      }
      const r = radius[kind]!;
      euler.set(0, 0, 0);
      if (shape === 'geyser') {
        scale.set(r, height[kind]!, r);
        euler.y = frame * 0.2;
      } else if (shape === 'explosion') {
        // Elle enfle pendant sa courte vie.
        const grown = 1 - life / Math.max(1, lifetime[kind]!);
        const k = r * (0.55 + 0.45 * grown);
        scale.set(k, k, k);
        euler.y = frame * 0.3;
      } else {
        scale.set(r, r, r);
        if (mode === ITEM_MODE_THROWN) euler.z = -facingAt[slot]! * frame * 0.35;
        else if (mode === ITEM_MODE_HELD && shape === 'baton') euler.z = 0.5 * facingAt[slot]!;
        else if (mode === ITEM_MODE_FREE && shape === 'baton') euler.z = 0;
      }
      rotation.setFromEuler(euler);
      position.set(x, y, 0);
      matrix.compose(position, rotation, scale);
      const mesh = meshes[s]!;
      mesh.setMatrixAt(counts[s]!, matrix);
      counts[s] = counts[s]! + 1;
    },

    end() {
      for (let s = 0; s < SHAPES.length; s++) {
        const mesh = meshes[s]!;
        const n = counts[s]!;
        mesh.count = n;
        mesh.visible = n > 0;
        if (n > 0) mesh.instanceMatrix.needsUpdate = true;
        shown[s] = n;
      }
    },

    count: (shape) => shown[SHAPES.indexOf(shape)]!,
  };
}

/**
 * Coup de l'objet à frapper de la configuration, pour rythmer la pose et la vue technique.
 * La v1 n'a qu'un objet à frapper (le bâton) : le premier trouvé fait foi.
 */
export function swingOf(config: SimConfig): MoveDef | undefined {
  return config.entities?.find((def) => def.item?.swing !== undefined)?.item?.swing;
}
