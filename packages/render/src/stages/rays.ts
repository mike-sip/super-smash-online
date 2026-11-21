/**
 * Rayons de lumière (SPEC-finition.md, phase 1) : faisceaux doux qui partent du soleil et
 * traversent la scène en éventail, au-dessus de la brume. Des bandes additives, dessinées par
 * shader (fondu sur les bords et en longueur, lente respiration), toutes en un appel de dessin.
 * Visibles en `Haut` et `Ultra` seulement (`userData.highOnly`).
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import { seeded } from './lowpoly.ts';
import type { Animated } from './water.ts';

export interface RaysLook {
  /** Point de départ, du côté du soleil. */
  readonly origin: readonly [number, number, number];
  /** Arrivées : de `fromX` à `toX`, à la hauteur `y` et la profondeur `z`. */
  readonly fromX: number;
  readonly toX: number;
  readonly y: number;
  readonly z: number;
  readonly count: number;
  /** Largeur au départ et à l'arrivée. */
  readonly width: readonly [number, number];
  readonly color: number;
  readonly intensity: number;
  readonly seed: number;
}

export function createRays(look: RaysLook): Animated {
  const random = seeded(look.seed);
  const o = new Vector3(...look.origin);
  const positions: number[] = [];
  const uvs: number[] = [];
  const ids: number[] = [];
  const index: number[] = [];
  const back = new Vector3(0, 0, 1);
  for (let k = 0; k < look.count; k++) {
    const t = look.count === 1 ? 0.5 : k / (look.count - 1);
    const x = look.fromX + (look.toX - look.fromX) * (t + (random() - 0.5) * 0.12);
    const target = new Vector3(x, look.y, look.z);
    const dir = target.clone().sub(o).normalize();
    const side = new Vector3().crossVectors(dir, back).normalize();
    const w0 = look.width[0] * (0.6 + random() * 0.8);
    const w1 = look.width[1] * (0.6 + random() * 0.8);
    const corners = [
      o.clone().addScaledVector(side, -w0),
      o.clone().addScaledVector(side, w0),
      target.clone().addScaledVector(side, -w1),
      target.clone().addScaledVector(side, w1),
    ];
    const base = k * 4;
    for (const [i, c] of corners.entries()) {
      positions.push(c.x, c.y, c.z);
      uvs.push(i % 2, i < 2 ? 0 : 1);
      ids.push(k);
    }
    index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setAttribute('ray', new BufferAttribute(new Float32Array(ids), 1));
  geometry.setIndex(index);
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new Color(look.color).multiplyScalar(look.intensity) },
    },
    vertexShader: /* glsl */ `
      attribute float ray;
      varying vec2 vUv;
      varying float vRay;
      void main() {
        vUv = uv;
        vRay = ray;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying float vRay;
      void main() {
        float across = 1.0 - abs( vUv.x * 2.0 - 1.0 );
        across *= across;
        // Fort près du soleil, s'éteint avant d'atteindre le sol ; jamais net au départ.
        float along = smoothstep( 0.0, 0.12, vUv.y ) * ( 1.0 - smoothstep( 0.45, 1.0, vUv.y ) );
        float breathe = 0.65 + 0.35 * sin( uTime * 0.012 + vRay * 2.3 );
        gl_FragColor = vec4( uColor * across * along * breathe, 1.0 );
      }`,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'rays';
  mesh.frustumCulled = false;
  mesh.userData.highOnly = true;
  return {
    mesh,
    update(frame) {
      material.uniforms.uTime!.value = frame;
    },
  };
}
