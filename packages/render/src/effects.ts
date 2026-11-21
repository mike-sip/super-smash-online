/**
 * Effets attachés aux combattants et à l'écran : tremblement de la victime, bulle de bouclier,
 * éclair d'écran. Les effets d'événements (étincelles, KO, poussière…) sont des particules : voir
 * `vfx/library.ts`.
 *
 * Le temps est celui de la simulation, en frames : tout se fige en pause et ralentit au ralenti.
 */
import { A_HITSTUN, A_SHIELD, A_SHIELDSTUN } from '@game/sim-core';
import {
  AdditiveBlending,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  type Camera,
} from 'three';
import { PLAYER_COLORS } from './fighters/visual.ts';

const SHAKE = 0.35;

/**
 * Décalage horizontal, en unités de jeu, d'une victime gelée par le hitlag. Il alterne d'une
 * frame simulée à l'autre ; l'attaquant, gelé lui aussi, ne tremble pas.
 */
export function hitShake(action: number, hitlag: number): number {
  if (hitlag <= 0 || (action !== A_HITSTUN && action !== A_SHIELDSTUN)) return 0;
  return hitlag % 2 === 0 ? SHAKE : -SHAKE;
}

/** Vrai si le combattant tient son bouclier levé. */
export const showsShield = (action: number): boolean =>
  action === A_SHIELD || action === A_SHIELDSTUN;

/** Rayon de la bulle, en hauteurs de combattant, selon la résistance restante (de 0 à 1). */
export const shieldRadius = (strength: number): number =>
  0.28 + 0.42 * (strength < 0 ? 0 : strength > 1 ? 1 : strength);

/** Durée d'un éclair d'écran, en frames. */
const FLASH_LIFE = 12;

/** Intensité d'un éclair né à `born` avec l'intensité `amount`, à l'instant `time`. */
export function flashLevel(amount: number, born: number, time: number): number {
  const age = time - born;
  if (amount <= 0 || age < 0 || age >= FLASH_LIFE) return 0;
  const left = 1 - age / FLASH_LIFE;
  return amount * left * left;
}

const SHIELD_VERTEX = /* glsl */ `
attribute float aStrength;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vLocal;
varying vec3 vTint;
varying float vStrength;
void main() {
  vec4 mv = modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
  vNormal = normalize( normalMatrix * mat3( instanceMatrix ) * normal );
  vView = -mv.xyz;
  vLocal = position;
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;
  #else
    vTint = vec3( 1.0 );
  #endif
  vStrength = aStrength;
  gl_Position = projectionMatrix * mv;
}`;

const SHIELD_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec3 vNormal;
varying vec3 vView;
varying vec3 vLocal;
varying vec3 vTint;
varying float vStrength;
void main() {
  float facing = abs( dot( normalize( vNormal ), normalize( vView ) ) );
  float rim = pow( 1.0 - facing, 2.2 );
  // Plein : à la couleur du joueur ; presque épuisé : vire au rouge.
  vec3 color = mix( vec3( 2.6, 0.55, 0.35 ), vTint * 1.7, smoothstep( 0.15, 0.6, vStrength ) );
  // Fissures quand il faiblit : réseau de lignes fines, plus dense à mesure qu'il s'use.
  float crack = 0.0;
  if ( vStrength < 0.45 ) {
    vec3 q = vLocal * 5.5;
    float n = abs( sin( q.x * 1.7 + q.y * 2.3 ) * sin( q.y * 1.9 - q.z * 2.1 ) * sin( q.z * 2.2 + q.x * 1.3 ) );
    crack = ( 1.0 - smoothstep( 0.0, 0.05, n ) ) * ( 0.45 - vStrength ) * 2.4;
  }
  float bands = 0.5 + 0.5 * sin( vLocal.y * 16.0 + uTime * 0.3 );
  float glow = 0.08 + rim * 0.8 + crack + bands * 0.035;
  gl_FragColor = vec4( color * glow, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface EffectVisuals {
  readonly root: Group;
  /** Bulle de bouclier du joueur ; `radius` = 0 la cache. `strength` de 0 à 1. */
  shield(player: number, x: number, y: number, radius: number, strength: number): void;
  /** Instant affiché, en frames : anime les bulles. */
  update(time: number): void;
  dispose(): void;
}

export function createEffectVisuals(players: number): EffectVisuals {
  const root = new Group();
  root.name = 'effects';

  const bubbleGeometry = new SphereGeometry(1, 28, 18);
  const strength = new InstancedBufferAttribute(new Float32Array(players).fill(1), 1);
  bubbleGeometry.setAttribute('aStrength', strength);
  const bubbleMaterial = new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: SHIELD_VERTEX,
    fragmentShader: SHIELD_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const bubbles = new InstancedMesh(bubbleGeometry, bubbleMaterial, players);
  bubbles.name = 'shields';
  bubbles.frustumCulled = false;
  bubbles.renderOrder = 3;
  const matrix = new Matrix4();
  const hidden = new Matrix4().makeScale(0, 0, 0);
  const color = new Color();
  for (let i = 0; i < players; i++) {
    bubbles.setMatrixAt(i, hidden);
    bubbles.setColorAt(i, color.setHex(PLAYER_COLORS[i % PLAYER_COLORS.length]!));
  }
  root.add(bubbles);

  return {
    root,
    shield(player, x, y, radius, s) {
      bubbles.setMatrixAt(
        player,
        radius > 0 ? matrix.makeScale(radius, radius, radius).setPosition(x, y, 0) : hidden,
      );
      bubbles.instanceMatrix.needsUpdate = true;
      if (strength.array[player] !== s) {
        strength.array[player] = s;
        strength.needsUpdate = true;
      }
    },
    update(time) {
      bubbleMaterial.uniforms.uTime!.value = time;
    },
    dispose() {
      bubbleGeometry.dispose();
      bubbleMaterial.dispose();
      bubbles.dispose();
    },
  };
}

/** Voile coloré devant la caméra, pour les éclairs d'écran (coups décisifs, KO, parades). */
export interface ScreenFlash {
  readonly mesh: Mesh;
  /** Lance un éclair de couleur 0xRRGGBB et d'intensité `amount` (0 à 1) à la frame `frame`. */
  start(color: number, amount: number, frame: number): void;
  update(time: number): void;
  dispose(): void;
}

export function createScreenFlash(camera: Camera): ScreenFlash {
  const geometry = new PlaneGeometry(1, 1);
  const material = new MeshBasicMaterial({
    color: 0x000000,
    blending: AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'screen-flash';
  // Juste au-delà du plan proche, assez grand pour couvrir tout écran.
  mesh.position.set(0, 0, -2);
  mesh.scale.set(20, 20, 1);
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;
  mesh.visible = false;
  camera.add(mesh);
  const tint = new Color();
  let amount = 0;
  let born = 0;
  return {
    mesh,
    start(c, a, frame) {
      if (a < flashLevel(amount, born, frame)) return;
      tint.setHex(c);
      amount = a;
      born = frame;
    },
    update(time) {
      const level = flashLevel(amount, born, time);
      mesh.visible = level > 0;
      if (level > 0) material.color.copy(tint).multiplyScalar(level);
    },
    dispose() {
      camera.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
