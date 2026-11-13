/**
 * Effets visuels : impacts, bouclier, parade, bris de bouclier, KO, saisie, accroche.
 *
 * La première moitié du fichier est de la logique pure (quel effet, où, combien de temps) ; la
 * seconde le dessine. Les effets vivent dans une réserve de taille fixe et leur âge se compte en
 * frames de simulation : ils se figent en pause et ralentissent au ralenti, comme le reste.
 */
import {
  A_HITSTUN,
  A_SHIELD,
  A_SHIELDSTUN,
  EV_GRAB,
  EV_HIT,
  EV_KO,
  EV_LEDGE,
  EV_PARRY,
  EV_SHIELD,
  EV_SHIELD_BREAK,
  type FighterView,
} from '@game/sim-core';
import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
} from 'three';
import { PLAYER_COLORS } from './fighters/visual.ts';

/** Disque plein qui éclate puis s'éteint. */
export const FX_DISC = 0;
/** Anneau qui s'élargit en s'éteignant. */
export const FX_RING = 1;

export interface EffectPool {
  readonly capacity: number;
  /** Prochain emplacement à écrire : la réserve tourne en rond. */
  next: number;
  readonly shape: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly size: Float32Array;
  readonly color: Int32Array;
  /** Frame de naissance et durée, en frames simulées. Une durée nulle marque un emplacement libre. */
  readonly born: Int32Array;
  readonly life: Int32Array;
}

export function createEffectPool(capacity = 48): EffectPool {
  return {
    capacity,
    next: 0,
    shape: new Uint8Array(capacity),
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    size: new Float32Array(capacity),
    color: new Int32Array(capacity),
    born: new Int32Array(capacity),
    life: new Int32Array(capacity),
  };
}

/** Ajoute un effet. Réserve pleine : le plus ancien est remplacé. N'alloue rien. */
export function spawnEffect(
  pool: EffectPool,
  shape: number,
  x: number,
  y: number,
  size: number,
  life: number,
  color: number,
  frame: number,
): void {
  const i = pool.next;
  pool.shape[i] = shape;
  pool.x[i] = x;
  pool.y[i] = y;
  pool.size[i] = size;
  pool.life[i] = life;
  pool.color[i] = color;
  pool.born[i] = frame;
  pool.next = (i + 1) % pool.capacity;
}

/** Avancement de l'effet `i` à l'instant `time` (en frames), de 0 à 1 ; -1 s'il n'est pas visible. */
export function effectProgress(pool: EffectPool, i: number, time: number): number {
  const life = pool.life[i]!;
  if (life === 0) return -1;
  const age = time - pool.born[i]!;
  return age < 0 || age >= life ? -1 : age / life;
}

export function liveEffects(pool: EffectPool, time: number): number {
  let count = 0;
  for (let i = 0; i < pool.capacity; i++) if (effectProgress(pool, i, time) >= 0) count++;
  return count;
}

const WHITE = 0xffffff;
const HIT_COLOR = 0xffe08a;
const SHIELD_COLOR = 0x7dd3fc;
const BREAK_COLOR = 0xc084fc;
const GRAB_COLOR = 0xfda4af;
const LEDGE_COLOR = 0x86efac;

/**
 * Ajoute les effets de l'événement `type` (`a` et `b` comme dans `sim-core`). `views` donne
 * l'état des combattants à la frame de l'événement, `heights` leur taille.
 */
export function spawnForEvent(
  pool: EffectPool,
  type: number,
  a: number,
  b: number,
  views: readonly FighterView[],
  heights: Float64Array,
  frame: number,
): void {
  switch (type) {
    case EV_HIT:
    case EV_SHIELD:
    case EV_PARRY: {
      const victim = views[b];
      if (victim === undefined) return;
      let x = victim.x;
      const y = victim.y + heights[b]! / 2;
      // L'impact est sur la victime, du côté d'où vient le coup. Sans attaquant connu (entité
      // sans propriétaire, `a` = -1), il est centré sur elle.
      const attacker = views[a];
      if (attacker !== undefined) x += (attacker.x - victim.x) * 0.3;
      if (type === EV_HIT) {
        // Le hitlag croît avec les dégâts : c'est la seule mesure de la force du coup lisible ici.
        const power = 4 + victim.hitlag * 0.5;
        spawnEffect(pool, FX_DISC, x, y, power, 10, HIT_COLOR, frame);
        spawnEffect(pool, FX_RING, x, y, power * 1.3, 14, WHITE, frame);
      } else if (type === EV_SHIELD) {
        spawnEffect(pool, FX_RING, x, y, 7, 12, SHIELD_COLOR, frame);
      } else {
        spawnEffect(pool, FX_DISC, x, y, 9, 8, WHITE, frame);
        spawnEffect(pool, FX_RING, x, y, 14, 20, WHITE, frame);
      }
      return;
    }
    case EV_SHIELD_BREAK: {
      const who = views[a];
      if (who === undefined) return;
      const y = who.y + heights[a]! / 2;
      spawnEffect(pool, FX_DISC, who.x, y, 14, 16, BREAK_COLOR, frame);
      spawnEffect(pool, FX_RING, who.x, y, 22, 30, BREAK_COLOR, frame);
      return;
    }
    case EV_KO: {
      const who = views[a];
      if (who === undefined) return;
      const color = PLAYER_COLORS[a % PLAYER_COLORS.length]!;
      spawnEffect(pool, FX_DISC, who.x, who.y, 45, 26, color, frame);
      spawnEffect(pool, FX_RING, who.x, who.y, 70, 40, WHITE, frame);
      return;
    }
    case EV_GRAB: {
      const victim = views[b];
      if (victim === undefined) return;
      spawnEffect(pool, FX_DISC, victim.x, victim.y + heights[b]! * 0.6, 4, 8, GRAB_COLOR, frame);
      return;
    }
    case EV_LEDGE: {
      const who = views[a];
      if (who === undefined) return;
      // Le combattant est suspendu par les mains : le rebord est à hauteur de sa tête.
      spawnEffect(pool, FX_RING, who.x, who.y + heights[a]!, 5, 10, LEDGE_COLOR, frame);
      return;
    }
    default:
  }
}

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

/** Plan des effets, juste devant les combattants. */
const EFFECT_Z = 6;
const WHITE_COLOR = new Color(WHITE);

export interface EffectVisuals {
  readonly root: Group;
  /** Met les effets de `pool` à jour pour l'instant `time`, en frames. */
  update(pool: EffectPool, time: number): void;
  /** Bulle de bouclier du joueur ; `radius` = 0 la cache. */
  shield(player: number, x: number, y: number, radius: number): void;
  dispose(): void;
}

export function createEffectVisuals(players: number, capacity: number): EffectVisuals {
  const root = new Group();
  root.name = 'effects';

  // Fondu additif : une couleur qui tend vers le noir disparaît, sans gérer de transparence.
  const flash = new MeshBasicMaterial({
    color: WHITE,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const discGeometry = new CircleGeometry(1, 24);
  const ringGeometry = new RingGeometry(0.82, 1, 32);
  const discs = new InstancedMesh(discGeometry, flash, capacity);
  const rings = new InstancedMesh(ringGeometry, flash, capacity);

  const bubbleGeometry = new SphereGeometry(1, 20, 14);
  const bubbleMaterial = new MeshBasicMaterial({
    color: WHITE,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });
  const bubbles = new InstancedMesh(bubbleGeometry, bubbleMaterial, players);
  bubbles.name = 'shields';

  const matrix = new Matrix4();
  const color = new Color();
  const hidden = new Matrix4().makeScale(0, 0, 0);
  for (const mesh of [discs, rings, bubbles]) {
    mesh.frustumCulled = false;
    for (let i = 0; i < mesh.count; i++) {
      mesh.setMatrixAt(i, hidden);
      mesh.setColorAt(i, color.setHex(WHITE));
    }
  }
  for (let i = 0; i < players; i++) {
    bubbles.setColorAt(
      i,
      color.setHex(PLAYER_COLORS[i % PLAYER_COLORS.length]!).lerp(WHITE_COLOR, 0.45),
    );
  }
  root.add(bubbles, discs, rings);

  return {
    root,
    update(pool, time) {
      for (let i = 0; i < pool.capacity; i++) {
        const t = effectProgress(pool, i, time);
        const isRing = pool.shape[i] === FX_RING;
        const mesh = isRing ? rings : discs;
        const other = isRing ? discs : rings;
        other.setMatrixAt(i, hidden);
        if (t < 0) {
          mesh.setMatrixAt(i, hidden);
          continue;
        }
        const fade = 1 - t;
        // Un disque éclate d'un coup puis se rétracte ; un anneau s'élargit jusqu'au bout.
        const scale = pool.size[i]! * (isRing ? 0.35 + 0.65 * (1 - fade * fade) : 0.5 + 0.5 * fade);
        mesh.setMatrixAt(
          i,
          matrix.makeScale(scale, scale, 1).setPosition(pool.x[i]!, pool.y[i]!, EFFECT_Z),
        );
        mesh.setColorAt(i, color.setHex(pool.color[i]!).multiplyScalar(fade * fade));
      }
      discs.instanceMatrix.needsUpdate = true;
      rings.instanceMatrix.needsUpdate = true;
      discs.instanceColor!.needsUpdate = true;
      rings.instanceColor!.needsUpdate = true;
    },
    shield(player, x, y, radius) {
      bubbles.setMatrixAt(player, matrix.makeScale(radius, radius, radius).setPosition(x, y, 0));
      bubbles.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      discGeometry.dispose();
      ringGeometry.dispose();
      bubbleGeometry.dispose();
      flash.dispose();
      bubbleMaterial.dispose();
      discs.dispose();
      rings.dispose();
      bubbles.dispose();
    },
  };
}
