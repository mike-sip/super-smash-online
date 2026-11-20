/**
 * Matières texturées du décor (SPEC-finition.md, phase 1) : projection triplanaire, sans
 * coordonnées de texture à dessiner. Chaque point prend la texture vue de face selon les trois
 * axes du monde, mélangées d'après l'orientation de la surface : ni couture ni étirement sur les
 * formes générées.
 *
 * Couleur, relief (mélange « UDN »), rugosité et occlusion viennent des cartes CC0 de la matière ;
 * la couleur des sommets ne garde que ses nuances, autour de la teinte de base de la matière. Un
 * bruit à grande échelle casse la répétition visible des carreaux.
 */
import { Color, MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from 'three';
import { materialMaps } from '../assets/loader.ts';

export interface SurfaceMaterialLook {
  /** Matière dans `assets/textures/`. */
  readonly texture: string;
  /** Taille d'un carreau de texture, en unités de jeu. */
  readonly tile: number;
  /** Teinte appliquée à la couleur de la texture (blanc = telle quelle). */
  readonly tint?: number;
  /** Couleur des sommets de cette surface, pour n'en garder que les nuances. */
  readonly base: number;
  /** Force du relief (1 = tel quel). */
  readonly relief?: number;
  /** Multiplicateur de rugosité ; métal ajouté. */
  readonly roughness?: number;
  readonly metalness?: number;
  /** Part de l'occlusion de la texture (0 à 1). */
  readonly occlusion?: number;
  /** Variation de teinte à grande échelle (0 à 1). */
  readonly variation?: number;
  /**
   * Projection dans le repère de l'objet plutôt que du monde : pour les pièces qui bougent
   * (plateformes mobiles), la texture reste collée au lieu de glisser.
   */
  readonly local?: boolean;
}

const TRIPLANAR = /* glsl */ `
varying vec3 vTriPos;
varying vec3 vTriNormal;
uniform sampler2D uTriColor;
uniform sampler2D uTriNormal;
uniform sampler2D uTriArm;
uniform vec4 uTriParams; // carreau (1 / unités), relief, rugosité, métal
uniform vec4 uTriMix;    // occlusion, variation, -, -
uniform vec3 uTriTint;
uniform vec3 uTriBase;
vec3 triWeights( vec3 n ) {
  vec3 w = pow( abs( n ), vec3( 4.0 ) );
  return w / ( w.x + w.y + w.z );
}
vec4 triSample( sampler2D map, vec3 p, vec3 w ) {
  return texture2D( map, p.zy ) * w.x + texture2D( map, p.xz ) * w.y + texture2D( map, p.xy ) * w.z;
}
float triHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float triNoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( triHash( i ), triHash( i + vec2( 1, 0 ) ), f.x ),
              mix( triHash( i + vec2( 0, 1 ) ), triHash( i + vec2( 1, 1 ) ), f.x ), f.y );
}`;

/** Matière physique texturée en triplanaire, couleurs de sommets comprises. */
export function createTriplanarMaterial(look: SurfaceMaterialLook): MeshStandardMaterial {
  const maps = materialMaps(look.texture);
  const material = new MeshStandardMaterial({ vertexColors: true });
  const uniforms = {
    uTriColor: maps.color,
    uTriNormal: maps.normal,
    uTriArm: maps.arm,
    uTriParams: {
      value: [1 / look.tile, look.relief ?? 1, look.roughness ?? 1, look.metalness ?? 0],
    },
    uTriMix: { value: [look.occlusion ?? 0.8, look.variation ?? 0.15, 0, 0] },
    uTriTint: { value: new Color(look.tint ?? 0xffffff) },
    uTriBase: { value: new Color(look.base) },
  };
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNormal;',
      )
      .replace(
        '#include <worldpos_vertex>',
        [
          '#include <worldpos_vertex>',
          look.local === true
            ? 'vTriPos = transformed;\nvTriNormal = normalize( objectNormal );'
            : 'vTriPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvTriNormal = normalize( mat3( modelMatrix ) * objectNormal );',
        ].join('\n'),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TRIPLANAR}`)
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'vec3 triN = normalize( vTriNormal );',
          'vec3 triW = triWeights( triN );',
          'vec3 triP = vTriPos * uTriParams.x;',
          'vec4 triArm = triSample( uTriArm, triP, triW );',
          'vec3 triCol = triSample( uTriColor, triP, triW ).rgb;',
          // Nuances des sommets autour de la teinte de base, bornées.
          'vec3 triShade = clamp( diffuseColor.rgb / max( uTriBase, vec3( 0.02 ) ), 0.55, 1.45 );',
          'float triVar = triNoise( vTriPos.xy * 0.035 ) * 0.6 + triNoise( vTriPos.xz * 0.09 + 7.0 ) * 0.4;',
          'triCol *= 1.0 + uTriMix.y * ( triVar - 0.5 ) * 2.0;',
          'diffuseColor.rgb = triCol * uTriTint * triShade * mix( 1.0, triArm.r, uTriMix.x );',
        ].join('\n'),
      )
      .replace(
        '#include <roughnessmap_fragment>',
        'float roughnessFactor = clamp( roughness * triArm.g * uTriParams.z, 0.04, 1.0 );',
      )
      .replace(
        '#include <metalnessmap_fragment>',
        'float metalnessFactor = clamp( metalness + triArm.b + uTriParams.w, 0.0, 1.0 );',
      )
      .replace(
        '#include <normal_fragment_maps>',
        [
          '#include <normal_fragment_maps>',
          // Relief triplanaire, mélange « UDN » : chaque projection penche la normale du monde.
          'vec2 triX = ( texture2D( uTriNormal, triP.zy ).xy * 2.0 - 1.0 ) * uTriParams.y;',
          'vec2 triY = ( texture2D( uTriNormal, triP.xz ).xy * 2.0 - 1.0 ) * uTriParams.y;',
          'vec2 triZ = ( texture2D( uTriNormal, triP.xy ).xy * 2.0 - 1.0 ) * uTriParams.y;',
          'vec3 triWorld = normalize(',
          '  vec3( triN.x, triX.y + triN.y, triX.x + triN.z ) * triW.x +',
          '  vec3( triY.x + triN.x, triN.y, triY.y + triN.z ) * triW.y +',
          '  vec3( triZ.x + triN.x, triZ.y + triN.y, triN.z ) * triW.z );',
          'normal = normalize( ( viewMatrix * vec4( triWorld, 0.0 ) ).xyz );',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => (look.local === true ? 'triplanar-local' : 'triplanar');
  return material;
}
