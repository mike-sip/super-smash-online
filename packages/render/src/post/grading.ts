/**
 * Réglages d'image d'un stage : exposition, bloom, étalonnage, vignette (SPEC-visuals.md).
 * Logique pure : chaque thème peut en préciser une partie, le reste prend la valeur par défaut.
 */

export interface PostLook {
  /** Multiplie la lumière avant le mappage de tons. */
  readonly exposure: number;
  readonly bloomStrength: number;
  readonly bloomRadius: number;
  /** Luminance (linéaire, avant mappage) au-delà de laquelle une surface rayonne. */
  readonly bloomThreshold: number;
  /** 1 = inchangé. */
  readonly saturation: number;
  readonly contrast: number;
  /** Teinte ajoutée aux ombres et teinte multipliée aux hautes lumières, 0xRRGGBB. */
  readonly lift: number;
  readonly gain: number;
  /** Assombrissement des coins, de 0 à 1. */
  readonly vignette: number;
}

export const DEFAULT_LOOK: PostLook = {
  exposure: 1,
  bloomStrength: 0.45,
  bloomRadius: 0.3,
  bloomThreshold: 1,
  saturation: 1.1,
  contrast: 1.06,
  lift: 0x000000,
  gain: 0xffffff,
  vignette: 0.28,
};

export function lookOf(partial: Partial<PostLook> | undefined): PostLook {
  return { ...DEFAULT_LOOK, ...partial };
}

/** Composantes d'une couleur 0xRRGGBB, de 0 à 1. */
export function rgbOf(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

/** Étalonnage appliqué à une couleur affichée (0 à 1), identique au shader : sert aux tests. */
export function grade(look: PostLook, rgb: readonly [number, number, number]): number[] {
  const lift = rgbOf(look.lift);
  const gain = rgbOf(look.gain);
  let c = rgb.map((v, i) => v * gain[i]! + lift[i]! * (1 - v));
  const l = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  c = c.map((v) => l + (v - l) * look.saturation);
  c = c.map((v) => (v - 0.5) * look.contrast + 0.5);
  return c.map((v) => Math.min(1, Math.max(0, v)));
}

export const GRADING_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

export const GRADING_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec3 lift;
uniform vec3 gain;
uniform float saturation;
uniform float contrast;
uniform float vignette;
varying vec2 vUv;
void main() {
  vec4 texel = texture2D( tDiffuse, vUv );
  vec3 c = texel.rgb * gain + lift * ( 1.0 - texel.rgb );
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  c = mix( vec3( l ), c, saturation );
  c = ( c - 0.5 ) * contrast + 0.5;
  vec2 d = vUv - 0.5;
  c *= 1.0 - vignette * smoothstep( 0.18, 0.75, dot( d, d ) * 2.0 );
  // Un soupçon de bruit casse les bandes des dégradés de ciel.
  float n = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  c += ( n - 0.5 ) / 255.0;
  gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), texel.a );
}`;
