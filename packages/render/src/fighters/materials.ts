/**
 * Matières des figurines (SPEC-finition.md, phase 2) : chaque zone de couleur est un tissu, un
 * cuir, un métal, de la peau, des cheveux… Rugosité, métal, relief et lustre en découlent, et un
 * relief généré par le code (trame, grain, brossage, mèches) s'y ajoute dans le shader, d'après la
 * position du sommet en pose de référence : le motif reste collé au corps quand il bouge.
 *
 * Aucune texture : tout est calculé, et le relief s'efface quand il devient plus fin qu'un pixel
 * (pas de scintillement à distance de jeu). Logique pure ici ; le GLSL est inséré par
 * `figurine.ts`.
 */
import { ZONES, type ZoneName } from './sdf.ts';

export type MaterialKind = 'fabric' | 'silk' | 'leather' | 'metal' | 'skin' | 'hair' | 'plain';

/** Matière de chaque zone quand le personnage n'en précise pas. */
export const DEFAULT_MATERIALS: Readonly<Record<ZoneName, MaterialKind>> = {
  primary: 'fabric',
  secondary: 'fabric',
  skin: 'skin',
  hair: 'hair',
  accent: 'metal',
  dark: 'leather',
  light: 'fabric',
  player: 'fabric',
};

/** Rugosité, métal, force du relief, lustre (reflet doux des bords). */
const PARAMS: Readonly<Record<MaterialKind, readonly [number, number, number, number]>> = {
  fabric: [0.82, 0, 0.55, 0.4],
  silk: [0.38, 0, 0.18, 0.75],
  leather: [0.52, 0, 0.6, 0.12],
  metal: [0.3, 0.9, 0.35, 0],
  skin: [0.5, 0, 0.12, 0],
  hair: [0.42, 0, 0.55, 0.35],
  plain: [0.45, 0, 0, 0.1],
};

/** Poids des motifs de relief : trame, grain de cuir, brossage, mèches. */
const PATTERNS: Readonly<Record<MaterialKind, readonly [number, number, number, number]>> = {
  fabric: [1, 0, 0, 0],
  silk: [1, 0, 0, 0],
  leather: [0, 1, 0, 0],
  metal: [0, 0, 1, 0],
  skin: [0, 0, 0, 0],
  hair: [0, 0, 0, 1],
  plain: [0, 0, 0, 0],
};

export interface ZoneMaterials {
  /** Par zone, dans l'ordre de `ZONES` : rugosité, métal, relief, lustre. */
  readonly params: readonly (readonly [number, number, number, number])[];
  /** Par zone : poids des quatre motifs. */
  readonly patterns: readonly (readonly [number, number, number, number])[];
  /** Par zone : 1 pour la peau (lumière qui diffuse sous la surface), 0 sinon. */
  readonly skin: readonly number[];
}

/** Matières des zones d'un personnage : celles par défaut, remplacées par les siennes. */
export function zoneMaterials(own: Partial<Record<ZoneName, MaterialKind>> = {}): ZoneMaterials {
  const kinds = ZONES.map((z) => own[z] ?? DEFAULT_MATERIALS[z]);
  return {
    params: kinds.map((k) => PARAMS[k]),
    patterns: kinds.map((k) => PATTERNS[k]),
    skin: kinds.map((k) => (k === 'skin' ? 1 : 0)),
  };
}

/** GLSL du relief : hauteur du motif au point `p` (pose de référence), pondérée par `w`. */
export const DETAIL_GLSL = /* glsl */ `
float fHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float fNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( fHash( i ), fHash( i + vec3( 1, 0, 0 ) ), f.x ),
                   mix( fHash( i + vec3( 0, 1, 0 ) ), fHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( fHash( i + vec3( 0, 0, 1 ) ), fHash( i + vec3( 1, 0, 1 ) ), f.x ),
                   mix( fHash( i + vec3( 0, 1, 1 ) ), fHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
// Effacement d'un motif de fréquence f quand il devient plus fin qu'un pixel.
float fFade( float f, float px ) { return clamp( 1.5 - px * f * 1.2, 0.0, 1.0 ); }
float figurineDetail( vec3 p, vec4 w, float px ) {
  float h = 0.0;
  // Tissu : plis doux, et la trame quand on la voit.
  float folds = fNoise( p * 22.0 ) * 0.8 + fNoise( p * 47.0 ) * 0.2;
  float weave = ( sin( p.x * 1300.0 + p.z * 1300.0 ) * sin( p.y * 1300.0 ) ) * 0.5 + 0.5;
  h += w.x * ( 0.6 * folds * fFade( 40.0, px ) + 0.3 * weave * fFade( 1300.0, px ) );
  // Cuir : grain serré et quelques plis.
  float grain = fNoise( p * 420.0 );
  float creases = 1.0 - abs( fNoise( p * 45.0 ) * 2.0 - 1.0 );
  h += w.y * ( 0.5 * grain * fFade( 420.0, px ) + 0.25 * creases * creases * fFade( 45.0, px ) );
  // Métal : brossage dans le sens de la longueur, rayures rares.
  float brush = fNoise( vec3( p.x * 900.0, p.y * 25.0, p.z * 900.0 ) );
  float scratch = smoothstep( 0.92, 1.0, fNoise( p * 160.0 + vec3( 3.0 ) ) );
  h += w.z * ( 0.4 * brush * fFade( 900.0, px ) - 0.6 * scratch * fFade( 160.0, px ) );
  // Cheveux : mèches qui suivent la chute, ondulées.
  float strands = sin( p.z * 520.0 + p.x * 260.0 + fNoise( p * 40.0 ) * 9.0 ) * 0.5 + 0.5;
  h += w.w * ( 0.7 * strands * fFade( 520.0, px ) + 0.4 * fNoise( p * 60.0 ) * fFade( 60.0, px ) );
  return h;
}
// Normale perturbée par une hauteur (dérivées à l'écran, méthode de Mikkelsen).
vec3 figurineBump( vec3 pos, vec3 n, float h ) {
  vec3 dpx = dFdx( pos );
  vec3 dpy = dFdy( pos );
  float dhx = dFdx( h );
  float dhy = dFdy( h );
  vec3 r1 = cross( dpy, n );
  vec3 r2 = cross( n, dpx );
  float det = dot( dpx, r1 );
  vec3 grad = sign( det ) * ( dhx * r1 + dhy * r2 );
  return normalize( abs( det ) * n - grad );
}`;
