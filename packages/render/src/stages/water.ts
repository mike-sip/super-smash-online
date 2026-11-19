/**
 * Eau animée et particules d'ambiance des stages (SPEC-visuals.md, phase 6).
 *
 * L'eau est une matière physique presque lisse : elle reflète le ciel du thème (lumière par image)
 * et le soleil, et ses vagues sont calculées dans le shader (hauteur et normale), à partir de la
 * frame affichée. Les particules d'ambiance (poussière dorée, lucioles, plancton, braises) bouclent
 * sans fin dans une boîte, toutes en un appel de dessin.
 */
import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  type WebGLProgramParametersWithUniforms,
} from 'three';

export interface WaterLook {
  /** Hauteur de la surface, centre et taille du plan. */
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly color: number;
  /** Amplitude des vagues, en unités de jeu. */
  readonly waves: number;
}

export interface Animated {
  readonly mesh: Mesh;
  update(frame: number): void;
}

export function createWater(look: WaterLook): Animated {
  const geometry = new PlaneGeometry(look.width, look.depth, 96, 48).rotateX(-Math.PI / 2);
  geometry.translate(0, look.y, look.z);
  const time = { value: 0 };
  const amplitude = { value: look.waves };
  const material = new MeshStandardMaterial({
    color: look.color,
    roughness: 0.14,
    metalness: 0.1,
    envMapIntensity: 2.2,
  });
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uWaves = amplitude;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform float uTime;',
          'uniform float uWaves;',
          // Trois houles croisées : hauteur et pentes.
          'vec3 waves( vec2 p ) {',
          '  float t = uTime * 0.03;',
          '  vec3 a = vec3( 0.045, 0.02, 1.0 );',
          '  vec3 b = vec3( -0.03, 0.05, 1.7 );',
          '  vec3 c = vec3( 0.08, -0.06, 2.3 );',
          '  float h = 0.0; float dx = 0.0; float dz = 0.0;',
          '  float pa = dot( p, a.xy ) + t * a.z; h += sin( pa ); dx += cos( pa ) * a.x; dz += cos( pa ) * a.y;',
          '  float pb = dot( p, b.xy ) + t * b.z; h += 0.6 * sin( pb ); dx += 0.6 * cos( pb ) * b.x; dz += 0.6 * cos( pb ) * b.y;',
          '  float pc = dot( p, c.xy ) + t * c.z; h += 0.3 * sin( pc ); dx += 0.3 * cos( pc ) * c.x; dz += 0.3 * cos( pc ) * c.y;',
          '  return vec3( h, dx, dz ) * uWaves;',
          '}',
        ].join('\n'),
      )
      .replace(
        '#include <beginnormal_vertex>',
        'vec3 wave = waves( position.xz );\nvec3 objectNormal = normalize( vec3( -wave.y, 1.0, -wave.z ) );',
      )
      .replace(
        '#include <begin_vertex>',
        'vec3 transformed = position + vec3( 0.0, wave.x, 0.0 );',
      );
  };
  material.customProgramCacheKey = () => 'water';
  const mesh = new Mesh(geometry, material);
  mesh.name = 'water';
  mesh.receiveShadow = true;
  return {
    mesh,
    update(frame) {
      time.value = frame;
    },
  };
}

export interface MotesLook {
  readonly count: number;
  /** Boîte où elles vivent : centre et demi-dimensions. */
  readonly center: readonly [number, number, number];
  readonly half: readonly [number, number, number];
  /** Couleur en lumière (au-delà de 1 : elles rayonnent). */
  readonly color: number;
  readonly intensity: number;
  readonly size: number;
  /** Vitesse de dérive (unités par frame) : x, y. */
  readonly drift: readonly [number, number];
  readonly seed: number;
}

const MOTES_VERTEX = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uHalf;
uniform vec2 uDrift;
uniform float uSize;
attribute vec4 aSeed;
varying vec2 vUv;
varying float vTwinkle;
void main() {
  // Position qui boucle dans la boîte, avec une ondulation propre à chaque particule.
  vec3 p = aSeed.xyz * 2.0 - 1.0;
  p.xy += uDrift * uTime / uHalf.xy;
  p.x += 0.08 * sin( uTime * 0.02 + aSeed.w * 40.0 );
  p.y += 0.06 * sin( uTime * 0.017 + aSeed.w * 25.0 );
  p = mod( p + 1.0, 2.0 ) - 1.0;
  vec3 world = uCenter + p * uHalf;
  vec4 mv = modelViewMatrix * vec4( world, 1.0 );
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy;
  vTwinkle = 0.55 + 0.45 * sin( uTime * 0.06 + aSeed.w * 90.0 );
}`;

const MOTES_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vTwinkle;
void main() {
  float r = length( vUv );
  float a = pow( max( 1.0 - r, 0.0 ), 2.0 ) * vTwinkle;
  if ( a <= 0.002 ) discard;
  gl_FragColor = vec4( uColor * a, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Hasard reproductible pour placer les particules. */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createMotes(look: MotesLook): Animated {
  const quad = new PlaneGeometry(2, 2);
  const geometry = new InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  const random = seeded(look.seed);
  const seeds = new Float32Array(look.count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = random();
  geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = look.count;
  const time = { value: 0 };
  const material = new ShaderMaterial({
    uniforms: {
      uTime: time,
      uCenter: { value: look.center },
      uHalf: { value: look.half },
      uDrift: { value: look.drift },
      uSize: { value: look.size },
      uColor: { value: new Color(look.color).multiplyScalar(look.intensity) },
    },
    vertexShader: MOTES_VERTEX,
    fragmentShader: MOTES_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'motes';
  mesh.frustumCulled = false;
  return {
    mesh,
    update(frame) {
      time.value = frame;
    },
  };
}
