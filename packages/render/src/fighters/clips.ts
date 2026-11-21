/**
 * Contrat d'animation des modèles glTF (docs : `assets/fighters/README.md`) : quel clip joue pour
 * chaque action de la simulation, et comment son temps se règle sur les frames simulées.
 *
 * Chaque action donne une liste de noms par ordre de préférence : le premier clip présent dans le
 * modèle l'emporte. Un modèle peut donc commencer avec quelques clips (`idle`, `run`, `fall`,
 * `attack`…) et s'enrichir sans rien casser : ce qui manque retombe sur un clip voisin, au pire
 * sur `idle`. Les listes sont calculées une fois : le choix d'un clip n'alloue rien.
 */
import {
  A_AIR,
  A_AIRDODGE,
  A_ATTACK,
  A_BRAKE,
  A_CROUCH,
  A_DASH,
  A_DEAD,
  A_DOWN,
  A_GRAB,
  A_GRABBED,
  A_GRABBING,
  A_GRAB_RELEASE,
  A_HELPLESS,
  A_HITSTUN,
  A_IDLE,
  A_ITEM_SWING,
  A_ITEM_THROW,
  A_JUMPSQUAT,
  A_LAND,
  A_LEDGE,
  A_LEDGE_GETUP,
  A_LEDGE_ROLL,
  A_ROLL,
  A_RUN,
  A_SHIELD,
  A_SHIELDSTUN,
  A_SHIELD_BREAK,
  A_SHIELD_DROP,
  A_SPOTDODGE,
  A_TECH,
  A_THROW,
  A_TUMBLE,
  A_TURN,
  A_WALK,
  MOVE_SLOTS,
  M_BAIR,
  M_DAIR,
  M_DASH_ATTACK,
  M_DSMASH,
  M_DSPECIAL,
  M_DTILT,
  M_EXTRA1,
  M_EXTRA2,
  M_FAIR,
  M_FSMASH,
  M_FTILT,
  M_JAB,
  M_JAB2,
  M_JAB3,
  M_LEDGE_ATTACK,
  M_NAIR,
  M_NSPECIAL,
  M_SSPECIAL,
  M_UAIR,
  M_ULTIMATE,
  M_USMASH,
  M_USPECIAL,
  M_UTILT,
} from '@game/sim-core';

/** Nom du clip de chaque emplacement d'attaque (`M_*`). */
export const MOVE_CLIPS: readonly string[] = (() => {
  const names: string[] = Array.from({ length: MOVE_SLOTS }, (_, i) => `move${i}`);
  const known: readonly (readonly [number, string])[] = [
    [M_JAB, 'jab1'],
    [M_JAB2, 'jab2'],
    [M_JAB3, 'jab3'],
    [M_FTILT, 'ftilt'],
    [M_UTILT, 'utilt'],
    [M_DTILT, 'dtilt'],
    [M_DASH_ATTACK, 'dash_attack'],
    [M_FSMASH, 'fsmash'],
    [M_USMASH, 'usmash'],
    [M_DSMASH, 'dsmash'],
    [M_NAIR, 'nair'],
    [M_FAIR, 'fair'],
    [M_BAIR, 'bair'],
    [M_UAIR, 'uair'],
    [M_DAIR, 'dair'],
    [M_NSPECIAL, 'nspecial'],
    [M_SSPECIAL, 'sspecial'],
    [M_USPECIAL, 'uspecial'],
    [M_DSPECIAL, 'dspecial'],
    [M_LEDGE_ATTACK, 'ledge_attack'],
    [M_ULTIMATE, 'ultimate'],
    [M_EXTRA1, 'extra1'],
    [M_EXTRA2, 'extra2'],
  ];
  for (const [slot, name] of known) names[slot] = name;
  return names;
})();

/** Clips des quatre projections, dans l'ordre de `THROW_FORWARD…THROW_DOWN`. */
export const THROW_CLIPS: readonly string[] = [
  'throw_forward',
  'throw_back',
  'throw_up',
  'throw_down',
];

/** Repli de chaque attaque sur une attaque voisine, avant le clip générique `attack`. */
const MOVE_FALLBACK: Readonly<Record<string, readonly string[]>> = {
  jab2: ['jab1'],
  jab3: ['jab2', 'jab1'],
  dash_attack: ['ftilt'],
  fsmash: ['ftilt'],
  usmash: ['utilt'],
  dsmash: ['dtilt'],
  nair: ['fair'],
  bair: ['fair'],
  uair: ['utilt'],
  dair: ['dtilt'],
  sspecial: ['nspecial'],
  uspecial: ['uair'],
  dspecial: ['nspecial'],
  ledge_attack: ['ftilt'],
  ultimate: ['nspecial'],
  extra1: ['jab1'],
  extra2: ['jab1'],
};

/**
 * Clips joués en boucle sur l'horloge de la simulation. Les autres se déroulent une fois : étirés
 * sur la durée de l'action quand la simulation en donne une, sinon à 60 images par seconde.
 */
export const LOOP_CLIPS: ReadonlySet<string> = new Set([
  'idle',
  'walk',
  'run',
  'crouch',
  'fall',
  'shield',
  'tumble',
  'helpless',
  'grab_hold',
  'grabbed',
  'ledge',
]);

/** Clips dont le cycle suit la distance parcourue (les pieds ne glissent pas). */
export const STRIDE_CLIPS: ReadonlySet<string> = new Set(['walk', 'run']);

/** Suffixe du clip joué en boucle pendant la charge d'un smash (`fsmash_charge`…). */
export const CHARGE_SUFFIX = '_charge';

/** Variante de l'action en l'air : montée, chute ou double saut. */
export const AIR_RISE = 0;
export const AIR_FALL = 1;
export const AIR_DOUBLE = 2;

const ACTION_CLIPS = new Map<number, readonly string[]>([
  [A_IDLE, ['idle']],
  [A_WALK, ['walk', 'idle']],
  [A_DASH, ['dash', 'run', 'walk', 'idle']],
  [A_RUN, ['run', 'walk', 'idle']],
  [A_BRAKE, ['brake', 'idle']],
  [A_TURN, ['turn', 'idle']],
  [A_CROUCH, ['crouch', 'idle']],
  [A_JUMPSQUAT, ['jumpsquat', 'crouch', 'idle']],
  [A_LAND, ['land', 'crouch', 'idle']],
  [A_HITSTUN, ['hitstun', 'tumble', 'fall', 'idle']],
  [A_TUMBLE, ['tumble', 'hitstun', 'fall', 'idle']],
  [A_TECH, ['tech', 'roll', 'idle']],
  [A_DOWN, ['down', 'hitstun', 'idle']],
  [A_SHIELD, ['shield', 'crouch', 'idle']],
  [A_SHIELDSTUN, ['shieldstun', 'shield', 'crouch', 'idle']],
  [A_SHIELD_DROP, ['shield_drop', 'idle']],
  [A_SHIELD_BREAK, ['shield_break', 'hitstun', 'idle']],
  [A_SPOTDODGE, ['spotdodge', 'idle']],
  [A_ROLL, ['roll', 'idle']],
  [A_AIRDODGE, ['airdodge', 'fall', 'idle']],
  [A_GRAB, ['grab', 'ftilt', 'idle']],
  [A_GRABBING, ['grab_hold', 'grab', 'idle']],
  [A_GRABBED, ['grabbed', 'hitstun', 'idle']],
  [A_GRAB_RELEASE, ['grab_release', 'idle']],
  [A_LEDGE, ['ledge', 'idle']],
  [A_LEDGE_GETUP, ['ledge_getup', 'idle']],
  [A_LEDGE_ROLL, ['ledge_roll', 'roll', 'idle']],
  [A_ITEM_THROW, ['item_throw', 'throw_forward', 'ftilt', 'idle']],
  [A_ITEM_SWING, ['item_swing', 'ftilt', 'attack', 'idle']],
  [A_HELPLESS, ['helpless', 'fall', 'idle']],
  [A_DEAD, ['idle']],
]);

const AIR_CLIPS: readonly (readonly string[])[] = [
  ['jump', 'fall', 'idle'],
  ['fall', 'jump', 'idle'],
  ['double_jump', 'jump', 'fall', 'idle'],
];

const chain = (name: string): readonly string[] => [
  name,
  ...(MOVE_FALLBACK[name] ?? []),
  'attack',
  'idle',
];
const MOVE_CHAINS = MOVE_CLIPS.map(chain);
const CHARGE_CHAINS = MOVE_CLIPS.map((name) => [name + CHARGE_SUFFIX, ...chain(name)]);
const THROW_CHAINS = THROW_CLIPS.map((name) => [name, 'throw', 'grab', 'idle']);
const IDLE_ONLY: readonly string[] = ['idle'];

/**
 * Clips candidats, du préféré au plus général. `move` : emplacement de l'attaque ou de la
 * projection ; `air` : variante en l'air (`AIR_*`) ; `charging` : smash en charge.
 */
export function clipCandidates(
  action: number,
  move: number,
  air: number,
  charging: boolean,
): readonly string[] {
  if (action === A_ATTACK) {
    return (charging ? CHARGE_CHAINS[move] : MOVE_CHAINS[move]) ?? IDLE_ONLY;
  }
  if (action === A_THROW) return THROW_CHAINS[move & 3]!;
  if (action === A_AIR) return AIR_CLIPS[air] ?? AIR_CLIPS[AIR_FALL]!;
  return ACTION_CLIPS.get(action) ?? IDLE_ONLY;
}

/**
 * Poses de victoire des portraits de l'écran de résultats (`portraits.ts`) : la dernière image du
 * clip est photographiée. Absentes, le portrait prend `idle`.
 */
export const VICTORY_CLIPS: readonly string[] = ['victory1', 'victory2', 'victory3'];

/** Tous les noms de clips que le jeu sait jouer : la liste de travail des animateurs. */
export const ALL_CLIPS: readonly string[] = (() => {
  const all = new Set<string>();
  for (const list of ACTION_CLIPS.values()) for (const n of list) all.add(n);
  for (const list of AIR_CLIPS) for (const n of list) all.add(n);
  for (const list of MOVE_CHAINS) for (const n of list) all.add(n);
  for (const list of THROW_CHAINS) for (const n of list) all.add(n);
  for (const name of [M_FSMASH, M_USMASH, M_DSMASH].map((m) => MOVE_CLIPS[m]!)) {
    all.add(name + CHARGE_SUFFIX);
  }
  for (const name of VICTORY_CLIPS) all.add(name);
  return [...all];
})();
