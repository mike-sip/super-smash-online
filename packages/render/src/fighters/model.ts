/**
 * Modèles glTF des combattants (docs : `assets/fighters/README.md`) : chargement, mise en cache et
 * préparation une fois par fichier. Les joueurs en reçoivent ensuite chacun une copie
 * (`gltf-fighters.ts`), qui partage géométries, textures et clips avec le modèle d'origine.
 *
 * Le chargement est asynchrone, la création d'un renderer ne l'est pas : le jeu précharge les
 * modèles (`preloadFighterModels`) pendant les menus, et un modèle absent ou pas encore arrivé au
 * moment du match laisse place à la figurine procédurale.
 */
import { AnimationClip, Box3, Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl } from '../assets/loader.ts';

/** Couleur de base remplacée, par nom de matière glTF : `'#rrggbb'` ou `0xrrggbb`. */
export type MaterialVariant = Readonly<Record<string, string | number>>;

/** Modèle prêt à être copié pour chaque joueur. */
export interface FighterModel {
  /** Scène d'origine : jamais ajoutée telle quelle, seulement copiée. */
  readonly scene: Object3D;
  /** Clips par nom (deux exemplaires : `gltf-fighters.ts` en fond deux à la fois). */
  readonly clips: ReadonlyMap<string, readonly [AnimationClip, AnimationClip]>;
  /** Hauteur du modèle dans ses propres unités (pieds à la tête), pour la mise à l'échelle. */
  readonly height: number;
  /** Couleurs alternatives ; la première est celle du fichier (vide). */
  readonly variants: readonly MaterialVariant[];
  /** Distance parcourue par un cycle de marche et de course, en hauteurs de combattant. */
  readonly walkCycle: number;
  readonly runCycle: number;
  /** Clips du contrat absents du fichier (ils retombent sur un clip voisin) : pour les outils. */
  readonly names: readonly string[];
}

/** Valeurs par défaut des cycles de pas, en hauteurs de combattant par cycle. */
export const WALK_CYCLE = 0.9;
export const RUN_CYCLE = 1.8;

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

/**
 * Prépare un modèle à partir de la scène et des clips d'un fichier glTF. Les propriétés
 * personnalisées de la scène (`extras` glTF, « Custom Properties » de Blender) peuvent préciser
 * `height`, `walkCycle`, `runCycle` et `variants` (liste ou texte JSON).
 */
export function createFighterModel(
  scene: Object3D,
  animations: readonly AnimationClip[],
): FighterModel {
  scene.updateMatrixWorld(true);
  const extras = scene.userData as Record<string, unknown>;
  const box = new Box3().setFromObject(scene, true);
  const measured = box.isEmpty() ? 1 : box.getSize(new Vector3()).y;
  const clips = new Map<string, readonly [AnimationClip, AnimationClip]>();
  for (const clip of animations) {
    // Les exports de Blender préfixent parfois le clip du nom de l'armature (« Armature|idle »).
    const name = clip.name.slice(clip.name.lastIndexOf('|') + 1).toLowerCase();
    if (!clips.has(name)) clips.set(name, [clip, clip.clone()]);
  }
  let variants: unknown = extras.variants;
  if (typeof variants === 'string') {
    try {
      variants = JSON.parse(variants);
    } catch {
      variants = undefined;
    }
  }
  return {
    scene,
    clips,
    height: finite(extras.height, measured > 0 ? measured : 1),
    variants: [{}, ...(Array.isArray(variants) ? (variants as MaterialVariant[]) : [])],
    walkCycle: finite(extras.walkCycle, WALK_CYCLE),
    runCycle: finite(extras.runCycle, RUN_CYCLE),
    names: [...clips.keys()],
  };
}

/** Lit un fichier `.glb` (ou `.gltf` autonome) déjà en mémoire. */
export async function parseFighterModel(data: ArrayBuffer | string): Promise<FighterModel> {
  const gltf = await new GLTFLoader().parseAsync(data, '');
  return createFighterModel(gltf.scene, gltf.animations);
}

const ready = new Map<string, FighterModel>();
const pending = new Map<string, Promise<FighterModel | null>>();

/**
 * Modèle `path` (relatif à l'adresse des assets, par exemple `fighters/sorel/model.glb`). Le
 * téléchargement part à la première demande ; un fichier absent ou illisible donne `null`, et le
 * combattant garde sa figurine.
 */
export function loadFighterModel(path: string): Promise<FighterModel | null> {
  const known = ready.get(path);
  if (known !== undefined) return Promise.resolve(known);
  const running = pending.get(path);
  if (running !== undefined) return running;
  const url = assetUrl(path);
  const promise =
    url === null
      ? Promise.resolve(null)
      : new GLTFLoader()
          .loadAsync(url)
          .then((gltf) => {
            const model = createFighterModel(gltf.scene, gltf.animations);
            ready.set(path, model);
            return model;
          })
          .catch((error: unknown) => {
            console.warn(`Modèle « ${path} » indisponible, figurine utilisée à la place.`, error);
            return null;
          });
  pending.set(path, promise);
  return promise;
}

/** Précharge les modèles donnés (les `undefined` sont ignorés). */
export async function preloadFighterModels(paths: Iterable<string | undefined>): Promise<void> {
  const all: Promise<FighterModel | null>[] = [];
  for (const path of paths) if (path !== undefined) all.push(loadFighterModel(path));
  await Promise.all(all);
}

/** Modèle déjà chargé, sinon `undefined` (et son chargement est lancé pour la suite). */
export function fighterModel(path: string): FighterModel | undefined {
  const model = ready.get(path);
  if (model === undefined) void loadFighterModel(path);
  return model;
}

/** Enregistre un modèle déjà préparé sous `path` (outils, tests, modèle généré à la volée). */
export function registerFighterModel(path: string, model: FighterModel): void {
  ready.set(path, model);
  pending.set(path, Promise.resolve(model));
}
