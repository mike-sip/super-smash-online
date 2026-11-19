/**
 * Ciel des stages (SPEC-visuals.md, phase 6) : un dôme dessiné par shader, derrière tout le
 * décor. Dégradé du zénith à l'horizon et au sol, nuages en couche qui dérivent, étoiles, soleil
 * ou lune avec leur halo (au-delà de 1 : ils rayonnent dans le bloom). Animé par la frame de
 * simulation affichée : il se fige en pause.
 */
import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';

export interface SkyLook {
  readonly zenith: number;
  readonly horizon: number;
  /** Sous l'horizon (mer de nuages, brume). */
  readonly below: number;
  /** Astre : direction (vers lui, sera normalisée), couleur, taille angulaire, halo. */
  readonly sunDir: readonly [number, number, number];
  readonly sunColor: number;
  readonly sunSize: number;
  readonly sunGlow: number;
  /** Lune en croissant au lieu d'un disque plein. */
  readonly crescent?: boolean;
  /** Densité d'étoiles, de 0 (aucune) à 1. */
  readonly stars?: number;
  /** Nuages : couleur, couverture (0 à 1), vitesse de dérive. */
  readonly cloudColor?: number;
  readonly clouds?: number;
  readonly cloudSpeed?: number;
}

const RADIUS = 2600;

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize( position );
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = p.xyww;
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 below;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float sunSize;
uniform float sunGlow;
uniform float crescent;
uniform float stars;
uniform vec3 cloudColor;
uniform float clouds;
uniform float cloudSpeed;
uniform float time;
varying vec3 vDir;

float hash( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}
float noise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), u.x ),
              mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
float fbm( vec2 p ) {
  float v = 0.0;
  float a = 0.5;
  for ( int o = 0; o < 4; o++ ) {
    v += a * noise( p );
    p = p * 2.03 + 17.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 d = normalize( vDir );
  float y = d.y;
  vec3 c = y > 0.0 ? mix( horizon, zenith, pow( y, 0.55 ) ) : mix( horizon, below, pow( -y, 0.4 ) );

  // Étoiles : points d'une grille angulaire, scintillants, effacés près de l'horizon.
  if ( stars > 0.0 && y > 0.0 ) {
    vec2 grid = vec2( atan( d.z, d.x ) * 180.0, y * 260.0 );
    vec2 cell = floor( grid );
    float h = hash( cell );
    if ( h > 1.0 - 0.06 * stars ) {
      vec2 f = fract( grid ) - 0.5;
      float twinkle = 0.6 + 0.4 * sin( time * 0.05 + h * 60.0 );
      c += vec3( 1.6 ) * smoothstep( 0.18, 0.0, length( f ) ) * twinkle * smoothstep( 0.0, 0.2, y );
    }
  }

  // Astre et halo.
  vec3 s = normalize( sunDir );
  float cosA = dot( d, s );
  float disc = smoothstep( cos( sunSize ), cos( sunSize * 0.92 ), cosA );
  if ( crescent > 0.5 ) {
    // Une lune mordue par un disque décalé.
    vec3 bite = normalize( s + vec3( 0.03, 0.02, 0.0 ) );
    disc *= 1.0 - smoothstep( cos( sunSize * 0.95 ), cos( sunSize * 0.85 ), dot( d, bite ) );
  }
  float glow = pow( max( cosA, 0.0 ), 1.0 / max( sunGlow, 1e-3 ) );
  c += sunColor * ( disc * 3.0 + glow * 0.35 );

  // Nuages : une couche projetée au-dessus de l'horizon, qui dérive.
  if ( clouds > 0.0 && y > -0.05 ) {
    vec2 uv = d.xz / ( y + 0.25 ) * 1.4 + vec2( time * cloudSpeed, 0.0 );
    float n = fbm( uv );
    float k = smoothstep( 1.0 - clouds, 1.0 - clouds + 0.25, n ) * smoothstep( -0.05, 0.12, y );
    vec3 lit = cloudColor * ( 0.85 + 0.35 * glow ) + sunColor * glow * 0.25;
    c = mix( c, lit, k * 0.85 );
  }
  gl_FragColor = vec4( c, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface Sky {
  readonly mesh: Mesh;
  update(frame: number): void;
}

export function createSky(look: SkyLook): Sky {
  const material = new ShaderMaterial({
    uniforms: {
      zenith: { value: new Color(look.zenith) },
      horizon: { value: new Color(look.horizon) },
      below: { value: new Color(look.below) },
      sunDir: { value: new Vector3(...look.sunDir).normalize() },
      sunColor: { value: new Color(look.sunColor) },
      sunSize: { value: look.sunSize },
      sunGlow: { value: look.sunGlow },
      crescent: { value: look.crescent === true ? 1 : 0 },
      stars: { value: look.stars ?? 0 },
      cloudColor: { value: new Color(look.cloudColor ?? 0xffffff) },
      clouds: { value: look.clouds ?? 0 },
      cloudSpeed: { value: look.cloudSpeed ?? 0.0006 },
      time: { value: 0 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new Mesh(new SphereGeometry(RADIUS, 48, 24), material);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return {
    mesh,
    update(frame) {
      material.uniforms.time!.value = frame;
      // Le dôme suit la caméra : l'astre et l'horizon restent à l'infini.
    },
  };
}
