/**
 * Préréglages de qualité graphique, choix automatique d'après la carte graphique et ajustement
 * au début du match (SPEC-visuals.md). Logique pure, sans Three.js.
 */

export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export type QualitySetting = Quality | 'auto';

/** Du moins cher au plus cher. */
export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high', 'ultra'];

export interface QualityPreset {
  readonly quality: Quality;
  /** Part de la résolution affichée réellement calculée. */
  readonly resolutionScale: number;
  /** Plafond de la densité de pixels de l'écran. */
  readonly maxPixelRatio: number;
  /** Côté de la carte d'ombre en texels ; 0 = ombres rondes sous les combattants. */
  readonly shadowMapSize: number;
  readonly softShadows: boolean;
  /** Rendu dans une image intermédiaire HDR, puis passes de post-traitement. */
  readonly post: boolean;
  readonly bloom: boolean;
  /** Échantillons d'anticrénelage de l'image intermédiaire (0 = aucun). */
  readonly msaa: number;
  /** Étalonnage des couleurs et vignette. */
  readonly grading: boolean;
  /** Particules d'effets visibles en même temps, au plus. */
  readonly particles: number;
  /** Matières du décor texturées (SPEC-finition.md) ; sinon couleurs et grain calculé. */
  readonly textures: boolean;
  /** Filtrage anisotrope des textures du décor (1 = aucun). */
  readonly anisotropy: number;
}

const PRESETS: Record<Quality, QualityPreset> = {
  low: {
    quality: 'low',
    textures: false,
    anisotropy: 1,
    particles: 1000,
    resolutionScale: 0.75,
    maxPixelRatio: 1,
    shadowMapSize: 0,
    softShadows: false,
    post: false,
    bloom: false,
    msaa: 0,
    grading: false,
  },
  medium: {
    quality: 'medium',
    textures: true,
    anisotropy: 4,
    particles: 3000,
    resolutionScale: 1,
    maxPixelRatio: 1.25,
    shadowMapSize: 1024,
    softShadows: false,
    post: true,
    bloom: true,
    msaa: 4,
    grading: false,
  },
  high: {
    quality: 'high',
    textures: true,
    anisotropy: 8,
    particles: 6000,
    resolutionScale: 1,
    maxPixelRatio: 1.5,
    shadowMapSize: 2048,
    softShadows: true,
    post: true,
    bloom: true,
    msaa: 4,
    grading: true,
  },
  ultra: {
    quality: 'ultra',
    textures: true,
    anisotropy: 16,
    particles: 10000,
    resolutionScale: 1,
    maxPixelRatio: 2,
    shadowMapSize: 2048,
    softShadows: true,
    post: true,
    bloom: true,
    msaa: 4,
    grading: true,
  },
};

export function presetOf(quality: Quality): QualityPreset {
  return PRESETS[quality];
}

/** Densité de pixels à donner au renderer pour un écran de densité `devicePixelRatio`. */
export function pixelRatioFor(preset: QualityPreset, devicePixelRatio: number): number {
  return Math.min(devicePixelRatio, preset.maxPixelRatio) * preset.resolutionScale;
}

export function lowerQuality(quality: Quality): Quality {
  return QUALITIES[Math.max(0, QUALITIES.indexOf(quality) - 1)]!;
}

/**
 * Niveau de départ d'après le nom de la carte graphique annoncé par WebGL. Une estimation
 * prudente : l'ajustement automatique corrige ensuite d'après les images réellement produites.
 * Nom inconnu ou masqué par le navigateur : `high`, que l'ajustement baissera si besoin.
 */
export function guessQuality(gpu: string): Quality {
  const g = gpu.toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render|mali|adreno|powervr/.test(g)) return 'low';
  if (/\b(hd|uhd) graphics/.test(g)) return 'low';
  if (/rtx|radeon rx [67]\d{3}|rx [67]\d{3}|radeon pro w/.test(g)) return 'ultra';
  if (/iris|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|apple m\d/.test(g)) {
    return 'medium';
  }
  return 'high';
}

/** Images ignorées au démarrage : compilation des shaders, chargement. */
const WARMUP = 30;
/** Taille d'une fenêtre d'évaluation, en images. */
const WINDOW = 90;
/** Fenêtres évaluées en tout ; au-delà, le niveau est figé pour le reste du match. */
const WINDOWS = 3;
/** Un intervalle au-delà de ce seuil est une image manquée à 60 Hz (avec marge). */
const LATE_MS = 20;
/** Part d'images en retard d'une fenêtre qui fait baisser d'un cran. */
const LATE_SHARE = 0.25;

export interface AutoTuner {
  /** Niveau courant. */
  readonly quality: Quality;
  /** Vrai une fois la période d'évaluation finie. */
  readonly done: boolean;
  /** Intervalle entre deux images affichées, en ms. Renvoie le nouveau niveau s'il change. */
  sample(intervalMs: number): Quality | null;
}

/**
 * Évalue les premières secondes d'un match (environ 5 s à 60 Hz) et baisse d'un cran chaque
 * fenêtre où trop d'images sont en retard. Ensuite il se fige : le niveau ne change jamais en
 * plein échange.
 */
export function createAutoTuner(start: Quality): AutoTuner {
  let quality = start;
  let seen = 0;
  let inWindow = 0;
  let late = 0;
  let windows = 0;
  const tuner: AutoTuner = {
    get quality() {
      return quality;
    },
    get done() {
      return windows >= WINDOWS;
    },
    sample(intervalMs) {
      if (windows >= WINDOWS) return null;
      seen++;
      if (seen <= WARMUP) return null;
      inWindow++;
      if (intervalMs > LATE_MS) late++;
      if (inWindow < WINDOW) return null;
      const tooSlow = late / inWindow > LATE_SHARE;
      inWindow = 0;
      late = 0;
      windows++;
      if (!tooSlow || quality === 'low') return null;
      quality = lowerQuality(quality);
      return quality;
    },
  };
  return tuner;
}
