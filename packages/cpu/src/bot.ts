/**
 * Adversaire ordinateur (SPEC-finition.md, phase 6). Il ne fait que produire un `InputFrame` par
 * frame, comme une manette : il lit l'état de la simulation (en lecture seule) et décide.
 *
 * Perception : il voit ses adversaires avec un retard (le temps de réaction de son niveau), dans
 * une mémoire tournante. Décisions, par ordre de priorité : se remettre d'une éjection (influence,
 * récupération au sol), revenir sur le stage, quitter le rebord, projeter un adversaire saisi, se
 * protéger, punir, finir avec l'attaque ultime, garder le bord, puis le jeu neutre (s'approcher,
 * garder sa distance, choisir le coup qui touche d'après ses données).
 *
 * Déterministe : son hasard est à graine. Même graine et mêmes états, mêmes inputs.
 */
import {
  A_AIR,
  A_ATTACK,
  A_DEAD,
  A_DOWN,
  A_GRABBED,
  A_GRABBING,
  A_HELPLESS,
  A_HITSTUN,
  A_LAND,
  A_LEDGE,
  A_SHIELD,
  A_SHIELD_BREAK,
  A_TUMBLE,
  BTN_ATTACK,
  BTN_CSTICK_DOWN,
  BTN_CSTICK_LEFT,
  BTN_CSTICK_RIGHT,
  BTN_CSTICK_UP,
  BTN_GRAB,
  BTN_JUMP,
  BTN_SHIELD,
  BTN_SPECIAL,
  M_BAIR,
  M_DAIR,
  M_DSMASH,
  M_DSPECIAL,
  M_DTILT,
  M_FAIR,
  M_FSMASH,
  M_FTILT,
  M_NAIR,
  M_NSPECIAL,
  M_SSPECIAL,
  M_UAIR,
  M_USMASH,
  M_UTILT,
  createFighterView,
  encodeInput,
  frame,
  fxToFloat,
  readFighter,
  type FighterView,
  type InputFrame,
  type Sim,
} from '@game/sim-core';
import { levelParams, profileOf, type LevelParams, type Profile } from './levels.ts';
import {
  analyzeMoves,
  analyzeUltimate,
  hasRecovery,
  recoveryRise,
  type MoveInfo,
} from './moves.ts';

export interface BotOptions {
  /** Niveau, de 1 à 9. */
  readonly level: number;
  /** Identifiant du personnage (profil de jeu) ; profil par défaut s'il est inconnu. */
  readonly fighter?: string;
  /** Graine du hasard du bot. */
  readonly seed?: number;
}

export interface Bot {
  readonly player: number;
  readonly level: LevelParams;
  /** Input du bot pour la frame qui va être simulée. N'alloue rien. */
  next(sim: Sim): InputFrame;
}

/** Taille de la mémoire de perception (au-delà du plus long temps de réaction). */
const MEMORY = 64;
const TILT = 64;
const FULL = 127;

/** Générateur reproductible (mulberry32). */
function createRandom(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Géométrie utile du stage : bords du bloc principal (rebords), hauteur du sol, zones limites. */
interface Arena {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly blastTop: number;
  readonly blastBottom: number;
}

function arenaOf(sim: Sim): Arena {
  const stage = sim.config.stage;
  // Le bloc le plus large est le sol principal ; ses bords sont les rebords.
  let best = stage.solids[0]!;
  for (const s of stage.solids) {
    if (fxToFloat(s.x2) - fxToFloat(s.x1) > fxToFloat(best.x2) - fxToFloat(best.x1)) best = s;
  }
  return {
    left: fxToFloat(best.x1),
    right: fxToFloat(best.x2),
    top: fxToFloat(best.y2),
    blastTop: fxToFloat(stage.blast.top),
    blastBottom: fxToFloat(stage.blast.bottom),
  };
}

/** Ce que le bot retient d'un adversaire à une frame. */
interface Seen {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly velX: Float32Array;
  readonly velY: Float32Array;
  readonly action: Int16Array;
  readonly actionFrame: Int16Array;
  readonly move: Int16Array;
  readonly facing: Int8Array;
  readonly damage: Float32Array;
}

function createSeen(): Seen {
  return {
    x: new Float32Array(MEMORY),
    y: new Float32Array(MEMORY),
    velX: new Float32Array(MEMORY),
    velY: new Float32Array(MEMORY),
    action: new Int16Array(MEMORY),
    actionFrame: new Int16Array(MEMORY),
    move: new Int16Array(MEMORY),
    facing: new Int8Array(MEMORY),
    damage: new Float32Array(MEMORY),
  };
}

export function createBot(sim: Sim, player: number, options: BotOptions): Bot {
  const level = levelParams(options.level);
  const profile: Profile = profileOf(options.fighter ?? '');
  const random = createRandom(options.seed ?? 0x9e3779b9 + player * 7919);
  const def = sim.config.fighters[player]!;
  const moves = analyzeMoves(def);
  const ultimate = analyzeUltimate(def);
  const recovery = hasRecovery(def);
  const rise = recoveryRise(def);
  /** Garder le bord demande une remontée qui ramène de loin. */
  const canEdgeGuard = rise >= 30 || def.airJumps >= 2;
  const height = fxToFloat(def.height);
  const arena = arenaOf(sim);
  const players = sim.config.fighters.length;
  const self = createFighterView();
  const other = createFighterView();
  const seen: Seen[] = Array.from({ length: players }, createSeen);
  const opponentMoves = sim.config.fighters.map((d) => analyzeMoves(d));

  let prevButtons = 0;
  /** Plan en cours : jusqu'à quand le tenir. */
  let holdUntil = -1;
  let heldInput: InputFrame = 0;
  let nextThink = 0;
  /** Prochaine frame où le bot peut lancer une attaque de jeu neutre (cadence de son niveau). */
  let nextAttack = 0;
  let ledgeWait = -1;
  let wantJumpAt = -1;
  let pendingAerial = -1;

  /** Sortie de la frame : les boutons ne comptent qu'à l'appui, on relâche donc entre deux. */
  function out(stickX: number, stickY: number, buttons: number): InputFrame {
    const pressNow = buttons & ~BTN_SHIELD;
    // Un bouton (hors bouclier, qui se tient) déjà enfoncé est relâché une frame pour être rappuyé.
    const again = pressNow & prevButtons;
    const sent = again !== 0 ? buttons & ~again : buttons;
    prevButtons = sent;
    return encodeInput(stickX, stickY, sent);
  }

  /** Mémorise l'état des adversaires à cette frame. */
  function remember(sim: Sim, now: number): void {
    const k = now % MEMORY;
    for (let p = 0; p < players; p++) {
      if (p === player) continue;
      readFighter(sim, p, other);
      const s = seen[p]!;
      s.x[k] = other.x;
      s.y[k] = other.y;
      s.velX[k] = other.velX;
      s.velY[k] = other.velY;
      s.action[k] = other.action;
      s.actionFrame[k] = other.actionFrame;
      s.move[k] = other.move;
      s.facing[k] = other.facing;
      s.damage[k] = other.damage;
    }
  }

  /** Index mémoire de ce que le bot perçoit maintenant (avec son retard). */
  const perceived = (now: number): number => Math.max(0, now - level.reaction) % MEMORY;

  /** Adversaire perçu le plus proche, vivant ; -1 s'il n'y en a pas. */
  function target(now: number): number {
    const k = perceived(now);
    let best = -1;
    let dist = Infinity;
    for (let p = 0; p < players; p++) {
      if (p === player) continue;
      const s = seen[p]!;
      if (s.action[k] === A_DEAD) continue;
      const d = Math.abs(s.x[k]! - self.x) + Math.abs(s.y[k]! - self.y) * 0.7;
      if (d < dist) {
        dist = d;
        best = p;
      }
    }
    return best;
  }

  const offstage = (v: FighterView): boolean =>
    v.x < arena.left - 1 || v.x > arena.right + 1 || v.y < arena.top - 4;

  /** Vrai si l'élan propre du coup `m`, lancé vers `dir`, laisse le bot sur le stage. */
  function staysOn(m: MoveInfo, dir: number): boolean {
    if (m.travel === 0) return true;
    const landing = self.x + dir * m.travel;
    return landing > arena.left + 4 && landing < arena.right - 4;
  }

  /** Sens absolu de la cible, d'après sa position relative `dx` (dans le repère du bot). */
  const dirOf = (dx: number): number => (dx >= 0 ? self.facing : -self.facing);

  /** Le coup `m` touche-t-il une cible à (dx, dy) relatifs, une fois lancé ? */
  function reaches(m: MoveInfo, dx: number, dy: number): boolean {
    const halfWidth = 3;
    return (
      dx + halfWidth >= m.minX &&
      dx - halfWidth <= m.maxX &&
      dy + height * 0.95 >= m.minY &&
      dy <= m.maxY
    );
  }

  /** Meilleur coup qui toucherait la cible, ou -1 ; parfois un coup au hasard (précision). */
  function pickMove(
    kinds: 'ground' | 'air',
    dx: number,
    dy: number,
    targetDamage: number,
  ): MoveInfo | null {
    let best: MoveInfo | null = null;
    let score = -Infinity;
    const candidates: MoveInfo[] = [];
    for (const m of moves) {
      if (m.kind !== kinds && m.kind !== 'special') continue;
      if (m.slot === M_DSPECIAL) continue;
      // Ultime prête : le spécial neutre deviendrait l'ultime ; elle a sa propre décision.
      if (m.slot === M_NSPECIAL && self.ultimateReady) continue;
      // Un coup qui emporte le bot hors du stage est écarté.
      if (!staysOn(m, m.slot === M_SSPECIAL ? dirOf(dx) : self.facing)) continue;
      if (!reaches(m, dx, dy)) continue;
      candidates.push(m);
      // Finir quand l'adversaire est haut en dégâts ; sinon des coups rapides.
      const killing = targetDamage >= profile.killAt;
      let s = m.damage * 0.6 - m.startup * 0.5;
      if (killing) s += m.power * 0.05 + (m.smash ? 6 : 0);
      else if (m.smash) s -= 6;
      if (m.projectile) s += profile.zoning * 4;
      if (s > score) {
        score = s;
        best = m;
      }
    }
    if (candidates.length > 1 && random() > level.accuracy) {
      return candidates[Math.floor(random() * candidates.length)]!;
    }
    return best;
  }

  /** Input qui lance le coup `slot`, tourné vers `dir` (−1 gauche, 1 droite). */
  function moveInput(slot: number, dir: number, facing: number): [number, number, number] {
    const cside = dir < 0 ? BTN_CSTICK_LEFT : BTN_CSTICK_RIGHT;
    switch (slot) {
      case M_FTILT:
        return [dir * TILT, 0, BTN_ATTACK];
      case M_UTILT:
        return [0, TILT, BTN_ATTACK];
      case M_DTILT:
        return [0, -TILT, BTN_ATTACK];
      case M_FSMASH:
        return [0, 0, cside];
      case M_USMASH:
        return [0, 0, BTN_CSTICK_UP];
      case M_DSMASH:
        return [0, 0, BTN_CSTICK_DOWN];
      case M_FAIR:
        return [0, 0, facing < 0 ? BTN_CSTICK_LEFT : BTN_CSTICK_RIGHT];
      case M_BAIR:
        return [0, 0, facing < 0 ? BTN_CSTICK_RIGHT : BTN_CSTICK_LEFT];
      case M_UAIR:
        return [0, 0, BTN_CSTICK_UP];
      case M_DAIR:
        return [0, 0, BTN_CSTICK_DOWN];
      case M_NSPECIAL:
        return [0, 0, BTN_SPECIAL];
      case M_SSPECIAL:
        return [dir * FULL, 0, BTN_SPECIAL];
      case M_NAIR:
      default:
        return [0, 0, BTN_ATTACK];
    }
  }

  /** Retour sur le stage : cap sur le bord, sauts, puis remontée. */
  function recover(): InputFrame {
    const toward = self.x < (arena.left + arena.right) / 2 ? 1 : -1;
    const edge = toward > 0 ? arena.left : arena.right;
    const below = self.y < arena.top;
    // Sous le niveau du sol, viser juste à l'extérieur du rebord : passer sous le stage, c'est se
    // cogner dessous et tomber. Au-dessus, viser l'intérieur.
    const aim = below ? edge - toward * 4 : edge + toward * 8;
    const gap = aim - self.x;
    const steer = Math.abs(gap) < 2 ? 0 : gap > 0 ? FULL : -FULL;
    const far = Math.abs(self.x - edge);
    if (self.action === A_HELPLESS) return out(steer, 0, 0);
    // Sauts : en retombant près du niveau du sol (pas une fois loin dessous), ou si on est loin.
    if (self.jumpsLeft > 0 && self.velY <= 0.2 && (self.y < arena.top + 6 || far > 30)) {
      return out(steer, 0, BTN_JUMP);
    }
    // Plus de saut : la remontée, tant que le rebord est à sa portée (montée propre au
    // personnage), ou si on est loin ; orientée vers le rebord.
    const depth = arena.top - self.y;
    if (
      recovery &&
      self.jumpsLeft === 0 &&
      self.velY < 0 &&
      (depth > -4 && depth < rise + 4 ? true : far > 25 && depth > -20)
    ) {
      return out(Math.sign(gap) * 60, FULL, BTN_SPECIAL);
    }
    return out(steer, 0, 0);
  }

  function decide(sim: Sim, now: number): InputFrame {
    readFighter(sim, player, self);
    remember(sim, now);
    const a = self.action;
    if (a === A_DEAD || a === A_GRABBED) return out(0, 0, 0);

    // En culbute hors du stage, on peut de nouveau agir : revenir avant tout.
    if (a === A_TUMBLE && self.hitlag === 0 && offstage(self)) return recover();
    // Éjecté : influence vers le centre et vers le haut ; récupération au sol à l'atterrissage.
    if (a === A_HITSTUN || a === A_TUMBLE || self.hitlag > 0) {
      const center = self.x < (arena.left + arena.right) / 2 ? 1 : -1;
      const nearGround =
        a === A_TUMBLE && self.velY < 0 && self.y - arena.top < 10 && !offstage(self);
      const tech = nearGround && random() < level.tech;
      // Influence : vers le centre et le haut, plus ou moins bien selon le niveau.
      const di = random() < level.di;
      return out(di ? center * 90 : 0, di ? 90 : 0, tech ? BTN_SHIELD : 0);
    }

    // Au rebord : on attend un peu, puis on remonte (saut, remontée simple ou attaque).
    if (a === A_LEDGE) {
      if (ledgeWait < 0) ledgeWait = now + 4 + Math.floor(random() * (36 - level.level * 3));
      if (now < ledgeWait) return out(0, 0, 0);
      ledgeWait = -1;
      const toward = self.x < (arena.left + arena.right) / 2 ? 1 : -1;
      const r = random();
      if (r < 0.45) return out(0, 0, BTN_JUMP);
      if (r < 0.8) return out(toward * FULL, 0, 0);
      return out(0, 0, BTN_ATTACK);
    }
    ledgeWait = -1;

    // Hors du stage : revenir avant tout.
    if (!self.grounded && offstage(self)) return recover();

    // Saisie en cours : projeter vers le bord le plus proche (ou vers le haut si l'adversaire est
    // déjà bien entamé et qu'on est au centre).
    if (a === A_GRABBING) {
      const nearRight = arena.right - self.x < self.x - arena.left;
      return out(nearRight ? FULL : -FULL, 0, 0);
    }

    // Occupé (attaque, atterrissage) : on ne touche à rien, sauf l'aérien prévu après un saut.
    if (a === A_ATTACK || a === A_LAND || a === A_SHIELD_BREAK || a === A_DOWN) {
      return out(0, 0, a === A_DOWN && random() < 0.1 ? BTN_JUMP : 0);
    }
    if (pendingAerial >= 0 && a === A_AIR) {
      const slot = pendingAerial;
      pendingAerial = -1;
      const [sx, sy, b] = moveInput(slot, self.facing, self.facing);
      return out(sx, sy, b);
    }

    const t = target(now);
    if (t < 0) return out(0, 0, 0);
    const k = perceived(now);
    const tv = seen[t]!;
    const tx = tv.x[k]!;
    const ty = tv.y[k]!;
    const tAction = tv.action[k]!;
    const tFrame = tv.actionFrame[k]!;
    const tDamage = tv.damage[k]!;
    const dirTo = tx >= self.x ? 1 : -1;
    const dist = Math.abs(tx - self.x);
    // Position de la cible dans le repère du bot (vers l'avant si elle est devant lui).
    const dx = (tx - self.x) * self.facing;
    const dy = ty - self.y;

    // Défense : l'adversaire attaque et va bientôt toucher, à portée.
    if (tAction === A_ATTACK && self.grounded) {
      const threat = opponentMoves[t]!.find((m) => m.slot === tv.move[k]);
      const facingUs = tv.facing[k] === (self.x >= tx ? 1 : -1);
      if (
        threat !== undefined &&
        facingUs &&
        tFrame < threat.activeEnd &&
        dist <= threat.maxX + 6 &&
        random() < level.defense
      ) {
        holdUntil = now + Math.max(4, threat.activeEnd - tFrame);
        heldInput = encodeInput(0, 0, BTN_SHIELD);
        return out(0, 0, BTN_SHIELD);
      }
    }
    if (now < holdUntil) {
      prevButtons = heldInput >>> 16;
      return heldInput;
    }

    // Adversaire au bouclier, collé : saisie.
    if (self.grounded && tAction === A_SHIELD && dist < 10 && random() < level.punish) {
      return out(0, 0, BTN_GRAB);
    }

    // Punition : adversaire vulnérable (fin de coup, atterrissage, bouclier brisé, au sol).
    const vulnerable =
      tAction === A_SHIELD_BREAK ||
      tAction === A_DOWN ||
      tAction === A_LAND ||
      (tAction === A_ATTACK && tFrame > 14);
    if (vulnerable && self.grounded && random() < level.punish) {
      const m = pickMove('ground', dx, dy, tDamage);
      if (m !== null) {
        const [sx, sy, b] = moveInput(m.slot, dirTo, self.facing);
        return out(sx, sy, b);
      }
    }

    // Attaque ultime prête : la lancer quand elle toucherait, d'autant plus sûrement que le niveau
    // est haut (les bas niveaux la gâchent souvent).
    if (
      self.ultimateReady &&
      ultimate !== null &&
      self.facing === dirTo &&
      reaches(ultimate, dx, dy) &&
      staysOn(ultimate, dirTo)
    ) {
      if (random() < level.accuracy) return out(0, 0, BTN_SPECIAL);
    }

    // Garde du bord : l'adversaire revient de loin, on l'attend au bord et on saute le frapper.
    const targetOff = tx < arena.left - 2 || tx > arena.right + 2 || ty < arena.top - 6;
    if (level.edgeGuard && canEdgeGuard && targetOff && self.grounded) {
      const edge = tx < arena.left ? arena.left + 6 : arena.right - 6;
      // On marche jusqu'au bord (courir emporterait au-delà), puis on s'arrête.
      if (Math.abs(self.x - edge) > 3) return out(edge > self.x ? 70 : -70, 0, 0);
      const slot = dy < -6 ? M_DAIR : self.facing === dirTo ? M_FAIR : M_BAIR;
      const aerial = moves.find((m) => m.slot === slot);
      // Seulement un aérien rapide, et avec ses sauts intacts pour revenir.
      const quick = aerial !== undefined && aerial.total <= 32;
      if (quick && dist < 22 && Math.abs(dy) < 26 && self.jumpsLeft >= def.airJumps) {
        pendingAerial = slot;
        return out(dirTo * 30, 0, BTN_JUMP);
      }
      return out(0, 0, 0);
    }

    // Jeu neutre : attaquer si un coup touche, sinon se placer. Les bas niveaux attaquent
    // rarement ; les hauts niveaux enchaînent.
    if (now >= nextAttack && random() < level.aggression) {
      nextAttack = now + level.think + Math.floor(random() * level.think);
      if (self.grounded) {
        const m = pickMove('ground', dx, dy, tDamage);
        if (m !== null) {
          // Les coups vers l'avant demandent d'être tourné vers la cible.
          if (
            m.slot === M_FTILT ||
            m.slot === M_FSMASH ||
            m.slot === M_SSPECIAL ||
            self.facing === dirTo
          ) {
            const [sx, sy, b] = moveInput(m.slot, dirTo, self.facing);
            return out(sx, sy, b);
          }
          return out(dirTo * 30, 0, 0);
        }
        // Cible au-dessus et proche : saut, puis aérien.
        if (dy > 10 && dist < 20 && random() < 0.4 + profile.air * 0.5) {
          const air = pickMove('air', dx, dy - 12, tDamage);
          pendingAerial = air?.slot ?? M_UAIR;
          return out(dirTo * 40, 0, BTN_JUMP);
        }
      } else {
        const m = pickMove('air', dx, dy, tDamage);
        if (m !== null) {
          const [sx, sy, b] = moveInput(m.slot, dirTo, self.facing);
          return out(sx, sy, b);
        }
      }
    }

    // Placement : vers la distance préférée, sans jamais quitter le stage à pied.
    if (now >= nextThink) {
      nextThink = now + level.think;
      wantJumpAt = random() < profile.air * 0.15 ? now : -1;
    }
    let stick = 0;
    if (dist > profile.range + 6) stick = dirTo * (dist > 40 ? FULL : 80);
    else if (dist < profile.range - 6) stick = -dirTo * 80;
    else if (self.facing !== dirTo) stick = dirTo * 30;
    const margin = 6;
    if (
      self.grounded &&
      ((stick < 0 && self.x < arena.left + margin) || (stick > 0 && self.x > arena.right - margin))
    ) {
      stick = 0;
    }
    if (wantJumpAt === now && self.grounded) return out(stick, 0, BTN_JUMP);
    return out(stick, 0, 0);
  }

  return {
    player,
    level,
    next(sim) {
      const now = frame(sim);
      return decide(sim, now);
    },
  };
}
