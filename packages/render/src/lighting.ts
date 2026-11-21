/**
 * Lumières de la scène (SPEC-visuals.md, phase 1) : ciel, soleil qui porte les ombres, contre-jour,
 * et lumière de contour ajoutée aux matières des combattants et des objets.
 *
 * La carte d'ombre ne couvre que ce que montre la caméra : elle suit le cadrage, alignée sur ses
 * texels pour que les ombres ne scintillent pas quand la caméra glisse.
 */
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Object3D,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { Framing } from './camera.ts';
import type { QualityPreset } from './quality.ts';

/** Direction d'où vient le soleil (vers la lumière), déjà normalisée à l'usage. */
const SUN_DIR = { x: 0.32, y: 0.85, z: 0.42 };
/** Distance du soleil à la cible : assez loin pour englober le décor proche. */
const SUN_DISTANCE = 400;
/** Profondeur couverte par la carte d'ombre, de part et d'autre du plan de jeu. */
const SHADOW_DEPTH = 800;
/** Marge autour du champ de la caméra, en part de sa demi-largeur. */
const SHADOW_MARGIN = 1.15;
/** Demi-côté minimal et maximal couvert par la carte d'ombre, en unités de jeu. */
const SHADOW_MIN_HALF = 60;
const SHADOW_MAX_HALF = 420;
/** Part de la lumière du ciel du thème gardée en lumière hémisphérique. */
const AMBIENT_SHARE = 0.8;

export interface ShadowFit {
  centerX: number;
  centerY: number;
  half: number;
}

/**
 * Zone couverte par la carte d'ombre pour un cadrage donné : centrée sur la caméra, assez large
 * pour tout le champ visible, centre aligné sur la grille des texels. Logique pure.
 */
export function fitShadow(
  framing: Framing,
  tanHalfFov: number,
  aspect: number,
  mapSize: number,
  out: ShadowFit,
): void {
  const halfHeight = framing.distance * tanHalfFov;
  const halfWidth = halfHeight * aspect;
  const half = Math.min(
    SHADOW_MAX_HALF,
    Math.max(SHADOW_MIN_HALF, Math.max(halfWidth, halfHeight) * SHADOW_MARGIN),
  );
  // Demi-côté arrondi par paliers : pendant un zoom, la taille des texels change par à-coups
  // rares plutôt qu'à chaque image.
  out.half = Math.ceil(half / 20) * 20;
  const texel = (2 * out.half) / Math.max(1, mapSize);
  out.centerX = Math.round(framing.centerX / texel) * texel;
  out.centerY = Math.round(framing.centerY / texel) * texel;
}

/** Couleurs de lumière dont dépend l'éclairage, tirées du thème du stage. */
export interface LightingTheme {
  readonly sky: number;
  readonly ground: number;
  readonly ambient: number;
  readonly sun: number;
  readonly sunIntensity: number;
  readonly rim?: number;
}

export interface Lighting {
  readonly root: Object3D;
  readonly sun: DirectionalLight;
  /** Uniformes partagés par toutes les matières qui portent la lumière de contour. */
  readonly rim: { readonly color: { value: Color }; readonly strength: { value: number } };
  /** Applique les ombres d'un préréglage. */
  configure(preset: QualityPreset): void;
  /** Multiplie toutes les lumières par `factor` (1 = normal), pour assombrir la scène. */
  setDim(factor: number): void;
  /** Recale la carte d'ombre sur le cadrage affiché. */
  follow(framing: Framing, tanHalfFov: number, aspect: number): void;
  /** Ajoute la lumière de contour à une matière physique (MeshStandardMaterial). */
  addRim(material: Material): void;
  dispose(): void;
}

/** Couleur de contour par défaut : celle du soleil, éclaircie. */
function defaultRim(theme: LightingTheme): number {
  return new Color(theme.sun).lerp(new Color(0xffffff), 0.5).getHex();
}

export function createLighting(theme: LightingTheme): Lighting {
  const root = new Object3D();
  root.name = 'lighting';
  // Une part de l'ambiance passe par la lumière par image (renderer.ts) : le ciel en garde le reste.
  const hemi = new HemisphereLight(theme.sky, theme.ground, theme.ambient * AMBIENT_SHARE);
  root.add(hemi);

  const sun = new DirectionalLight(theme.sun, theme.sunIntensity);
  sun.name = 'sun';
  sun.position.set(40, 120, 90);
  root.add(sun, sun.target);
  const shadowCamera = sun.shadow.camera;
  shadowCamera.near = 1;
  shadowCamera.far = SUN_DISTANCE + SHADOW_DEPTH;
  // Biais en unités de jeu (un combattant mesure 12) : pas d'acné sur les faces, pas de
  // décollement visible sous les pieds.
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.25;

  // Contre-jour discret : il éclaire les faces tournées vers le fond, ce qui sépare le décor des
  // plans successifs ; la lumière de contour des combattants passe par leurs matières.
  const back = new DirectionalLight(theme.rim ?? defaultRim(theme), theme.sunIntensity * 0.35);
  back.position.set(-60, 80, -120);
  root.add(back);

  const rim = {
    color: { value: new Color(theme.rim ?? defaultRim(theme)) },
    strength: { value: 0.55 },
  };
  const fit: ShadowFit = { centerX: 0, centerY: 0, half: SHADOW_MIN_HALF };
  let mapSize = 0;
  // Une matière partagée par plusieurs objets ne reçoit la lumière de contour qu'une fois.
  const rimmed = new WeakSet<Material>();

  return {
    root,
    sun,
    rim,
    configure(preset) {
      const size = preset.shadowMapSize;
      sun.castShadow = size > 0;
      if (size > 0 && size !== mapSize) {
        sun.shadow.mapSize.set(size, size);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
      sun.shadow.radius = preset.softShadows ? 3 : 1;
      mapSize = size;
    },
    setDim(factor) {
      hemi.intensity = theme.ambient * AMBIENT_SHARE * factor;
      sun.intensity = theme.sunIntensity * factor;
      back.intensity = theme.sunIntensity * 0.35 * factor;
    },
    follow(framing, tanHalfFov, aspect) {
      if (mapSize === 0) return;
      fitShadow(framing, tanHalfFov, aspect, mapSize, fit);
      sun.target.position.set(fit.centerX, fit.centerY, 0);
      sun.position.set(
        fit.centerX + SUN_DIR.x * SUN_DISTANCE,
        fit.centerY + SUN_DIR.y * SUN_DISTANCE,
        SUN_DIR.z * SUN_DISTANCE,
      );
      if (shadowCamera.right !== fit.half) {
        shadowCamera.left = -fit.half;
        shadowCamera.right = fit.half;
        shadowCamera.top = fit.half;
        shadowCamera.bottom = -fit.half;
        shadowCamera.updateProjectionMatrix();
      }
    },
    addRim(material) {
      if (rimmed.has(material)) return;
      rimmed.add(material);
      const previous = material.onBeforeCompile.bind(material);
      material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
        previous(shader, renderer);
        shader.uniforms.rimColor = rim.color;
        shader.uniforms.rimStrength = rim.strength;
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            '#include <common>\nuniform vec3 rimColor;\nuniform float rimStrength;',
          )
          .replace(
            '#include <emissivemap_fragment>',
            [
              '#include <emissivemap_fragment>',
              // Fresnel : fort sur les bords vus de profil, nul face à la caméra ; plus marqué
              // sur le haut des formes, comme une lumière venue d'au-dessus et derrière.
              'float rimFacing = 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) );',
              'float rimUp = 0.55 + 0.45 * saturate( normal.y + 0.3 );',
              'totalEmissiveRadiance += rimColor * rimStrength * rimUp * pow( rimFacing, 3.0 );',
            ].join('\n'),
          );
      };
      // Clé propre : deux matières aux shaders modifiés différemment ne partagent pas un programme.
      const previousKey = material.customProgramCacheKey.bind(material);
      material.customProgramCacheKey = () => `${previousKey()}|rim`;
      material.needsUpdate = true;
    },
    dispose() {
      sun.shadow.map?.dispose();
    },
  };
}
