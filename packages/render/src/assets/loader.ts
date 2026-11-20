/**
 * Assets libres du dépôt (SPEC-finition.md) : textures de matières et images d'éclairage (HDRI),
 * chargées à la demande et gardées en mémoire.
 *
 * Une matière est utilisable tout de suite : ses trois textures commencent par une image d'un
 * pixel (blanc, relief plat, rugosité moyenne), remplacée par la vraie image quand elle arrive.
 * Aucune recompilation de shader, aucun écran noir ; tant que `configureAssets` n'a pas donné
 * d'adresse (tests, outils), rien n'est téléchargé et les images d'un pixel restent.
 */
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  NoColorSpace,
  Texture,
  type DataTexture as HdrTexture,
} from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

/** Les trois cartes d'une matière, nommées comme dans `assets/textures/<matière>/`. */
export interface MaterialMaps {
  /** Couleur (sRGB). */
  readonly color: { value: Texture };
  /** Relief, convention OpenGL. */
  readonly normal: { value: Texture };
  /** Occlusion, rugosité et métal dans R, G et B. */
  readonly arm: { value: Texture };
  /** Vrai quand les trois images réelles sont en place. */
  readonly ready: () => boolean;
}

let base: string | null = null;
let anisotropy = 1;
const materials = new Map<string, MaterialMaps & { textures: Texture[] }>();
const hdris = new Map<string, Promise<HdrTexture | null>>();

/**
 * Adresse des assets (`'/'` dans le jeu et la démo, servis par Vite depuis `assets/`), ou `null`
 * pour ne rien télécharger.
 */
export function configureAssets(url: string | null): void {
  base = url === null ? null : url.endsWith('/') ? url : `${url}/`;
}

export function assetsEnabled(): boolean {
  return base !== null;
}

function pixel(r: number, g: number, b: number, color: boolean): DataTexture {
  const t = new DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
  t.colorSpace = color ? SRGBColorSpace : NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

const WHITE = pixel(255, 255, 255, true);
const FLAT = pixel(128, 128, 255, false);
/** Occlusion nulle, rugosité 0,85, aucun métal. */
const MATTE = pixel(255, 217, 0, false);

function prepare(t: Texture, color: boolean): void {
  t.colorSpace = color ? SRGBColorSpace : NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
}

function loadImage(url: string, onLoad: (image: HTMLImageElement) => void): void {
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => onLoad(image);
  // Un fichier manquant laisse simplement l'image d'un pixel : le décor reste dessiné.
  image.onerror = () => undefined;
  image.src = url;
}

/** Cartes de la matière `name` ; le téléchargement part à la première demande. */
export function materialMaps(name: string): MaterialMaps {
  const known = materials.get(name);
  if (known !== undefined) return known;
  let loaded = 0;
  const textures: Texture[] = [];
  const entry = {
    color: { value: WHITE as Texture },
    normal: { value: FLAT as Texture },
    arm: { value: MATTE as Texture },
    ready: () => loaded === 3,
    textures,
  };
  materials.set(name, entry);
  if (base !== null && typeof Image !== 'undefined') {
    const slots: ['color' | 'normal' | 'arm', boolean][] = [
      ['color', true],
      ['normal', false],
      ['arm', false],
    ];
    for (const [slot, color] of slots) {
      loadImage(`${base}textures/${name}/${slot}.jpg`, (image) => {
        const t = new Texture(image);
        prepare(t, color);
        t.needsUpdate = true;
        textures.push(t);
        entry[slot].value = t;
        loaded++;
      });
    }
  }
  return entry;
}

/** Filtrage anisotrope de toutes les textures de matières (préréglage de qualité). */
export function setAnisotropy(value: number): void {
  if (value === anisotropy) return;
  anisotropy = value;
  for (const m of materials.values()) {
    for (const t of m.textures) {
      t.anisotropy = value;
      t.needsUpdate = true;
    }
  }
}

/**
 * Libère la mémoire graphique des matières absentes de `keep` (les images restent en mémoire :
 * pas de nouveau téléchargement si le stage revient).
 */
export function releaseMaterials(keep: ReadonlySet<string>): void {
  for (const [name, m] of materials) {
    if (!keep.has(name)) for (const t of m.textures) t.dispose();
  }
}

/** Image d'éclairage `name` (`assets/hdri/<name>.hdr`), ou `null` si indisponible. */
export function loadHdri(name: string): Promise<HdrTexture | null> {
  const known = hdris.get(name);
  if (known !== undefined) return known;
  const promise =
    base === null
      ? Promise.resolve(null)
      : new HDRLoader()
          .loadAsync(`${base}hdri/${name}.hdr`)
          .then((t) => t as HdrTexture)
          .catch(() => null);
  hdris.set(name, promise);
  return promise;
}
