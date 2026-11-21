/**
 * Quadrillage du fond de la salle d'entraînement : une ligne toutes les 10 unités, plus marquée
 * toutes les 50, pour juger distances et hauteurs.
 */
import { Mesh, PlaneGeometry, ShaderMaterial } from 'three';

const VERTEX = /* glsl */ `
varying vec2 vPos;
void main() {
  vPos = ( modelMatrix * vec4( position, 1.0 ) ).xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const FRAGMENT = /* glsl */ `
varying vec2 vPos;
float line( vec2 p, float step, float width ) {
  vec2 g = abs( fract( p / step - 0.5 ) - 0.5 ) * step / fwidth( p );
  return 1.0 - min( min( g.x, g.y ) / width, 1.0 );
}
void main() {
  float minor = line( vPos, 10.0, 1.0 );
  float major = line( vPos, 50.0, 1.6 );
  vec3 base = vec3( 0.86, 0.9, 0.95 );
  vec3 c = mix( base, vec3( 0.55, 0.65, 0.8 ), max( minor * 0.35, major * 0.8 ) );
  gl_FragColor = vec4( c, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createGrid(): Mesh {
  const mesh = new Mesh(
    new PlaneGeometry(1400, 800).translate(0, 120, -90),
    new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT }),
  );
  mesh.name = 'grid';
  return mesh;
}
