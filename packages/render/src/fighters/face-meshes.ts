/**
 * Visages des figurines dessinés pour tous les joueurs en quatre appels de dessin (SPEC-finition.md,
 * phase 2) : blancs des yeux, iris (couleur par joueur), pièces sombres (pupilles, sourcils à la
 * couleur des cheveux, bouche), reflets. Les pièces sont placées dans le repère de la tête.
 */
import {
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Object3D,
} from 'three';
import {
  FACE_FEATURES,
  F_BROW,
  F_IRIS,
  F_MOUTH,
  F_PUPIL,
  F_SHINE,
  F_WHITE,
  type Feature,
} from './face.ts';

const PUPIL = new Color(0x0f0d14);
const MOUTH = new Color(0x4a1a22);

export interface FaceMeshes {
  readonly meshes: readonly InstancedMesh[];
  /** Couleurs du joueur : iris, sourcils. */
  setColors(player: number, iris: number, brows: number): void;
  /**
   * Place le visage du joueur. `head` : matrice de la tête dans le repère du parent des maillages ;
   * `r` : rayon de la tête.
   */
  place(player: number, head: Matrix4, r: number, features: readonly Feature[]): void;
  hide(player: number): void;
  dispose(): void;
}

/** Couleur d'iris tirée de celle des cheveux : foncée, un peu bleutée, toujours lisible. */
export function irisColor(hair: number): number {
  return new Color(hair).multiplyScalar(0.55).lerp(new Color(0x2c5878), 0.45).getHex();
}

export function createFaceMeshes(players: number, parent: Object3D): FaceMeshes {
  const ball = new SphereGeometry(1, 14, 10);
  const white = new MeshStandardMaterial({ color: 0xfbfaf7, roughness: 0.35 });
  const tinted = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const darkTinted = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const glint = new MeshBasicMaterial({ color: 0xffffff });
  const whites = new InstancedMesh(ball, white, players * 2);
  const irises = new InstancedMesh(ball, tinted, players * 2);
  const darks = new InstancedMesh(ball, darkTinted, players * 5);
  const shines = new InstancedMesh(ball, glint, players * 2);
  const meshes = [whites, irises, darks, shines];
  for (const m of meshes) {
    m.frustumCulled = false;
    m.userData.noShadow = true;
    parent.add(m);
  }
  const hidden = new Matrix4().makeScale(0, 0, 0);
  const local = new Matrix4();
  const world = new Matrix4();
  const at = new Vector3();
  const size = new Vector3();
  const turn = new Quaternion();
  const axis = new Vector3(1, 0, 0);
  const color = new Color();

  /** Instance de chaque pièce : maillage et index (par joueur). */
  const slot = (feature: number, player: number): [InstancedMesh, number] => {
    if (feature < F_IRIS) return [whites, player * 2 + feature - F_WHITE];
    if (feature < F_PUPIL) return [irises, player * 2 + feature - F_IRIS];
    if (feature < F_SHINE) return [darks, player * 5 + feature - F_PUPIL];
    if (feature < F_BROW) return [shines, player * 2 + feature - F_SHINE];
    if (feature < F_MOUTH) return [darks, player * 5 + 2 + feature - F_BROW];
    return [darks, player * 5 + 4];
  };

  const api: FaceMeshes = {
    meshes,
    setColors(player, iris, brows) {
      for (let k = 0; k < 2; k++) {
        irises.setColorAt(player * 2 + k, color.set(iris));
        darks.setColorAt(player * 5 + k, PUPIL);
        darks.setColorAt(player * 5 + 2 + k, color.set(brows).multiplyScalar(0.8));
      }
      darks.setColorAt(player * 5 + 4, MOUTH);
      irises.instanceColor!.needsUpdate = true;
      darks.instanceColor!.needsUpdate = true;
    },
    place(player, head, r, features) {
      for (let f = 0; f < FACE_FEATURES; f++) {
        const p = features[f]!;
        turn.setFromAxisAngle(axis, p.roll);
        local.compose(
          at.set(p.x * r, p.y * r, p.z * r),
          turn,
          size.set(p.sx * r, p.sy * r, p.sz * r),
        );
        const [mesh, index] = slot(f, player);
        mesh.setMatrixAt(index, world.multiplyMatrices(head, local));
      }
      for (const m of meshes) m.instanceMatrix.needsUpdate = true;
    },
    hide(player) {
      for (let f = 0; f < FACE_FEATURES; f++) {
        const [mesh, index] = slot(f, player);
        mesh.setMatrixAt(index, hidden);
      }
      for (const m of meshes) m.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      ball.dispose();
      white.dispose();
      tinted.dispose();
      darkTinted.dispose();
      glint.dispose();
      for (const m of meshes) m.dispose();
    },
  };
  for (let p = 0; p < players; p++) {
    api.setColors(p, 0x2c5878, 0x3a2a22);
    api.hide(p);
  }
  return api;
}
