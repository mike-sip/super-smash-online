/**
 * Grain des matières du décor (SPEC-visuals.md, phase 6), sans aucune image : un bruit calculé
 * d'après la position dans le monde fait varier la teinte (taches, veines) et la normale (relief)
 * de la pierre, du bois et de la roche. Le motif reste fixe quand la caméra bouge.
 */
import type { Material, WebGLProgramParametersWithUniforms } from 'three';

export interface SurfaceLook {
  /** Taille du motif : plus grand = motif plus fin. */
  readonly scale: number;
  /** Variation de teinte (0 à 1) et force du relief. */
  readonly tint: number;
  readonly relief: number;
}

export const DEFAULT_SURFACE: SurfaceLook = { scale: 0.18, tint: 0.13, relief: 0.35 };

const NOISE = /* glsl */ `
varying vec3 vSurfacePos;
uniform vec3 uSurface;
float sHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float sNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( sHash( i ), sHash( i + vec3( 1, 0, 0 ) ), f.x ),
                   mix( sHash( i + vec3( 0, 1, 0 ) ), sHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( sHash( i + vec3( 0, 0, 1 ) ), sHash( i + vec3( 1, 0, 1 ) ), f.x ),
                   mix( sHash( i + vec3( 0, 1, 1 ) ), sHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
float sFbm( vec3 p ) {
  return 0.55 * sNoise( p ) + 0.3 * sNoise( p * 2.1 + 3.1 ) + 0.15 * sNoise( p * 4.3 + 7.7 );
}`;

/** Ajoute le grain à une matière physique. */
export function addSurfaceDetail(material: Material, look: SurfaceLook = DEFAULT_SURFACE): void {
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    previous(shader, renderer);
    shader.uniforms.uSurface = { value: [look.scale, look.tint, look.relief] };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSurfacePos;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvSurfacePos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}`)
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'float sGrain = sFbm( vSurfacePos * uSurface.x );',
          // Au loin, le motif devient plus fin qu'un pixel : il s'efface au lieu de scintiller.
          'float sFade = 1.0 - smoothstep( 110.0, 300.0, length( vViewPosition ) );',
          'diffuseColor.rgb *= 1.0 + uSurface.y * sFade * ( sGrain - 0.5 ) * 2.0;',
        ].join('\n'),
      )
      .replace(
        '#include <normal_fragment_maps>',
        [
          '#include <normal_fragment_maps>',
          // Relief : la normale penche selon la pente du motif à l'écran.
          'vec2 sSlope = vec2( dFdx( sGrain ), dFdy( sGrain ) ) * uSurface.z * 8.0 * sFade;',
          'normal = normalize( normal + vec3( -sSlope, 0.0 ) );',
        ].join('\n'),
      );
  };
  const previousKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${previousKey()}|surface`;
  material.needsUpdate = true;
}
