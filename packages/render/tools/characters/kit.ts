/**
 * Aides d'écriture communes aux animations des personnages (Zéphine, Ferroc, Nacre ; Sorel garde
 * ses propres aides, d'où elles viennent).
 *
 * Repères des canaux (voir `anim/keys.ts`) : bras à 0 pendants, 1,57 tendus devant, 3 au-dessus de
 * la tête, négatifs derrière ; un bras horizontal vaut `1.57 + torso` quand le buste se penche ;
 * avant-bras positifs : coude plié ; jambes positives : cuisse levée devant, tibias négatifs :
 * genou plié ; torse et tête positifs : penchés en avant ; `spin` positif : salto avant ; « F » :
 * membres côté caméra, « B » : côté opposé. Instants : `'s'` première frame active, `'e'`
 * dernière, `'t'` fin de l'action, `'c'` frame de charge.
 */
import { A_ATTACK } from '@game/sim-core';
import { HEAD_RADIUS, HIP_HEIGHT, TORSO } from '../../src/fighters/poses.ts';
import type { CharacterAnimation } from '../bake-character.ts';
import type { Ease, Key, Posture } from '../anim/keys.ts';

export type Clip = CharacterAnimation['clips'][number];
export const TAU = Math.PI * 2;

export const key = (at: number | string, pose: Posture, ease?: Ease): Key =>
  ease === undefined ? { at, pose } : { at, pose, ease };

/** Action à durée connue, écrite clé par clé. */
export const timed = (
  name: string,
  action: number,
  keys: Key[],
  extra: Partial<Clip> = {},
): Clip => ({ name, action, keys, ...extra });

/** Boucle de période `period` frames. */
export const loop = (
  name: string,
  action: number,
  period: number,
  keys: Key[],
  extra: Partial<Clip> = {},
): Clip => ({ name, action, loop: period, keys, ...extra });

export interface StrikeParts {
  wind: Posture;
  hit: Posture;
  hold?: Posture;
  follow?: Posture;
  ret?: Posture;
  air?: boolean;
  /** Instant de la pose d'anticipation (par défaut `'s*0.55'`). */
  windAt?: string;
  /** Instant de la fin du suivi (par défaut `'e+4'`). */
  followAt?: string;
  /** Courbe de la frappe (par défaut `snap`). */
  hitEase?: Ease;
  /** Clés en plus, entre la frappe et le suivi (coups multiples). */
  extra?: Key[];
  vel?: readonly [number, number];
}

/**
 * Coup type : anticipation, frappe en place à la première frame active, tenue jusqu'à la
 * dernière, suivi, puis retour vers la garde (au sol ou en l'air).
 */
export function strikeKit(guard: Posture, airGuard: Posture) {
  return (name: string, move: number, p: StrikeParts): Clip => {
    const air = p.air === true;
    const keys: Key[] = [
      key(p.windAt ?? 's*0.55', p.wind, 'inOut'),
      key('s', p.hit, p.hitEase ?? 'snap'),
      ...(p.extra ?? []),
      key('e', p.hold ?? {}, 'linear'),
      key(p.followAt ?? 'e+4', p.follow ?? {}, 'out'),
      key('t', p.ret ?? (air ? airGuard : guard), 'settle'),
    ];
    return {
      name,
      action: A_ATTACK,
      move,
      keys,
      ...(air ? { air: true, from: airGuard } : {}),
      ...(p.vel === undefined ? {} : { vel: p.vel }),
    };
  };
}

/**
 * Attaque en charge (smash, spécial chargeable) : la pose d'anticipation tremble d'énergie
 * contenue. `amp` règle l'amplitude du tremblement, `period` sa cadence.
 */
export function charge(name: string, move: number, base: Posture, amp = 1, period = 12): Clip {
  const q = period / 4;
  return loop(
    `${name}_charge`,
    A_ATTACK,
    period,
    [
      key(0, base),
      key(q, {
        ...base,
        torso: (base.torso ?? 0) + 0.04 * amp,
        armF: (base.armF ?? 0) + 0.05 * amp,
        offsetX: -0.006 * amp,
      }),
      key(q * 2, { ...base, torso: (base.torso ?? 0) - 0.02 * amp }),
      key(q * 3, { ...base, armB: (base.armB ?? 0) - 0.05 * amp, offsetX: 0.006 * amp }),
    ],
    { move },
  );
}

/** Pose d'anticipation d'un clip (sa première clé), complétée par la garde. */
export const windOf = (clips: readonly Clip[], name: string, guard: Posture): Posture => {
  const clip = clips.find((c) => c.name === name);
  if (clip === undefined) throw new Error(`clip « ${name} » introuvable`);
  return { ...guard, ...clip.keys[0]!.pose };
};

/**
 * Distance d'un cycle de pas (deux pas), en hauteurs de personnage, pour une amplitude de cuisse
 * `swing` et les proportions du personnage (`legLength`, `headSize` de son gabarit).
 */
export function cycleLength(swing: number, legLength: number, headSize: number): number {
  const height = HIP_HEIGHT * legLength + TORSO + 2 * HEAD_RADIUS * headSize;
  const standard = HIP_HEIGHT + TORSO + 2 * HEAD_RADIUS;
  return (4 * HIP_HEIGHT * legLength * Math.sin(swing)) / (height / standard);
}
