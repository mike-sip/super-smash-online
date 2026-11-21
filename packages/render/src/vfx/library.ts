/**
 * Bibliothèque d'effets (SPEC-visuals.md, phase 2) : quelles particules émettre, et quelles
 * secousses, gros plans et éclairs d'écran demander, pour chaque événement de la simulation et
 * chaque changement d'état d'un combattant. Logique pure : elle écrit dans des réserves de
 * particules et dans un objet `Cues` que le renderer applique ensuite.
 *
 * Le hasard est reproductible (graine = frame et emplacement) : un même combat donne les mêmes
 * effets. Rien n'est alloué par image.
 */
import {
  A_ATTACK,
  A_AIRDODGE,
  A_BRAKE,
  A_DASH,
  A_DEAD,
  A_HITSTUN,
  A_JUMPSQUAT,
  A_LEDGE,
  A_ROLL,
  A_RUN,
  A_SPOTDODGE,
  A_TECH,
  A_TUMBLE,
  A_TURN,
  EV_COUNTER,
  EV_GRAB,
  EV_HEAL,
  EV_HIT,
  EV_ITEM_BREAK,
  EV_KO,
  EV_LEDGE,
  EV_PARRY,
  EV_SHIELD,
  EV_SHIELD_BREAK,
  EV_ULTIMATE,
  M_DSPECIAL,
  M_EXTRA1,
  M_EXTRA2,
  M_NSPECIAL,
  M_SSPECIAL,
  M_ULTIMATE,
  M_USPECIAL,
  type FighterView,
} from '@game/sim-core';
import { PLAYER_COLORS } from '../fighters/visual.ts';
import {
  P_BURST,
  P_DOT,
  P_FLARE,
  P_PUFF,
  P_RING,
  P_SHARD,
  P_SPLAT,
  P_STREAK,
  P_TWINKLE,
  createSpec,
  emit,
  hash01,
  type ParticlePool,
  type ParticleSpec,
} from './particles.ts';

/** Demandes faites au renderer par les effets d'une frame. Remises à zéro par `clearCues`. */
export interface Cues {
  /** Secousse : amplitude en part de la hauteur de vue, durée en frames (0 = aucune). */
  shake: number;
  shakeLife: number;
  /** Gros plan : centre visé et durée en frames (0 = aucun). */
  closeX: number;
  closeY: number;
  closeLife: number;
  /** Éclair d'écran : couleur 0xRRGGBB et intensité de 0 à 1 (0 = aucun). */
  flashColor: number;
  flash: number;
  /** Assombrissement du décor (attaque ultime) : durée en frames (0 = aucun). */
  dimLife: number;
  /**
   * Coup final (SPEC-finition.md, phase 3) : vrai à la frame où part l'éjection qui doit finir le
   * match. Le match local en tire un ralenti d'affichage.
   */
  finale: boolean;
}

export function createCues(): Cues {
  return {
    shake: 0,
    shakeLife: 0,
    closeX: 0,
    closeY: 0,
    closeLife: 0,
    flashColor: 0xffffff,
    flash: 0,
    dimLife: 0,
    finale: false,
  };
}

export function clearCues(c: Cues): void {
  c.shake = 0;
  c.shakeLife = 0;
  c.closeLife = 0;
  c.flash = 0;
  c.dimLife = 0;
  c.finale = false;
}

function cueShake(c: Cues, amount: number, life: number): void {
  if (amount > c.shake) {
    c.shake = amount;
    c.shakeLife = life;
  }
}

function cueFlash(c: Cues, color: number, amount: number): void {
  if (amount > c.flash) {
    c.flash = amount;
    c.flashColor = color;
  }
}

/** Partie du plan de jeu visible à l'écran, pour ramener à l'écran l'effet d'un KO. */
export interface View {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Zones limites du stage. */
export interface Blast {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Freinage horizontal d'un combattant éjecté, en unités par frame² (sim-core, movement.ts). */
const KNOCKBACK_DECAY = 0.03;
/** Marge : une trajectoire qui atteint 90 % de la distance à la zone limite compte. */
const KO_REACH = 0.9;

/**
 * Vrai si un combattant qui part de (x, y) à la vitesse (vx, vy) atteindra probablement une zone
 * limite latérale ou haute. Estimation : freinage horizontal constant, gravité verticale.
 */
export function likelyKo(
  x: number,
  y: number,
  vx: number,
  vy: number,
  gravity: number,
  blast: Blast,
): boolean {
  const reachX = (vx * vx) / (2 * KNOCKBACK_DECAY);
  if (vx > 0 && reachX >= (blast.right - x) * KO_REACH) return true;
  if (vx < 0 && reachX >= (x - blast.left) * KO_REACH) return true;
  if (vy > 0 && gravity > 0 && (vy * vy) / (2 * gravity) >= (blast.top - y) * KO_REACH) return true;
  return false;
}

/** Ce que l'effet d'un combattant retient de sa frame précédente. */
interface Memory {
  readonly action: Int32Array;
  readonly grounded: Uint8Array;
  readonly jumps: Int32Array;
  readonly hitlag: Int32Array;
  readonly velY: Float32Array;
  readonly known: Uint8Array;
}

export interface Vfx {
  readonly cues: Cues;
  /** Zone visible à l'écran, tenue à jour par le renderer. */
  readonly view: View;
  /** Effets d'un événement de la frame `frame`. */
  event(type: number, a: number, b: number, views: readonly FighterView[], frame: number): void;
  /** Effets des changements d'état du joueur `i` depuis sa frame précédente. */
  fighter(i: number, view: FighterView, frame: number): void;
  /**
   * Traînée d'un projectile de la frame `frame` : position, vitesse, joueur qui l'a lancé (-1 :
   * aucun) et rayon.
   */
  projectile(
    x: number,
    y: number,
    vx: number,
    vy: number,
    owner: number,
    radius: number,
    frame: number,
  ): void;
  /** Oublie l'état précédent (saut dans le temps, rollback) : aucun effet au prochain appel. */
  forget(): void;
}

export interface VfxOptions {
  readonly glow: ParticlePool;
  readonly puff: ParticlePool;
  /** Taille de chaque combattant. */
  readonly heights: Float64Array;
  /** Gravité de chaque combattant, en unités par frame². */
  readonly gravities: Float64Array;
  readonly blast: Blast;
  /** Thème des effets propres à chaque joueur ('wind', 'feather', 'ember', 'pearl'), s'il en a. */
  readonly themes?: readonly (string | undefined)[];
  /** Vrai si l'éjection de ce joueur finirait le match (dernière vie du dernier duel). */
  readonly isFinal?: (player: number) => boolean;
}

// Couleurs en lumière (au-delà de 1, elles rayonnent).
const HOT: readonly [number, number, number] = [3.2, 2.3, 0.9];
const WHITE: readonly [number, number, number] = [2.2, 2.2, 2.2];
const SHIELD: readonly [number, number, number] = [0.9, 1.9, 2.8];
const BREAK: readonly [number, number, number] = [2.2, 1.0, 3.0];
const GOLD: readonly [number, number, number] = [3.0, 2.2, 0.6];
const GRAB: readonly [number, number, number] = [2.4, 1.1, 1.3];
const LEDGE: readonly [number, number, number] = [1.0, 2.4, 1.3];
const HEAL: readonly [number, number, number] = [0.8, 2.6, 1.2];
const DUST: readonly [number, number, number] = [0.86, 0.8, 0.72];
const SMOKE: readonly [number, number, number] = [0.72, 0.72, 0.76];

/** Profondeur des effets : juste devant les combattants. */
const FRONT_Z = 6;
/** Au-delà de ce temps de gel, un coup est fort (sur 4 à 20 frames). */
const STRONG_HITLAG = 10;
/** Vitesse d'éjection à partir de laquelle une traînée suit la victime. */
const TRAIL_SPEED = 1.6;
/** Écart minimal entre deux gros plans, en frames. */
const CLOSE_UP_GAP = 90;
const CLOSE_UP_LIFE = 26;
/** Gros plan du coup final : plus long. */
const FINALE_CLOSE_UP_LIFE = 46;
/** Encre des éclaboussures, par thème (en lumière, sombre et dense). */
const INK: readonly [number, number, number] = [0.25, 0.08, 0.06];
/** Durée de l'assombrissement du décor après le départ d'une attaque ultime, en frames. */
const DIM_LIFE = 80;

/** Couleur (en lumière) de chaque thème d'effets. */
const THEME_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
  wind: [1.5, 2.5, 2.7],
  feather: [2.7, 2.2, 1.4],
  ember: [3.6, 1.4, 0.3],
  pearl: [2.2, 2.4, 2.7],
};

/** Vrai pour un coup spécial, une attaque ultime ou leurs suites. */
export const isSpecialMove = (move: number): boolean =>
  move === M_NSPECIAL ||
  move === M_SSPECIAL ||
  move === M_USPECIAL ||
  move === M_DSPECIAL ||
  move === M_ULTIMATE ||
  move === M_EXTRA1 ||
  move === M_EXTRA2;

function rgbOf(hex: number, gain: number): [number, number, number] {
  return [
    (((hex >> 16) & 0xff) / 255) * gain,
    (((hex >> 8) & 0xff) / 255) * gain,
    ((hex & 0xff) / 255) * gain,
  ];
}

export function createVfx(options: VfxOptions): Vfx {
  const { glow, puff, heights, gravities, blast } = options;
  const players = heights.length;
  const cues = createCues();
  const view: View = { minX: -100, maxX: 100, minY: -60, maxY: 60 };
  const p: ParticleSpec = createSpec();
  const memory: Memory = {
    action: new Int32Array(players),
    grounded: new Uint8Array(players),
    jumps: new Int32Array(players),
    hitlag: new Int32Array(players),
    velY: new Float32Array(players),
    known: new Uint8Array(players),
  };
  const playerGlow = PLAYER_COLORS.map((c) => rgbOf(c, 2.6));
  let seed = 0;
  let lastCloseUp = -CLOSE_UP_GAP;

  const rand = (frame: number): number => hash01(frame, seed++);

  function reset(x: number, y: number, z: number): void {
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = 0;
    p.vy = 0;
    p.drag = 0;
    p.gravity = 0;
  }

  function paint(c: readonly [number, number, number], a: number): void {
    p.r = c[0];
    p.g = c[1];
    p.b = c[2];
    p.a = a;
  }

  function flare(
    x: number,
    y: number,
    size: number,
    life: number,
    c: readonly number[],
    f: number,
  ) {
    reset(x, y, FRONT_Z + 0.5);
    p.shape = P_FLARE;
    p.sizeStart = size;
    p.sizeEnd = size * 0.4;
    p.life = life;
    paint(c as [number, number, number], 1);
    emit(glow, p, f);
  }

  function ring(
    x: number,
    y: number,
    from: number,
    to: number,
    life: number,
    c: readonly number[],
    f: number,
  ) {
    reset(x, y, FRONT_Z);
    p.shape = P_RING;
    p.sizeStart = from;
    p.sizeEnd = to;
    p.life = life;
    paint(c as [number, number, number], 1);
    emit(glow, p, f);
  }

  /** Éclat à pointes (impact de bande dessinée). */
  function burst(
    x: number,
    y: number,
    size: number,
    life: number,
    c: readonly number[],
    f: number,
  ) {
    reset(x, y, FRONT_Z + 0.3);
    p.shape = P_BURST;
    p.sizeStart = size * 0.6;
    p.sizeEnd = size;
    p.life = life;
    // Plus grand que l'éclair et moins vif : ses pointes dépassent du halo blanc.
    paint(c as [number, number, number], 0.42);
    emit(glow, p, f);
  }

  /** Anneau brisé qui s'élargit en tournant. */
  function shards(
    x: number,
    y: number,
    size: number,
    life: number,
    c: readonly number[],
    f: number,
  ) {
    reset(x, y, FRONT_Z + 0.2);
    p.shape = P_SHARD;
    p.sizeStart = size * 0.4;
    p.sizeEnd = size * 1.3;
    p.life = life;
    paint(c as [number, number, number], 1);
    emit(glow, p, f);
  }

  /** Éclaboussures d'encre (couche opaque) projetées dans le sens du coup, à la couleur du thème. */
  function splats(
    x: number,
    y: number,
    count: number,
    angle: number,
    c: readonly number[],
    f: number,
  ): void {
    for (let n = 0; n < count; n++) {
      const a = angle + (rand(f) - 0.5) * 1.4;
      const v = 0.8 + rand(f) * 1.4;
      reset(x, y, FRONT_Z - 0.5);
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v;
      p.drag = 0.18;
      p.gravity = 0.01;
      p.shape = P_SPLAT;
      p.sizeStart = 1.2 + rand(f) * 1.6;
      p.sizeEnd = p.sizeStart * 1.25;
      p.life = 16 + rand(f) * 8;
      // Teinte du thème assombrie : l'encre se lit sur les décors clairs comme sombres.
      p.r = INK[0] + c[0]! * 0.18;
      p.g = INK[1] + c[1]! * 0.18;
      p.b = INK[2] + c[2]! * 0.18;
      p.a = 0.85;
      emit(puff, p, f);
    }
  }

  /** Gerbe de traits autour de `angle` (radians), d'ouverture `spread`. */
  function sparks(
    x: number,
    y: number,
    count: number,
    angle: number,
    spread: number,
    speed: number,
    size: number,
    life: number,
    gravity: number,
    c: readonly number[],
    f: number,
  ): void {
    for (let n = 0; n < count; n++) {
      const a = angle + (rand(f) - 0.5) * spread;
      const v = speed * (0.45 + 0.75 * rand(f));
      reset(x, y, FRONT_Z);
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v;
      p.drag = 0.14;
      p.gravity = gravity;
      p.shape = P_STREAK;
      p.sizeStart = size * (0.7 + 0.6 * rand(f));
      p.sizeEnd = 0;
      p.life = life * (0.7 + 0.6 * rand(f));
      paint(c as [number, number, number], 1);
      emit(glow, p, f);
    }
  }

  /** Bouffées de poussière ou de fumée. */
  function puffs(
    x: number,
    y: number,
    count: number,
    vx: number,
    vy: number,
    spreadX: number,
    size: number,
    life: number,
    c: readonly number[],
    alpha: number,
    f: number,
  ): void {
    for (let n = 0; n < count; n++) {
      reset(x + (rand(f) - 0.5) * spreadX, y, 1 + rand(f) * 3);
      p.vx = vx * (0.6 + 0.8 * rand(f));
      p.vy = vy * (0.6 + 0.8 * rand(f));
      p.drag = 0.12;
      p.gravity = -0.004;
      p.shape = P_PUFF;
      p.sizeStart = size * (0.5 + 0.4 * rand(f));
      p.sizeEnd = size * (1.4 + 0.6 * rand(f));
      p.life = life * (0.75 + 0.5 * rand(f));
      paint(c as [number, number, number], alpha);
      emit(puff, p, f);
    }
  }

  const themes = options.themes ?? [];
  const themeColor = (i: number): readonly [number, number, number] =>
    THEME_COLORS[themes[i] ?? ''] ?? playerGlow[(i < 0 ? 0 : i) % playerGlow.length]!;

  /** Une particule du thème : rafale, plume, braise ou bulle de nacre. */
  function motif(
    theme: string | undefined,
    color: readonly [number, number, number],
    x: number,
    y: number,
    vx: number,
    vy: number,
    scale: number,
    f: number,
  ): void {
    reset(x, y, FRONT_Z - 1);
    p.vx = vx;
    p.vy = vy;
    paint(color, 1);
    switch (theme) {
      case 'wind':
        p.shape = P_STREAK;
        p.drag = 0.08;
        p.sizeStart = 0.9 * scale;
        p.sizeEnd = 0.2 * scale;
        p.life = 12 + 6 * rand(f);
        break;
      case 'feather':
        // Une plume : trait court qui flotte et retombe en se balançant (hasard de vitesse).
        p.shape = P_STREAK;
        p.drag = 0.07;
        p.gravity = 0.008;
        p.vx += (rand(f) - 0.5) * 0.4;
        p.sizeStart = 0.75 * scale;
        p.sizeEnd = 0.5 * scale;
        p.life = 28 + 12 * rand(f);
        paint(color, 0.8);
        break;
      case 'ember':
        p.shape = P_DOT;
        p.drag = 0.04;
        p.gravity = -0.012;
        p.vx += (rand(f) - 0.5) * 0.15;
        p.sizeStart = 0.42 * scale;
        p.sizeEnd = 0.05 * scale;
        p.life = 26 + 16 * rand(f);
        break;
      case 'pearl':
        p.shape = P_RING;
        p.drag = 0.05;
        p.gravity = -0.009;
        p.sizeStart = 0.35 * scale;
        p.sizeEnd = 0.75 * scale;
        p.life = 30 + 14 * rand(f);
        paint(color, 0.7);
        break;
      default:
        p.shape = P_DOT;
        p.drag = 0.1;
        p.sizeStart = 0.5 * scale;
        p.sizeEnd = 0;
        p.life = 12;
    }
    emit(glow, p, f);
  }

  /** Effets propres au personnage : pendant ses spéciaux, et quelques touches au repos. */
  function themed(i: number, v: FighterView, f: number): void {
    const theme = themes[i];
    if (theme === undefined) return;
    const h = heights[i]!;
    const c = themeColor(i);
    const cx = v.x;
    const cy = v.y + h * 0.5;
    const tick = f + i * 7;
    if (v.action === A_ATTACK && isSpecialMove(v.move)) {
      // Spirale autour du corps, entraînée vers l'avant.
      for (let n = 0; n < 2; n++) {
        const a = rand(f) * Math.PI * 2;
        const r = h * (0.35 + 0.2 * rand(f));
        const tx = -Math.sin(a);
        const ty = Math.cos(a);
        motif(
          theme,
          c,
          cx + Math.cos(a) * r,
          cy + Math.sin(a) * r * 1.2,
          tx * 0.6 + v.facing * 0.25,
          ty * 0.6,
          1.1,
          f,
        );
      }
      return;
    }
    if (theme === 'ember' && tick % 3 === 0) {
      // Braises qui s'échappent des gantelets, devant lui à mi-hauteur.
      motif(
        theme,
        c,
        cx + v.facing * h * (0.2 + 0.1 * rand(f)),
        v.y + h * (0.35 + 0.1 * rand(f)),
        0,
        0.05,
        0.8,
        f,
      );
    } else if (theme === 'pearl' && tick % 24 === 0) {
      motif(
        theme,
        c,
        cx + (rand(f) - 0.5) * h * 0.5,
        v.y + h * (0.6 + 0.3 * rand(f)),
        0,
        0.04,
        0.8,
        f,
      );
    } else if (v.grounded && (v.action === A_RUN || v.action === A_DASH)) {
      if (theme === 'feather' && tick % 5 === 0) {
        motif(theme, c, cx - v.facing * h * 0.15, v.y + h * 0.15, -v.facing * 0.3, 0.12, 0.9, f);
      } else if (theme === 'wind' && tick % 6 === 0) {
        motif(
          theme,
          c,
          cx - v.facing * h * 0.2,
          v.y + h * (0.2 + 0.5 * rand(f)),
          -v.facing * 0.8,
          0,
          0.9,
          f,
        );
      }
    }
  }

  function hit(
    attacker: FighterView | undefined,
    a: number,
    victim: FighterView,
    b: number,
    f: number,
  ): void {
    const h = heights[b]!;
    const power = Math.min(1, Math.max(0, (victim.hitlag - 4) / 16));
    const side =
      attacker === undefined ? victim.facing * -1 : Math.sign(victim.x - attacker.x) || 1;
    const x = victim.x - side * h * 0.15;
    const y = victim.y + h * 0.55;
    const away = side > 0 ? 0.3 : Math.PI - 0.3;
    // Éclat à pointes, de bande dessinée, derrière le flash : sa taille dit la force du coup.
    burst(x, y, 8 + power * 13, 7 + power * 5, HOT, f);
    flare(x, y, 5 + power * 9, 7 + power * 4, HOT, f);
    flare(x, y, 2.5 + power * 3, 5, WHITE, f);
    ring(x, y, 1.5, 8 + power * 14, 11 + power * 6, WHITE, f);
    sparks(
      x,
      y,
      6 + Math.round(power * 12),
      away,
      1.7,
      1.6 + power * 2.4,
      0.9,
      12 + power * 6,
      0.02,
      HOT,
      f,
    );
    if (power > 0.4) {
      // Coup fort : traits rayonnants, anneau qui se brise en éclats, encre projetée.
      sparks(x, y, 10, 0, Math.PI * 2, 2.6 + power * 2, 1.4, 9, 0, WHITE, f);
      shards(x, y, 6 + power * 10, 14, WHITE, f);
      const color = attacker === undefined ? HOT : themeColor(a);
      splats(x, y, 2 + Math.round(power * 3), away, color, f);
    }
    if (victim.hitlag >= STRONG_HITLAG) cueShake(cues, 0.004 + power * 0.016, 8 + power * 12);
  }

  function launched(i: number, v: FighterView, f: number): void {
    const speed = Math.hypot(v.velX, v.velY);
    if (speed < TRAIL_SPEED) return;
    if (!likelyKo(v.x, v.y, v.velX, v.velY, gravities[i]!, blast)) return;
    const y = v.y + heights[i]! * 0.5;
    // Coup décisif : éclat, lignes de vitesse, gros plan, éclair à la couleur du joueur.
    flare(v.x, y, 18, 12, playerGlow[i % playerGlow.length]!, f);
    sparks(v.x, y, 16, Math.atan2(v.velY, v.velX), 0.5, 4.5, 2.2, 14, 0, WHITE, f);
    cueShake(cues, 0.02, 18);
    cueFlash(cues, PLAYER_COLORS[i % PLAYER_COLORS.length]!, 0.22);
    const final = options.isFinal?.(i) === true;
    if (final || f - lastCloseUp >= CLOSE_UP_GAP) {
      lastCloseUp = f;
      cues.closeX = v.x;
      cues.closeY = y;
      cues.closeLife = final ? FINALE_CLOSE_UP_LIFE : CLOSE_UP_LIFE;
    }
    if (final) {
      // Coup final : éclat plus grand, anneau brisé, éclair blanc ; le match local ralentit.
      burst(v.x, y, 26, 18, WHITE, f);
      shards(v.x, y, 30, 22, playerGlow[i % playerGlow.length]!, f);
      cueFlash(cues, 0xffffff, 0.4);
      cues.finale = true;
    }
  }

  /** Étoile lointaine, en haut de l'écran, à la couleur du joueur, avec un éclat blanc. */
  function twinkle(i: number, x: number, f: number): void {
    const height = view.maxY - view.minY;
    const sx = Math.min(view.maxX - height * 0.1, Math.max(view.minX + height * 0.1, x));
    const sy = view.maxY - height * 0.12;
    reset(sx, sy, FRONT_Z);
    p.shape = P_TWINKLE;
    p.sizeStart = height * 0.07;
    p.sizeEnd = height * 0.02;
    p.life = 46;
    paint(playerGlow[i % playerGlow.length]!, 1.4);
    emit(glow, p, f);
    flare(sx, sy, height * 0.05, 14, WHITE, f);
    ring(sx, sy, height * 0.01, height * 0.08, 18, WHITE, f);
  }

  function trail(i: number, v: FighterView, f: number): void {
    const speed = Math.hypot(v.velX, v.velY);
    if (speed < TRAIL_SPEED) return;
    const y = v.y + heights[i]! * 0.5;
    // Fumée dense, et des braises pour les éjections violentes.
    puffs(v.x, y, 2, -v.velX * 0.05, -v.velY * 0.05, 1.5, 3 + speed * 0.7, 30, SMOKE, 0.55, f);
    if (speed > 2.2) {
      reset(v.x, y, FRONT_Z - 1);
      p.vx = -v.velX * 0.1 + (rand(f) - 0.5) * 0.6;
      p.vy = -v.velY * 0.1 + (rand(f) - 0.5) * 0.6;
      p.drag = 0.08;
      p.gravity = 0.006;
      p.shape = P_DOT;
      p.sizeStart = 0.7;
      p.sizeEnd = 0.1;
      p.life = 18 + rand(f) * 10;
      paint(HOT, 1);
      emit(glow, p, f);
    }
    if (speed > 2.6) {
      reset(v.x, y, FRONT_Z - 2);
      p.vx = v.velX * 0.25;
      p.vy = v.velY * 0.25;
      p.drag = 0.2;
      p.shape = P_STREAK;
      p.sizeStart = 1.6;
      p.sizeEnd = 0.4;
      p.life = 10;
      paint(playerGlow[i % playerGlow.length]!, 0.6);
      emit(glow, p, f);
    }
  }

  return {
    cues,
    view,
    event(type, a, b, views, f) {
      switch (type) {
        case EV_HIT: {
          const victim = views[b];
          if (victim !== undefined) hit(views[a], a, victim, b, f);
          return;
        }
        case EV_SHIELD: {
          const d = views[b];
          if (d === undefined) return;
          const side = views[a] === undefined ? 0 : Math.sign(d.x - views[a]!.x);
          const x = d.x - side * heights[b]! * 0.3;
          const y = d.y + heights[b]! * 0.5;
          ring(x, y, 2, 9, 12, SHIELD, f);
          // Le bouclier encaisse : un anneau d'éclats bleutés à l'impact.
          shards(x, y, 7, 10, SHIELD, f);
          sparks(x, y, 6, side >= 0 ? Math.PI : 0, 1.6, 1.4, 0.7, 10, 0.02, SHIELD, f);
          return;
        }
        case EV_PARRY:
        case EV_COUNTER: {
          const d = views[b];
          if (d === undefined) return;
          const y = d.y + heights[b]! * 0.55;
          const c = type === EV_PARRY ? WHITE : GOLD;
          flare(d.x, y, 16, 12, c, f);
          ring(d.x, y, 4, 22, 18, c, f);
          sparks(d.x, y, 12, 0, Math.PI * 2, 2.4, 1.1, 12, 0, c, f);
          cueShake(cues, 0.006, 10);
          cueFlash(cues, type === EV_PARRY ? 0xffffff : 0xffd166, 0.12);
          return;
        }
        case EV_SHIELD_BREAK: {
          const d = views[a];
          if (d === undefined) return;
          const y = d.y + heights[a]! * 0.55;
          burst(d.x, y, 16, 14, BREAK, f);
          flare(d.x, y, 14, 14, BREAK, f);
          ring(d.x, y, 6, 30, 24, BREAK, f);
          shards(d.x, y, 28, 26, BREAK, f);
          sparks(d.x, y, 22, Math.PI / 2, Math.PI * 2, 2.2, 1.3, 30, 0.06, BREAK, f);
          cueShake(cues, 0.02, 20);
          cueFlash(cues, 0xc084fc, 0.18);
          return;
        }
        case EV_KO: {
          const d = views[a];
          if (d === undefined) return;
          if (d.y > view.maxY && d.x > view.minX && d.x < view.maxX) {
            // KO par le haut : le combattant devient une étoile qui scintille au fond du ciel.
            twinkle(a, d.x, f);
            cueShake(cues, 0.01, 12);
            return;
          }
          // Le KO a lieu hors de l'écran : l'explosion part du bord, vers l'intérieur.
          const inset = (view.maxY - view.minY) * 0.04;
          const x = Math.min(view.maxX - inset, Math.max(view.minX + inset, d.x));
          const y = Math.min(view.maxY - inset, Math.max(view.minY + inset, d.y));
          const inward = Math.atan2(
            (view.minY + view.maxY) / 2 - y,
            (view.minX + view.maxX) / 2 - x,
          );
          const c = playerGlow[a % playerGlow.length]!;
          const scale = (view.maxY - view.minY) / 120;
          flare(x, y, 40 * scale, 24, c, f);
          flare(x, y, 18 * scale, 16, WHITE, f);
          ring(x, y, 8 * scale, 70 * scale, 34, c, f);
          sparks(x, y, 34, inward, 1.3, 6 * scale, 4 * scale, 28, 0, c, f);
          sparks(x, y, 16, inward, 0.7, 8 * scale, 5 * scale, 20, 0, WHITE, f);
          puffs(
            x,
            y,
            10,
            Math.cos(inward) * 1.4 * scale,
            Math.sin(inward) * 1.4 * scale,
            8 * scale,
            12 * scale,
            50,
            SMOKE,
            0.55,
            f,
          );
          cueShake(cues, 0.035, 32);
          cueFlash(cues, PLAYER_COLORS[a % PLAYER_COLORS.length]!, 0.32);
          return;
        }
        case EV_GRAB: {
          const d = views[b];
          if (d !== undefined) ring(d.x, d.y + heights[b]! * 0.6, 1, 6, 9, GRAB, f);
          return;
        }
        case EV_LEDGE: {
          const d = views[a];
          if (d === undefined) return;
          flare(d.x, d.y + heights[a]!, 4, 9, LEDGE, f);
          ring(d.x, d.y + heights[a]!, 1, 6, 10, LEDGE, f);
          return;
        }
        case EV_ULTIMATE: {
          const d = views[a];
          if (d === undefined) return;
          const y = d.y + heights[a]! * 0.5;
          const c = themes[a] === undefined ? GOLD : themeColor(a);
          flare(d.x, y, 30, 22, c, f);
          ring(d.x, y, 6, 50, 30, c, f);
          ring(d.x, y, 3, 34, 22, WHITE, f);
          sparks(d.x, y, 28, Math.PI / 2, Math.PI * 2, 3.5, 2, 24, 0, c, f);
          for (let n = 0; n < 24; n++) {
            const ang = (n / 24) * Math.PI * 2;
            motif(themes[a], c, d.x, y, Math.cos(ang) * 1.6, Math.sin(ang) * 1.6, 1.6, f);
          }
          cueShake(cues, 0.015, 24);
          cueFlash(cues, 0xffd166, 0.25);
          cues.dimLife = DIM_LIFE;
          return;
        }
        case EV_HEAL: {
          const d = views[a];
          if (d === undefined) return;
          ring(d.x, d.y + heights[a]! * 0.5, 2, 14, 20, HEAL, f);
          // Quelques scintillements montent avec les points de soin.
          for (let n = 0; n < 4; n++) {
            reset(d.x + (rand(f) - 0.5) * 8, d.y + rand(f) * heights[a]!, FRONT_Z + 0.2);
            p.vy = 0.3 + rand(f) * 0.2;
            p.drag = 0.05;
            p.shape = P_TWINKLE;
            p.sizeStart = 2.2;
            p.sizeEnd = 0.4;
            p.life = 26 + rand(f) * 10;
            paint(HEAL, 1.2);
            emit(glow, p, f);
          }
          for (let n = 0; n < 14; n++) {
            reset(d.x + (rand(f) - 0.5) * 8, d.y + rand(f) * heights[a]!, FRONT_Z);
            p.vy = 0.25 + rand(f) * 0.35;
            p.drag = 0.04;
            p.shape = P_DOT;
            p.sizeStart = 0.9;
            p.sizeEnd = 0.2;
            p.life = 30 + rand(f) * 20;
            paint(HEAL, 1);
            emit(glow, p, f);
          }
          return;
        }
        case EV_ITEM_BREAK:
          // Position inconnue ici (emplacement déjà libéré) : l'objet gère son propre éclat.
          return;
        default:
      }
    },
    fighter(i, v, f) {
      if (memory.known[i] === 0) {
        memory.known[i] = 1;
      } else {
        const before = memory.action[i]!;
        const wasGrounded = memory.grounded[i] === 1;
        const h = heights[i]!;
        const action = v.action;
        const changed = action !== before;
        if (action !== A_DEAD) {
          // Atterrissage : poussière des deux côtés, plus forte si la chute était rapide.
          if (v.grounded && !wasGrounded && before !== A_LEDGE && before !== A_DEAD) {
            const fall = Math.min(4, Math.max(0, -memory.velY[i]!));
            const n = 2 + Math.round(fall * 1.5);
            puffs(
              v.x - 1.5,
              v.y,
              n,
              -0.5 - fall * 0.25,
              0.08,
              2,
              2.4 + fall * 0.5,
              22,
              DUST,
              0.5,
              f,
            );
            puffs(
              v.x + 1.5,
              v.y,
              n,
              0.5 + fall * 0.25,
              0.08,
              2,
              2.4 + fall * 0.5,
              22,
              DUST,
              0.5,
              f,
            );
          }
          if (changed && v.grounded) {
            if (action === A_DASH || action === A_BRAKE) {
              const back = action === A_DASH ? -v.facing : v.facing;
              puffs(v.x + back * 1.5, v.y, 3, back * 0.7, 0.12, 1.5, 2.2, 20, DUST, 0.45, f);
            } else if (action === A_TURN || action === A_ROLL || action === A_SPOTDODGE) {
              puffs(v.x, v.y, 2, 0, 0.1, 4, 2.2, 18, DUST, 0.4, f);
            } else if (action === A_TECH) {
              flare(v.x, v.y + h * 0.4, 6, 8, WHITE, f);
            }
          }
          // Saut depuis le sol.
          if (!v.grounded && wasGrounded && before === A_JUMPSQUAT) {
            puffs(v.x, v.y, 2, 0, 0.05, 3, 2, 16, DUST, 0.4, f);
          }
          // Saut en l'air : un anneau d'air sous les pieds.
          if (!v.grounded && !wasGrounded && v.jumpsLeft < memory.jumps[i]!) {
            ring(v.x, v.y, 1.5, 6, 12, WHITE, f);
            puffs(v.x, v.y, 2, 0, -0.2, 3, 1.6, 14, SMOKE, 0.3, f);
          }
          if (changed && action === A_AIRDODGE) flare(v.x, v.y + h * 0.5, 5, 7, WHITE, f);
          themed(i, v, f);
          const stunned = action === A_HITSTUN || action === A_TUMBLE;
          if (stunned && v.hitlag === 0) {
            if (memory.hitlag[i]! > 0) launched(i, v, f);
            trail(i, v, f);
          }
        }
      }
      memory.action[i] = v.action;
      memory.grounded[i] = v.grounded ? 1 : 0;
      memory.jumps[i] = v.jumpsLeft;
      memory.hitlag[i] = v.hitlag;
      memory.velY[i] = v.velY;
    },
    projectile(x, y, vx, vy, owner, radius, f) {
      const theme = owner >= 0 ? themes[owner] : undefined;
      const c = owner >= 0 ? themeColor(owner) : WHITE;
      motif(
        theme,
        c,
        x - vx * 0.5,
        y - vy * 0.5,
        -vx * 0.15,
        -vy * 0.15,
        Math.max(0.8, radius * 0.6),
        f,
      );
    },
    forget() {
      memory.known.fill(0);
    },
  };
}
