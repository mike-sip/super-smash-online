/**
 * Figurines (SPEC-visuals.md, phase 3) : des corps lisses déformés par un squelette, à la place
 * des mannequins en boîtes. Même interface (`FighterVisuals`), mêmes poses (`driver.ts`).
 *
 * Pour chaque personnage, les volumes (`body.ts`) sont convertis une fois en maillage, puis gardés
 * en mémoire pour les renderers suivants. Chaque joueur a son squelette et sa matière ; la couleur
 * d'un sommet vient de sa zone et de la palette du joueur, dans le shader.
 *
 * Appels de dessin par joueur : le corps, son ombre, et son contour en qualité haute ; les yeux et
 * les bouches de tous les joueurs tiennent en deux appels.
 */
import {
  A_ATTACK,
  A_CROUCH,
  A_DEAD,
  A_GRAB,
  A_GRABBING,
  A_HELPLESS,
  A_HITSTUN,
  A_IDLE,
  A_ITEM_SWING,
  A_ITEM_THROW,
  A_LEDGE,
  A_SHIELD,
  A_TUMBLE,
  fxToFloat,
} from '@game/sim-core';
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SkinnedMesh,
  Vector3,
  Vector4,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { QualityPreset } from '../quality.ts';
import {
  MESH_REGIONS,
  figurineDims,
  figurineSculpt,
  paletteOf,
  type FigurineStyle,
  type VfxTheme,
} from './body.ts';
import { createPoseDriver, type PoseDriver } from './driver.ts';
import { createChain, resetChain, stepChain, type Chain } from './dynamics.ts';
import { squashOf, type Squash } from './squash.ts';
import { createTrails } from './trails.ts';
import { isTeleport } from '../interpolation.ts';
import { DETAIL_GLSL, zoneMaterials, type ZoneMaterials } from './materials.ts';
import { createExpression, createFace, expressionOf, faceLayout } from './face.ts';
import { createFaceMeshes, irisColor } from './face-meshes.ts';
import { dimsOf, type Dims } from './mannequin.ts';
import { meshRegions, type MeshData } from './mesher.ts';
import { SPIN_PIVOT_Y, type Pose } from './poses.ts';
import { BONES, ZONES, compileSculpt, type ZoneName } from './sdf.ts';
import { createRig, type Rig } from './skeleton.ts';
import { PLAYER_COLORS, type FighterVisuals, type FighterVisualsFactory } from './visual.ts';

/** Côté d'une cellule du maillage du corps, en hauteurs de combattant (tête et mains : plus fin). */
const CELL = 1 / 70;
/** Estompe de peau des doigts : ils plient net aux jointures. */
const HAND_FALLOFF = 0.006;
const REGIONS = MESH_REGIONS.map((r) => ({
  bones: r.bones.map((b) => BONES.indexOf(b)),
  cell: r.cell,
  ...(r.bones.includes('fingersF') ? { falloff: HAND_FALLOFF } : {}),
}));

/**
 * Fermeture de la main selon l'action : poing pendant un coup, prise (saisie, rebord, objet),
 * ouverte quand on est touché ou éjecté, à demi fermée au repos. De 0 (ouverte) à 1 (poing).
 */
export function handCurl(action: number): number {
  if (action === A_ATTACK) return 1;
  if (
    action === A_GRAB ||
    action === A_GRABBING ||
    action === A_LEDGE ||
    action === A_ITEM_SWING ||
    action === A_ITEM_THROW
  ) {
    return 0.8;
  }
  if (action === A_HITSTUN || action === A_TUMBLE || action === A_HELPLESS) return 0.05;
  return 0.45;
}
/** Vitesse de la respiration au repos, en radians par frame (~3,5 s par cycle). */
const BREATH_RATE = 0.03;

/**
 * Regard vers l'adversaire le plus proche (positions vues à la dernière image), en rayons de tête :
 * vers le haut ou le bas s'il est devant, vers la caméra s'il est derrière.
 */
export function gazeOf(
  player: number,
  x: number,
  y: number,
  facing: number,
  seenX: ArrayLike<number>,
  seenY: ArrayLike<number>,
): { y: number; z: number } {
  let best = Infinity;
  let dx = 0;
  let dy = 0;
  for (let j = 0; j < seenX.length; j++) {
    if (j === player || Number.isNaN(seenX[j]!)) continue;
    const ex = seenX[j]! - x;
    const ey = seenY[j]! - y;
    const d = ex * ex + ey * ey;
    if (d < best) {
      best = d;
      dx = ex;
      dy = ey;
    }
  }
  if (best === Infinity) return { y: 0, z: 0 };
  const ahead = dx * facing > 0;
  return {
    y: Math.max(-1, Math.min(1, dy / 50)) * (ahead ? 0.06 : 0.03),
    z: ahead ? 0 : facing * 0.05,
  };
}
/** Part du chemin vers la fermeture voulue parcourue à chaque frame. */
const HAND_RATE = 0.35;
/** Rotation du corps vers la caméra : on voit les visages de trois quarts, comme dans le genre. */
const FACE_CAMERA = 0.35;
/** La tête se tourne encore un peu plus : le visage se lit, la silhouette du corps reste fidèle. */
const HEAD_TURN = 0.5;
/** Couleur des traînées de coups par thème d'effets (en lumière). */
const TRAIL_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
  wind: [1.5, 2.5, 2.7],
  feather: [2.7, 2.2, 1.4],
  ember: [3.6, 1.4, 0.3],
  pearl: [2.2, 2.4, 2.7],
};
/** Bouts des membres qui peuvent frapper : os et point de frappe dans son repère. */
const STRIKERS = [
  ['handF', 0, -0.05, 0],
  ['handB', 0, -0.05, 0],
  ['footF', 0.06, -0.015, 0],
  ['footB', 0.06, -0.015, 0],
] as const;

/** Vrai pendant les frames actives d'un coup (une frame de marge de part et d'autre). */
export function striking(action: number, frame: number, start: number, end: number): boolean {
  return (
    (action === A_ATTACK || action === A_ITEM_SWING) &&
    start > 0 &&
    frame >= start - 1 &&
    frame <= end + 1
  );
}

/** Durée de l'entrée en scène, en frames. */
const ENTRANCE_FRAMES = 30;

/** Échelle de la figurine pendant son entrée en scène : de 0 à 1 avec un léger dépassement. */
export function entrance(time: number): number {
  if (time >= ENTRANCE_FRAMES) return 1;
  const t = Math.max(0, time) / ENTRANCE_FRAMES - 1;
  return 1 + 2.4 * t * t * t + 1.4 * t * t;
}

/** Saut de temps au-delà duquel les ressorts repartent du repos, en frames. */
const MAX_SPRING_STEP = 4;
/** Part du balancement des cheveux reprise par la jupe, plus lourde. */
const SKIRT_SWAY = 0.6;
/** Épaisseur du contour, en hauteurs de combattant. */
export const OUTLINE = 0.007;
/** Part de blanc mêlée à la couleur d'un combattant intangible. */
const PALE_MIX = 0.6;

/** Maillages déjà calculés, par style (objet figé du module `fighters`) : calculés une fois. */
const meshCache = new WeakMap<object, MeshData>();
const DEFAULT_KEY = {};

/** `d` : dimensions du mannequin (le corps est sculpté à sa taille, puis agrandi aux extrémités). */
function meshFor(style: FigurineStyle | undefined, d: Dims, rig: Rig): MeshData {
  const key = style ?? DEFAULT_KEY;
  let mesh = meshCache.get(key);
  if (mesh === undefined) {
    mesh = meshRegions(compileSculpt(figurineSculpt(d, style), rig.bind), REGIONS, CELL);
    meshCache.set(key, mesh);
  }
  return mesh;
}

function geometryOf(mesh: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  g.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  g.setAttribute('aZone', new BufferAttribute(mesh.zones, 1));
  g.setAttribute('aZone2', new BufferAttribute(mesh.zones2, 1));
  g.setAttribute('aZoneMix', new BufferAttribute(mesh.zoneMix, 1));
  g.setAttribute('skinIndex', new BufferAttribute(mesh.skinIndex, 4));
  g.setAttribute('skinWeight', new BufferAttribute(mesh.skinWeight, 4));
  g.setIndex(new BufferAttribute(mesh.index, 1));
  g.computeBoundingSphere();
  return g;
}

interface FigurineUniforms {
  readonly uPalette: { value: Color[] };
  readonly uPale: { value: number };
  readonly uFlash: { value: number };
  /** Intensité de la zone qui rayonne (0 : aucune zone ne rayonne). */
  readonly uGlow: { value: number };
}

/** Rayonnement de la zone incandescente, au repos et en pleine charge. */
const GLOW_IDLE = 0.6;
const GLOW_CHARGED = 4;
/** Frames de charge au bout desquelles l'embrasement est complet. */
const CHARGE_FULL = 40;

/**
 * Matière d'un joueur : couleur par zone (palette), pâleur d'intangibilité, éclat d'impact, zone
 * qui rayonne et zone irisée (indices de zone, -1 pour aucune).
 */
function figurineMaterial(
  palette: readonly number[],
  emissiveZone: number,
  iridescentZone: number,
  zones: ZoneMaterials = zoneMaterials(),
): { material: MeshStandardMaterial; uniforms: FigurineUniforms } {
  const mats = {
    uMat: { value: zones.params.map((p) => new Vector4(...p)) },
    uPat: { value: zones.patterns.map((p) => new Vector4(...p)) },
    uSkinZone: { value: [...zones.skin] },
  };
  const uniforms: FigurineUniforms = {
    uPalette: { value: palette.map((c) => new Color(c)) },
    uPale: { value: 0 },
    uFlash: { value: 0 },
    uGlow: { value: emissiveZone >= 0 ? GLOW_IDLE : 0 },
  };
  const zoneWeight = (target: number): string =>
    target < 0
      ? '0.0'
      : `mix( step( abs( aZone - ${target}.0 ), 0.5 ), step( abs( aZone2 - ${target}.0 ), 0.5 ), aZoneMix )`;
  const material = new MeshStandardMaterial({ roughness: 0.58, metalness: 0, vertexColors: true });
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms, mats);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          `uniform vec4 uMat[ ${palette.length} ];`,
          `uniform vec4 uPat[ ${palette.length} ];`,
          `uniform float uSkinZone[ ${palette.length} ];`,
          'varying vec4 vMat;',
          'varying vec4 vPat;',
          'varying float vSkin;',
          'varying vec3 vBind;',
          'attribute float aZone;',
          'attribute float aZone2;',
          'attribute float aZoneMix;',
          `uniform vec3 uPalette[ ${palette.length} ];`,
          'uniform float uPale;',
          'varying vec3 vZoneColor;',
          'varying float vGlowZone;',
          'varying float vIridZone;',
        ].join('\n'),
      )
      .replace(
        '#include <color_vertex>',
        [
          '#include <color_vertex>',
          'vec3 zoneColor = mix( uPalette[ int( aZone + 0.5 ) ], uPalette[ int( aZone2 + 0.5 ) ], aZoneMix );',
          'vColor.rgb = mix( zoneColor, vec3( 1.0 ), uPale );',
          'vZoneColor = zoneColor;',
          // Matière de la zone (et de sa voisine, en douceur) ; position de référence du sommet.
          'int zA = int( aZone + 0.5 );',
          'int zB = int( aZone2 + 0.5 );',
          'vMat = mix( uMat[ zA ], uMat[ zB ], aZoneMix );',
          'vPat = mix( uPat[ zA ], uPat[ zB ], aZoneMix );',
          'vSkin = mix( uSkinZone[ zA ], uSkinZone[ zB ], aZoneMix );',
          'vBind = position;',
          `vGlowZone = ${zoneWeight(emissiveZone)};`,
          `vIridZone = ${zoneWeight(iridescentZone)};`,
        ].join('\n'),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <roughnessmap_fragment>',
        [
          // Relief généré de la matière : il module aussi la rugosité.
          'float fPx = length( fwidth( vBind ) );',
          'float fHeight = figurineDetail( vBind, vPat, fPx );',
          'float roughnessFactor = clamp( vMat.x * ( 0.93 + 0.12 * fHeight ), 0.05, 1.0 );',
        ].join('\n'),
      )
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vMat.y;')
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nnormal = figurineBump( -vViewPosition, normal, fHeight * vMat.z * 0.018 );',
      )
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform float uFlash;',
          'uniform float uGlow;',
          'varying vec4 vMat;',
          'varying vec4 vPat;',
          'varying float vSkin;',
          'varying vec3 vBind;',
          DETAIL_GLSL,
          'varying vec3 vZoneColor;',
          'varying float vGlowZone;',
          'varying float vIridZone;',
        ].join('\n'),
      )
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          'totalEmissiveRadiance += vec3( uFlash ) + vZoneColor * vGlowZone * uGlow;',
          // Lustre des tissus et des cheveux sur les bords ; lumière qui diffuse sous la peau.
          'float fFacing = saturate( dot( normal, normalize( vViewPosition ) ) );',
          'totalEmissiveRadiance += vZoneColor * vMat.w * pow( 1.0 - fFacing, 3.0 ) * 0.35;',
          'totalEmissiveRadiance += vZoneColor * vSkin * vec3( 0.1, 0.04, 0.03 );',
          // Irisation : un arc-en-ciel discret qui glisse avec l'angle de vue.
          'float iridFacing = 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) );',
          'vec3 rainbow = 0.5 + 0.5 * cos( 6.2832 * ( iridFacing * 1.3 + vec3( 0.0, 0.33, 0.67 ) ) );',
          'totalEmissiveRadiance += rainbow * vIridZone * ( 0.12 + 0.45 * iridFacing * iridFacing );',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => `figurine|${emissiveZone}|${iridescentZone}`;
  return { material, uniforms };
}

/**
 * Contour : la même peau, gonflée le long des normales, vue de dos, sombre. `thickness` : épaisseur
 * dans le repère du maillage, avant sa mise à l'échelle.
 */
export function outlineMaterial(thickness = OUTLINE): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ color: 0x12141b, side: BackSide });
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uOutline = { value: thickness };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutline;')
      .replace(
        '#include <skinning_vertex>',
        [
          '#include <skinning_vertex>',
          '#ifdef USE_SKINNING',
          'transformed += normalize( objectNormal ) * uOutline;',
          '#else',
          'transformed += normalize( normal ) * uOutline;',
          '#endif',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => 'figurine-outline';
  return material;
}

interface Body {
  readonly anchor: Group;
  readonly pose: Group;
  readonly rig: Rig;
  readonly mesh: SkinnedMesh;
  readonly outline: SkinnedMesh;
  readonly uniforms: FigurineUniforms;
  readonly driver: PoseDriver;
  readonly scale: number;
  readonly headRadius: number;
  readonly glows: boolean;
  readonly theme: VfxTheme | undefined;
  clock: number;
  /** Instant de la dernière image (frames) et action vue, pour les ressorts. */
  lastTime: number;
  lastAction: number;
  readonly hair: Chain;
  readonly cloth: Chain;
  readonly skirt: Chain;
  /** Membre qui frappe (indice dans STRIKERS, -1 : aucun) et position précédente des bouts. */
  striker: number;
  readonly tips: Float64Array;
  pale: boolean;
  /** Fermeture actuelle de la main (lissée d'une frame à l'autre). */
  hand: number;
}

/**
 * Maillage et squelette d'une figurine, sans matière : pour l'export en glTF
 * (`tools/bake-figurine.ts`). Le maillage garde ses attributs de zone (`aZone`, `aZone2`,
 * `aZoneMix`) ; ses unités sont celles du squelette (hauteur `1 / dims.normalize`).
 */
export function figurineBody(style: FigurineStyle | undefined): {
  rig: Rig;
  geometry: BufferGeometry;
  dims: Dims;
} {
  const base = dimsOf(style);
  const dims = figurineDims(base);
  const rig = createRig(dims);
  return { rig, geometry: geometryOf(meshFor(style, base, rig)), dims };
}

/** Une figurine seule, hors combat : pour les portraits et l'écran de victoire (phase 7). */
export interface FigurineModel {
  /** Repère du corps, à l'échelle d'un combattant d'une hauteur 1 (pieds à l'origine). */
  readonly root: Group;
  /** Oriente le squelette selon `pose`, tête tournée de `headTurn`, visage selon `face`. */
  apply(
    pose: Pose,
    headTurn: number,
    eyes: number,
    mouth: number,
    brow?: number,
    hands?: number,
  ): void;
  setQuality(outline: boolean): void;
  dispose(): void;
}

export function createFigurineModel(
  style: FigurineStyle | undefined,
  variant: number,
  player = 0,
): FigurineModel {
  const base = dimsOf(style);
  const d = figurineDims(base);
  const rig = createRig(d);
  const geometry = geometryOf(meshFor(style, base, rig));
  const zone = (name: ZoneName | undefined): number =>
    name === undefined ? -1 : ZONES.indexOf(name);
  const { material } = figurineMaterial(
    paletteOf(style, player, variant),
    zone(style?.emissive),
    zone(style?.iridescent),
    zoneMaterials(style?.materials),
  );
  const mesh = new SkinnedMesh(geometry, material);
  const outline = outlineMaterial();
  const line = new SkinnedMesh(geometry, outline);
  rig.root.add(mesh, line);
  mesh.bind(rig.skeleton);
  line.bind(rig.skeleton);
  mesh.frustumCulled = false;
  line.frustumCulled = false;

  // Visage : mêmes pièces et mêmes places que dans le combat, dans le repère du squelette.
  const palette = paletteOf(style, player, variant);
  const hair = palette[ZONES.indexOf('hair')]!;
  const face = createFaceMeshes(1, rig.root);
  face.setColors(0, irisColor(hair), hair);
  const features = createFace();
  const expression = createExpression();
  const head = rig.bone('head');
  const toRig = new Matrix4();
  const headInRig = new Matrix4();
  const r = d.headRadius;

  const root = new Group();
  root.scale.setScalar(d.normalize);
  root.add(rig.root);
  return {
    root,
    apply(pose, headTurn, open, talk, brow = 0, hands = 0.45) {
      rig.apply(pose, headTurn);
      rig.setHands(hands, hands);
      root.updateMatrixWorld(true);
      expression.eyes = open;
      expression.mouth = talk;
      expression.brow = brow;
      faceLayout(expression, 0, 0, features);
      headInRig.multiplyMatrices(toRig.copy(rig.root.matrixWorld).invert(), head.matrixWorld);
      face.place(0, headInRig, r, features);
    },
    setQuality(lines) {
      line.visible = lines;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      outline.dispose();
      face.dispose();
      rig.skeleton.dispose();
    },
  };
}

/**
 * Figurines : `styleOf(player)` donne le style de chaque joueur (celui du mannequin, plus des
 * volumes et teintes facultatifs), ou `undefined` pour la figurine standard aux couleurs du joueur ;
 * `paletteOf(player)` la couleur alternative choisie (0 par défaut).
 */
export function createFigurines(
  styleOf: (player: number) => FigurineStyle | undefined,
  variantOf: (player: number) => number = () => 0,
): FighterVisualsFactory {
  return (config) => {
    const players = config.fighters.length;
    const root = new Group();
    root.name = 'fighters';
    const swing = config.entities?.find((def) => def.item?.swing !== undefined)?.item?.swing;
    const geometries = new Map<MeshData, BufferGeometry>();
    const outline = outlineMaterial();

    // Visages de tous les joueurs : quatre appels de dessin.
    const faces = createFaceMeshes(players, root);
    const features = createFace();
    // Dernière position de chaque joueur, pour que le regard suive l'adversaire le plus proche.
    const seenX = new Float64Array(players).fill(Number.NaN);
    const seenY = new Float64Array(players);

    const bodies: Body[] = [];
    for (let i = 0; i < players; i++) {
      const def = config.fighters[i]!;
      const style = styleOf(i);
      const base = dimsOf(style);
      const d = figurineDims(base);
      const rig = createRig(d);
      const data = meshFor(style, base, rig);
      let geometry = geometries.get(data);
      if (geometry === undefined) {
        geometry = geometryOf(data);
        geometries.set(data, geometry);
      }
      const zone = (name: ZoneName | undefined): number =>
        name === undefined ? -1 : ZONES.indexOf(name);
      const palette = paletteOf(style, i, variantOf(i));
      const hair = palette[ZONES.indexOf('hair')]!;
      faces.setColors(i, irisColor(hair), hair);
      const { material, uniforms } = figurineMaterial(
        palette,
        zone(style?.emissive),
        zone(style?.iridescent),
        zoneMaterials(style?.materials),
      );
      const mesh = new SkinnedMesh(geometry, material);
      mesh.name = `figurine-${i}`;
      mesh.frustumCulled = false;
      const line = new SkinnedMesh(geometry, outline);
      line.name = `outline-${i}`;
      line.frustumCulled = false;
      line.userData.noShadow = true;
      line.visible = false;
      rig.root.add(mesh, line);
      mesh.bind(rig.skeleton);
      line.bind(rig.skeleton);

      const anchor = new Group();
      anchor.name = `fighter-${i}`;
      anchor.visible = false;
      const pose = new Group();
      pose.matrixAutoUpdate = false;
      pose.add(rig.root);
      anchor.add(pose);
      root.add(anchor);
      bodies.push({
        anchor,
        pose,
        rig,
        mesh,
        outline: line,
        uniforms,
        driver: createPoseDriver(def, swing),
        scale: fxToFloat(def.height) * d.normalize,
        headRadius: d.headRadius,
        glows: style?.emissive !== undefined,
        theme: style?.vfx,
        clock: 0,
        lastTime: 0,
        lastAction: -1,
        hair: createChain(),
        cloth: createChain(),
        skirt: createChain(),
        striker: -1,
        tips: new Float64Array(STRIKERS.length * 3),
        pale: false,
        hand: 0.45,
      });
    }

    const scale = new Matrix4();
    const yaw = new Matrix4();
    const spin = new Matrix4();
    const face = createExpression();
    const squash: Squash = { y: 1 };

    // Traînées des coups : à la couleur du thème du personnage, sinon à celle du joueur.
    const trails = createTrails(players);
    root.add(trails.mesh);
    for (let i = 0; i < players; i++) {
      const themed = TRAIL_COLORS[bodies[i]!.theme ?? ''];
      if (themed !== undefined) trails.color(i, themed[0], themed[1], themed[2]);
      else {
        const c = new Color(PLAYER_COLORS[i % PLAYER_COLORS.length]!).multiplyScalar(2.4);
        trails.color(i, c.r, c.g, c.b);
      }
    }
    const tip = new Vector3();

    return {
      root,

      capture(player, view) {
        const body = bodies[player]!;
        body.driver.capture(view);
        body.clock++;
      },

      update(player, x, y, view, alpha) {
        const body = bodies[player]!;
        const anchor = body.anchor;
        anchor.visible = view.action !== A_DEAD;
        if (!anchor.visible) {
          faces.hide(player);
          seenX[player] = Number.NaN;
          resetChain(body.hair);
          resetChain(body.cloth);
          resetChain(body.skirt);
          // Les traînées des autres joueurs continuent de s'effacer.
          if (player === players - 1) trails.update(body.clock + alpha);
          return;
        }
        anchor.position.set(x, y, 0);
        anchor.rotation.y = view.facing === 1 ? -FACE_CAMERA : Math.PI + FACE_CAMERA;

        const pose = body.driver.update(view, alpha);
        // Repère du corps : z vers la caméra quand il regarde à droite, à l'opposé sinon.
        body.rig.apply(pose, view.facing === 1 ? -HEAD_TURN : HEAD_TURN);
        body.hand += (handCurl(view.action) - body.hand) * HAND_RATE;
        body.rig.setHands(body.hand, body.hand);

        // Mouvements secondaires : les ressorts avancent du temps de simulation écoulé depuis la
        // dernière image ; un saut dans le temps (rollback, réapparition) les remet au repos.
        const time = body.clock + alpha;
        // Au repos, la figurine respire : le buste se soulève, la tête suit, les épaules aussi.
        if (view.action === A_IDLE || view.action === A_CROUCH || view.action === A_SHIELD) {
          const breath = Math.sin((time + player * 37) * BREATH_RATE);
          body.rig.bone('spine').rotation.z += breath * 0.025;
          body.rig.bone('neck').rotation.z -= breath * 0.018;
          body.rig.bone('upperArmF').rotation.z += breath * 0.03;
          body.rig.bone('upperArmB').rotation.z += breath * 0.03;
          body.rig.bone('hips').position.y += breath * 0.0025;
        }
        const dt = time - body.lastTime;
        body.lastTime = time;
        if (dt < 0 || dt > MAX_SPRING_STEP || isTeleport(body.lastAction, view.action)) {
          resetChain(body.hair);
          resetChain(body.cloth);
          resetChain(body.skirt);
        } else if (dt > 0) {
          const vx = view.velX * view.facing;
          const vy = view.velY;
          stepChain(body.hair, dt, pose.spin + pose.torso + pose.head, vx, vy);
          stepChain(body.cloth, dt, pose.spin + pose.torso, vx, vy);
          stepChain(body.skirt, dt, pose.spin, vx, vy);
        }
        body.lastAction = view.action;
        const rig = body.rig;
        rig.bone('tail1').rotation.z = body.hair.angle[0]!;
        rig.bone('tail2').rotation.z = body.hair.angle[1]!;
        rig.bone('cloth1').rotation.z = body.cloth.angle[0]!;
        rig.bone('cloth2').rotation.z = body.cloth.angle[1]!;
        rig.bone('skirt').rotation.z = body.skirt.angle[0]! * SKIRT_SWAY;

        // Repère du corps : échelle (écrasement et étirement depuis les pieds), décalages et
        // rotation verticale, rotation autour du centre (comme le mannequin).
        const timing = body.driver.input;
        squashOf(view.action, timing.frame, timing.total, view.velY, view.hitlag, squash);
        const h = body.scale;
        // Entrée en scène : la figurine surgit en début de match (avec un léger rebond).
        const appear = entrance(time);
        const sy = h * squash.y * appear;
        const sxz = (h / Math.sqrt(squash.y)) * appear;
        const sinSpin = Math.sin(pose.spin);
        const cosSpin = Math.cos(pose.spin);
        body.pose.matrix
          .copy(scale.makeScale(sxz, sy, sxz))
          .multiply(
            yaw.makeRotationY(pose.yaw).setPosition(pose.offsetX, pose.offsetY, pose.offsetZ),
          )
          .multiply(
            spin
              .makeRotationZ(-pose.spin)
              .setPosition(-SPIN_PIVOT_Y * sinSpin, SPIN_PIVOT_Y * (1 - cosSpin), 0),
          );
        anchor.updateMatrixWorld(true);

        // Traînée : le bout le plus rapide au début des frames actives est suivi jusqu'au bout.
        const active = striking(view.action, timing.frame, timing.start, timing.end);
        let fastest = -1;
        let best = 0;
        for (let k = 0; k < STRIKERS.length; k++) {
          const [bone, tx, ty, tz] = STRIKERS[k]!;
          tip.set(tx, ty, tz).applyMatrix4(rig.bone(bone).matrixWorld);
          const o = k * 3;
          const moved = Math.hypot(tip.x - body.tips[o]!, tip.y - body.tips[o + 1]!);
          if (moved > best) {
            best = moved;
            fastest = k;
          }
          body.tips[o] = tip.x;
          body.tips[o + 1] = tip.y;
          body.tips[o + 2] = tip.z;
        }
        if (!active) body.striker = -1;
        else {
          if (body.striker < 0) body.striker = fastest;
          const o = body.striker * 3;
          if (o >= 0)
            trails.push(player, time, body.tips[o]!, body.tips[o + 1]!, body.tips[o + 2]!);
        }
        if (player === players - 1) trails.update(time);

        if (view.intangible !== body.pale) {
          body.pale = view.intangible;
          body.uniforms.uPale.value = body.pale ? PALE_MIX : 0;
        }
        // Éclat blanc de la victime pendant le gel d'un coup, en clignotant.
        body.uniforms.uFlash.value =
          view.action === A_HITSTUN && view.hitlag > 0 ? (view.hitlag % 4 < 2 ? 0.9 : 0.35) : 0;
        if (time < ENTRANCE_FRAMES) {
          body.uniforms.uFlash.value = Math.max(
            body.uniforms.uFlash.value,
            1 - time / ENTRANCE_FRAMES,
          );
        }
        // La zone incandescente s'embrase pendant la charge d'un smash.
        if (body.glows) {
          const heat = Math.min(1, view.charge / CHARGE_FULL);
          body.uniforms.uGlow.value = GLOW_IDLE + (GLOW_CHARGED - GLOW_IDLE) * heat;
        }

        // Visage : expression, et regard tourné vers l'adversaire le plus proche.
        expressionOf(view.action, view.hitlag, view.charge, body.clock, player, face);
        seenX[player] = x;
        seenY[player] = y;
        const gaze = gazeOf(player, x, y, view.facing, seenX, seenY);
        faceLayout(face, gaze.y, gaze.z, features);
        faces.place(player, body.rig.bone('head').matrixWorld, body.headRadius, features);
      },

      theme(player: number) {
        return bodies[player]?.theme;
      },

      setQuality(preset: QualityPreset) {
        const lines = preset.quality === 'high' || preset.quality === 'ultra';
        for (const body of bodies) body.outline.visible = lines;
      },

      dispose() {
        for (const g of geometries.values()) g.dispose();
        for (const body of bodies) {
          (body.mesh.material as MeshStandardMaterial).dispose();
          body.rig.skeleton.dispose();
        }
        outline.dispose();
        faces.dispose();
        trails.dispose();
      },
    } satisfies FighterVisuals;
  };
}
