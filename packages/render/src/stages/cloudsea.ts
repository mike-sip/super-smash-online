/**
 * Mer de nuages (SPEC-finition.md, phase 1) : plusieurs nappes horizontales superposées, dessinées
 * par shader (bruit fractal qui dérive), éclairées côté soleil et assombries dans les creux. Les
 * nappes, à des hauteurs différentes, donnent du volume quand la caméra bouge. Animées par la frame
 * affichée, comme le reste du décor.
 */
import {
  BufferAttribute,
  Color,
  DoubleSide,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Animated } from './water.ts';

export interface CloudSeaLook {
  /** Hauteur de la nappe la plus haute, écart entre nappes, nombre de nappes. */
  readonly y: number;
  readonly spacing: number;
  readonly layers: number;
  /** Centre en profondeur et taille. */
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  /** Couleur éclairée, couleur des creux. */
  readonly light: number;
  readonly shadow: number;
  /** Couverture, de 0 (rare) à 1 (pleine). */
  readonly cover: number;
  /** Direction du soleil dans le plan (x, z), pour l'éclairage des bosses. */
  readonly sun: readonly [number, number];
}

export function createCloudSea(look: CloudSeaLook): Animated {
  const geometry = new PlaneGeometry(look.width, look.depth, 1, 1).rotateX(-Math.PI / 2);
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: true,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uTime: { value: 0 },
        uLight: { value: new Color(look.light) },
        uShadow: { value: new Color(look.shadow) },
        uCover: { value: look.cover },
        uSun: { value: [look.sun[0], look.sun[1]] },
      },
    ]),
    vertexShader: /* glsl */ `
      attribute float layer;
      varying vec3 vWorld;
      varying float vLayer;
      #include <fog_pars_vertex>
      void main() {
        vec4 world = modelMatrix * vec4( position, 1.0 );
        vWorld = world.xyz;
        vLayer = layer;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uLight;
      uniform vec3 uShadow;
      uniform float uCover;
      uniform vec2 uSun;
      varying vec3 vWorld;
      varying float vLayer;
      #include <fog_pars_fragment>
      float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
      float noise( vec2 p ) {
        vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( hash( i ), hash( i + vec2( 1, 0 ) ), f.x ),
                    mix( hash( i + vec2( 0, 1 ) ), hash( i + vec2( 1, 1 ) ), f.x ), f.y );
      }
      float fbm( vec2 p ) {
        float v = 0.0; float a = 0.5;
        for ( int i = 0; i < 5; i++ ) { v += a * noise( p ); p = p * 2.03 + 17.0; a *= 0.5; }
        return v;
      }
      void main() {
        vec2 p = vWorld.xz * ( 0.006 + vLayer * 0.0015 ) + vec2( uTime * 0.00035, uTime * 0.00012 ) + vLayer * 3.7;
        float d = fbm( p );
        // Pente du motif côté soleil : bosses éclairées, creux à l'ombre.
        float lit = clamp( 0.45 + ( d - fbm( p - uSun * 0.05 ) ) * 9.0 + ( d - 0.5 ) * 1.2, 0.0, 1.0 );
        float alpha = smoothstep( 1.0 - uCover, 1.0 - uCover + 0.22, d );
        // Les nappes basses, plus loin sous la brume, sont plus sombres.
        vec3 color = mix( uShadow, uLight, lit * ( 1.0 - vLayer * 0.25 ) );
        // Bords du plan : fondu, pour ne jamais voir où la nappe s'arrête.
        vec2 edge = abs( vWorld.xz - vec2( 0.0, ${look.z.toFixed(1)} ) ) / vec2( ${(look.width / 2).toFixed(1)}, ${(look.depth / 2).toFixed(1)} );
        alpha *= 1.0 - smoothstep( 0.7, 1.0, max( edge.x, edge.y ) );
        gl_FragColor = vec4( color, alpha * 0.92 );
        #include <fog_fragment>
      }`,
  });
  // Une géométrie par nappe, fusionnées : un seul appel de dessin.
  const parts: PlaneGeometry[] = [];
  for (let l = 0; l < look.layers; l++) {
    const layer = geometry.clone();
    layer.translate(0, look.y - l * look.spacing, look.z);
    const count = layer.getAttribute('position').count;
    layer.setAttribute('layer', new BufferAttribute(new Float32Array(count).fill(l), 1));
    parts.push(layer);
  }
  geometry.dispose();
  const merged = mergeLayers(parts);
  const mesh = new Mesh(merged, material);
  mesh.name = 'cloud-sea';
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return {
    mesh,
    update(frame) {
      material.uniforms.uTime!.value = frame;
    },
  };
}

function mergeLayers(parts: PlaneGeometry[]): BufferGeometry {
  // Les nappes basses d'abord : dessinées de bas en haut, les plus hautes recouvrent.
  const merged = mergeGeometries(parts.reverse(), false);
  for (const p of parts) p.dispose();
  if (merged === null) throw new Error('Fusion des nappes impossible.');
  return merged;
}
