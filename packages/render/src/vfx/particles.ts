/**
 * Particules sur la carte graphique (SPEC-visuals.md, phase 2).
 *
 * Une particule est écrite une seule fois, à sa naissance : position, vitesse, freinage, gravité,
 * taille, durée, couleur, forme. Sa position à chaque image est calculée par le shader à partir de
 * l'instant affiché, en frames de simulation : les particules se figent en pause et ralentissent
 * au ralenti, comme le reste du rendu. Le processeur ne touche qu'aux emplacements nouveaux.
 *
 * Deux couches : lumineuse (fondu additif : étincelles, éclats, anneaux, traînées) et opaque
 * (fondu normal : fumée, poussière). Une couche = un appel de dessin.
 */
import {
  AdditiveBlending,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';

/** Formes, lues par le shader. */
export const P_DOT = 0;
/** Trait étiré dans le sens de la vitesse. */
export const P_STREAK = 1;
export const P_RING = 2;
/** Éclat en étoile à quatre branches. */
export const P_FLARE = 3;
/** Bouffée douce (fumée, poussière) : couche opaque. */
export const P_PUFF = 4;
/**
 * Formes d'impact stylisées (SPEC-finition.md, phase 3), dessinées par le shader et tournées au
 * hasard : éclat de bande dessinée à pointes, anneau brisé en éclats, éclaboussure d'encre, et
 * scintillement d'étoile (KO vers le haut).
 */
export const P_BURST = 5;
export const P_SHARD = 6;
export const P_SPLAT = 7;
export const P_TWINKLE = 8;

/** Paramètres d'une particule. Les couleurs peuvent dépasser 1 : la particule rayonne. */
export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  /** Freinage par frame (0 = aucun ; 0,1 = la vitesse fond de 10 % par frame environ). */
  drag: number;
  /** Accélération vers le bas, en unités par frame². */
  gravity: number;
  sizeStart: number;
  sizeEnd: number;
  /** Durée, en frames. */
  life: number;
  shape: number;
  r: number;
  g: number;
  b: number;
  /** Opacité de départ (couche opaque) ou intensité (couche lumineuse). */
  a: number;
}

export function createSpec(): ParticleSpec {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    drag: 0,
    gravity: 0,
    sizeStart: 1,
    sizeEnd: 0,
    life: 10,
    shape: P_DOT,
    r: 1,
    g: 1,
    b: 1,
    a: 1,
  };
}

/** Réserve de particules d'une couche : mémoire du processeur, recopiée sur la carte graphique. */
export interface ParticlePool {
  readonly capacity: number;
  /** Emplacements utilisés, au plus `capacity` : fixé par la qualité graphique. */
  limit: number;
  /** Prochain emplacement : la réserve tourne en rond, la plus ancienne particule cède sa place. */
  next: number;
  /** x, y, z, naissance. */
  readonly start: Float32Array;
  /** vx, vy, freinage, gravité. */
  readonly motion: Float32Array;
  /** taille de départ, taille d'arrivée, durée, forme. */
  readonly look: Float32Array;
  /** r, g, b, a. */
  readonly color: Float32Array;
  /** Emplacements écrits depuis le dernier envoi à la carte graphique (bornes incluses). */
  dirtyMin: number;
  dirtyMax: number;
  /** Particules émises depuis la création (pour les tests et le débogage). */
  emitted: number;
}

export function createParticlePool(capacity: number): ParticlePool {
  return {
    capacity,
    limit: capacity,
    next: 0,
    start: new Float32Array(capacity * 4),
    motion: new Float32Array(capacity * 4),
    look: new Float32Array(capacity * 4),
    color: new Float32Array(capacity * 4),
    dirtyMin: capacity,
    dirtyMax: -1,
    emitted: 0,
  };
}

/** Ajoute une particule née à `frame`. N'alloue rien. */
export function emit(pool: ParticlePool, p: ParticleSpec, frame: number): void {
  if (pool.limit === 0) return;
  const i = pool.next;
  const o = i * 4;
  pool.start[o] = p.x;
  pool.start[o + 1] = p.y;
  pool.start[o + 2] = p.z;
  pool.start[o + 3] = frame;
  pool.motion[o] = p.vx;
  pool.motion[o + 1] = p.vy;
  pool.motion[o + 2] = p.drag;
  pool.motion[o + 3] = p.gravity;
  pool.look[o] = p.sizeStart;
  pool.look[o + 1] = p.sizeEnd;
  pool.look[o + 2] = p.life;
  pool.look[o + 3] = p.shape;
  pool.color[o] = p.r;
  pool.color[o + 1] = p.g;
  pool.color[o + 2] = p.b;
  pool.color[o + 3] = p.a;
  if (i < pool.dirtyMin) pool.dirtyMin = i;
  if (i > pool.dirtyMax) pool.dirtyMax = i;
  pool.next = (i + 1) % pool.limit;
  pool.emitted++;
}

/**
 * Position d'une particule à l'instant `time`, identique au shader (sert aux tests). Renvoie
 * faux si elle n'est pas visible à cet instant.
 */
export function particleAt(
  pool: ParticlePool,
  i: number,
  time: number,
  out: { x: number; y: number },
): boolean {
  const o = i * 4;
  const life = pool.look[o + 2]!;
  const age = time - pool.start[o + 3]!;
  if (life <= 0 || age < 0 || age >= life) return false;
  const drag = pool.motion[o + 2]!;
  const k = drag > 0 ? (1 - Math.exp(-drag * age)) / drag : age;
  const g = pool.motion[o + 3]!;
  out.x = pool.start[o]! + pool.motion[o]! * k;
  out.y = pool.start[o + 1]! + pool.motion[o + 1]! * k - 0.5 * g * age * age;
  return true;
}

export function liveParticles(pool: ParticlePool, time: number): number {
  let n = 0;
  const at = { x: 0, y: 0 };
  for (let i = 0; i < pool.limit; i++) if (particleAt(pool, i, time, at)) n++;
  return n;
}

/** Hasard reproductible dans [0, 1) : même graine, même effet, à chaque relecture. */
export function hash01(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const VERTEX = /* glsl */ `
uniform float uTime;
attribute vec4 aStart;
attribute vec4 aMotion;
attribute vec4 aLook;
attribute vec4 aColor;
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
varying float vT;
varying float vSeed;
float pHash( vec3 p ) { return fract( sin( dot( p, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ); }
void main() {
  float life = aLook.z;
  float age = uTime - aStart.w;
  float t = age / max( life, 1e-3 );
  if ( life <= 0.0 || age < 0.0 || t >= 1.0 ) {
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    return;
  }
  float drag = aMotion.z;
  float k = drag > 0.0 ? ( 1.0 - exp( -drag * age ) ) / drag : age;
  vec2 vel = aMotion.xy * exp( -drag * age ) - vec2( 0.0, aMotion.w * age );
  vec3 p = vec3( aStart.xy + aMotion.xy * k - vec2( 0.0, 0.5 * aMotion.w * age * age ), aStart.z );
  float size = mix( aLook.x, aLook.y, t );
  vec2 corner = position.xy;
  vec2 offset;
  if ( abs( aLook.w - 1.0 ) < 0.5 ) {
    float speed = length( vel );
    vec2 dir = speed > 1e-4 ? vel / speed : vec2( 1.0, 0.0 );
    vec2 side = vec2( -dir.y, dir.x );
    offset = dir * corner.x * size * ( 1.0 + min( speed, 3.0 ) * 2.0 ) + side * corner.y * size * 0.16;
  } else {
    offset = corner * size;
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4( p + vec3( offset, 0.0 ), 1.0 );
  vUv = corner;
  // Formes d'impact : tournées au hasard (graine tirée de la naissance), les éclats en rotation.
  vSeed = pHash( aStart.xyz + aStart.w );
  if ( aLook.w > 4.5 ) {
    float spin = aLook.w > 5.5 && aLook.w < 6.5 ? ( vSeed - 0.5 ) * 0.12 * age : 0.0;
    float a = vSeed * 6.2832 + spin;
    vUv = mat2( cos( a ), sin( a ), -sin( a ), cos( a ) ) * corner;
  }
  vColor = aColor;
  vShape = aLook.w;
  vT = t;
}`;

const FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
varying float vT;
varying float vSeed;
void main() {
  float r = length( vUv );
  float shape;
  int kind = int( vShape + 0.5 );
  float ang = atan( vUv.y, vUv.x );
  if ( kind == 5 ) {
    // Éclat à pointes irrégulières, cœur plus clair.
    float spikes = 9.0 + floor( vSeed * 4.0 );
    float k = fract( ang / 6.2832 * spikes + vSeed * 3.0 );
    float tip = 0.5 + 0.12 * sin( floor( ang / 6.2832 * spikes + vSeed * 3.0 ) * 7.3 + vSeed * 20.0 );
    float edge = mix( 0.42, 0.62 + tip * 0.5, 1.0 - abs( k * 2.0 - 1.0 ) );
    shape = ( 1.0 - smoothstep( edge - 0.06, edge, r ) ) * ( 0.55 + 0.45 * ( 1.0 - r ) );
  } else if ( kind == 6 ) {
    // Anneau brisé : arcs séparés par des cassures.
    float arc = fract( ang / 6.2832 * 5.0 + vSeed );
    float gap = smoothstep( 0.0, 0.08, arc ) * ( 1.0 - smoothstep( 0.62, 0.7, arc ) );
    float band = 1.0 - smoothstep( 0.0, 0.09 + 0.05 * arc, abs( r - 0.78 ) );
    shape = band * gap;
  } else if ( kind == 7 ) {
    // Éclaboussure d'encre : bord ondulé et gouttes détachées.
    float wob = 0.55 + 0.16 * sin( ang * 7.0 + vSeed * 30.0 ) * sin( ang * 3.0 + vSeed * 11.0 );
    float blob = 1.0 - smoothstep( wob - 0.05, wob, r );
    vec2 drop = vec2( cos( floor( ang / 0.9 ) * 0.9 + 0.45 ), sin( floor( ang / 0.9 ) * 0.9 + 0.45 ) ) * ( 0.8 + 0.1 * vSeed );
    float drops = 1.0 - smoothstep( 0.06, 0.1, length( vUv - drop ) );
    shape = max( blob, drops );
  } else if ( kind == 8 ) {
    // Scintillement : quatre rayons fins et longs, cœur, pulsation.
    vec2 a = abs( vUv );
    float rays = max( 1.0 - a.x * 22.0, 0.0 ) * ( 1.0 - a.y ) + max( 1.0 - a.y * 22.0, 0.0 ) * ( 1.0 - a.x );
    float core = pow( max( 1.0 - r * 2.2, 0.0 ), 2.0 ) * 2.0;
    shape = ( rays + core ) * ( 0.65 + 0.35 * sin( vT * 40.0 ) );
  } else if ( kind == 1 ) {
    shape = ( 1.0 - smoothstep( 0.0, 1.0, abs( vUv.y ) ) ) * ( 1.0 - smoothstep( 0.6, 1.0, abs( vUv.x ) ) );
  } else if ( kind == 2 ) {
    shape = 1.0 - smoothstep( 0.0, 0.14, abs( r - 0.86 ) );
  } else if ( kind == 3 ) {
    vec2 a = abs( vUv );
    float rays = max( 1.0 - a.x * 9.0, 0.0 ) * ( 1.0 - a.y ) + max( 1.0 - a.y * 9.0, 0.0 ) * ( 1.0 - a.x );
    shape = clamp( rays + pow( max( 1.0 - r, 0.0 ), 3.0 ) * 1.5, 0.0, 1.5 );
  } else {
    shape = pow( max( 1.0 - r, 0.0 ), kind == 4 ? 1.4 : 2.2 );
  }
  if ( shape <= 0.002 ) discard;
  #ifdef PUFF
    float fade = 1.0 - vT * vT;
    gl_FragColor = vec4( vColor.rgb, vColor.a * shape * fade );
  #else
    float fade = ( 1.0 - vT ) * ( 1.0 - vT );
    gl_FragColor = vec4( vColor.rgb * vColor.a * shape * fade, 1.0 );
  #endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface ParticleLayer {
  readonly mesh: Mesh;
  readonly pool: ParticlePool;
  /** Envoie les emplacements nouveaux à la carte graphique et règle l'instant affiché. */
  update(time: number): void;
  /** Limite le nombre de particules (qualité graphique) ; efface celles qui vivent. */
  setLimit(limit: number): void;
  dispose(): void;
}

/** Couche dessinée en un appel. `puff` : fondu normal (fumée) au lieu du fondu additif. */
export function createParticleLayer(capacity: number, puff: boolean): ParticleLayer {
  const pool = createParticlePool(capacity);
  const quad = new PlaneGeometry(2, 2);
  const geometry = new InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  const attributes = [
    ['aStart', pool.start],
    ['aMotion', pool.motion],
    ['aLook', pool.look],
    ['aColor', pool.color],
  ] as const;
  const buffers = attributes.map(([name, array]) => {
    const attribute = new InstancedBufferAttribute(array, 4);
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
    return attribute;
  });
  geometry.instanceCount = capacity;
  const material = new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines: puff ? { PUFF: '' } : {},
    transparent: true,
    depthWrite: false,
    blending: puff ? NormalBlending : AdditiveBlending,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = puff ? 'particles-puff' : 'particles-glow';
  mesh.frustumCulled = false;
  // La fumée passe derrière les étincelles.
  mesh.renderOrder = puff ? 1 : 2;
  return {
    mesh,
    pool,
    update(time) {
      material.uniforms.uTime!.value = time;
      if (pool.dirtyMax < pool.dirtyMin) return;
      const offset = pool.dirtyMin * 4;
      const count = (pool.dirtyMax - pool.dirtyMin + 1) * 4;
      for (const attribute of buffers) {
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(offset, count);
        attribute.needsUpdate = true;
      }
      pool.dirtyMin = pool.capacity;
      pool.dirtyMax = -1;
    },
    setLimit(limit) {
      pool.limit = Math.max(0, Math.min(pool.capacity, limit));
      pool.next = 0;
      pool.look.fill(0);
      pool.dirtyMin = 0;
      pool.dirtyMax = pool.capacity - 1;
      geometry.instanceCount = pool.limit;
    },
    dispose() {
      quad.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
