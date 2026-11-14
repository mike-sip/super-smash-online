/**
 * Tout l'état de simulation dans un seul ArrayBuffer de mots Int32.
 *
 * Pourquoi : le rollback sauvegarde et restaure l'état plusieurs fois par frame. Avec un tampon
 * unique, c'est une copie mémoire, et le checksum parcourt un tableau contigu.
 *
 * Ajouter un champ = ajouter son nom à l'une des listes ci-dessous. Cela change la taille de
 * l'état et tous les checksums : voir SPEC-sim-core.md, « Demander d'abord ».
 */

export const MAX_PLAYERS = 8;
export const MAX_ENTITIES = 32;

/** Index des valeurs globales dans `state.g`. */
export const G_FRAME = 0;
export const G_RNG = 1;
export const G_PLAYERS = 2;
export const GLOBAL_COUNT = 3;

/** Un Int32 par joueur. Positions et vitesses en virgule fixe, durées en frames. */
export const FIGHTER_FIELDS = [
  'posX',
  'posY',
  'velX',
  'velY',
  'facing',
  'grounded',
  /** Surface sous les pieds : index dans la géométrie du stage + 1, ou 0 en l'air. */
  'surface',
  'jumpsLeft',
  /** Frames consécutives stick incliné du même côté, signées par la direction. Sert au dash. */
  'tilt',
  'fastFall',
  'action',
  'actionFrame',
  'damage',
  'input',
  'prevInput',
  /** Comme `tilt`, pour l'axe vertical. */
  'tiltY',
  /** Tampons d'inputs : frames restantes pendant lesquelles l'appui reste valable. */
  'bufJump',
  'bufAttack',
  'bufSpecial',
  /** Stick droit : frames restantes dans les 8 bits bas, direction (1 à 4) au-dessus. */
  'bufC',
  /** Frames restantes pendant lesquelles un contact avec le sol ou un mur est un rétablissement. */
  'techWindow',
  /** Attaque en cours : emplacement, frames de charge, cibles déjà touchées par groupe. */
  'move',
  'charge',
  'chargeHold',
  'hitMask',
  'connected',
  'landLag',
  /** Frames de gel restantes après un coup porté ou reçu. */
  'hitlag',
  /** Frames de hitstun restantes. */
  'stun',
  'tumble',
  'bounced',
  /** Éjection en attente, appliquée à la fin du hitlag pour laisser le temps à la DI. */
  'launchPending',
  'launchSpeed',
  'launchAngle',
  /** Résistance restante du bouclier. */
  'shield',
  'bufShield',
  'bufGrab',
  /** Frames avant qu'un nouvel appui sur bouclier puisse rouvrir la fenêtre de rétablissement. */
  'techLock',
  /** Frames d'intangibilité restantes : aucun coup ni saisie ne touche. */
  'intangible',
  /** Esquive en cours : durée totale et frames d'intangibilité, usure comprise. */
  'dodgeTotal',
  'dodgeInv',
  'dodgeDir',
  /** Usure des esquives : chaque esquive rapprochée rallonge la suivante et réduit son intangibilité. */
  'dodgeStale',
  'dodgeTimer',
  'airDodged',
  /** Frames sans gravité restantes (esquive aérienne directionnelle). */
  'floatFrames',
  /** Saisie : victime tenue (index + 1), combattant qui nous tient (index + 1), durée restante. */
  'grabTarget',
  'grabbedBy',
  'grabTimer',
  'pummelCd',
  /** Rebord tenu (index + 1), délai avant nouvelle accroche, accroches depuis le dernier contact au sol. */
  'ledge',
  'ledgeCooldown',
  'ledgeGrabs',
  'ledgeTimer',
  // Ajouté pour le module `fighters` (SPEC-fighters.md, E6), en fin de liste.
  /** 1 si l'attaque ultime est prête : le prochain spécial neutre la lance. Levé par les règles de match. */
  'ultimateReady',
] as const;

/** Un Int32 par entité (projectile, objet). `eKind` à 0 signifie emplacement libre. */
export const ENTITY_FIELDS = [
  'eKind',
  'eOwner',
  'ePosX',
  'ePosY',
  'eVelX',
  'eVelY',
  'eLife',
  /** Joueurs déjà touchés par cette entité, un bit par joueur. */
  'eHitMask',
] as const;

export type FighterField = (typeof FIGHTER_FIELDS)[number];
export type EntityField = (typeof ENTITY_FIELDS)[number];

export const STATE_WORDS =
  GLOBAL_COUNT + FIGHTER_FIELDS.length * MAX_PLAYERS + ENTITY_FIELDS.length * MAX_ENTITIES;
export const STATE_BYTES = STATE_WORDS * 4;

export type SimState = {
  readonly buffer: ArrayBuffer;
  /** Vue octets du tampon entier, pour les snapshots. */
  readonly bytes: Uint8Array;
  /** Vue mots du tampon entier, pour le checksum. */
  readonly words: Int32Array;
  /** Valeurs globales, indexées par les constantes `G_*`. */
  readonly g: Int32Array;
} & { readonly [K in FighterField | EntityField]: Int32Array };

export function createState(): SimState {
  const buffer = new ArrayBuffer(STATE_BYTES);
  const fields: Record<string, Int32Array> = {};
  let offset = GLOBAL_COUNT * 4;
  for (const name of FIGHTER_FIELDS) {
    fields[name] = new Int32Array(buffer, offset, MAX_PLAYERS);
    offset += MAX_PLAYERS * 4;
  }
  for (const name of ENTITY_FIELDS) {
    fields[name] = new Int32Array(buffer, offset, MAX_ENTITIES);
    offset += MAX_ENTITIES * 4;
  }
  return {
    buffer,
    bytes: new Uint8Array(buffer),
    words: new Int32Array(buffer),
    g: new Int32Array(buffer, 0, GLOBAL_COUNT),
    ...fields,
  } as SimState;
}

export function saveFrom(s: SimState, out: Uint8Array): void {
  out.set(s.bytes);
}

export function loadInto(s: SimState, from: Uint8Array): void {
  s.bytes.set(from.length === STATE_BYTES ? from : from.subarray(0, STATE_BYTES));
}

/** FNV-1a sur les mots de l'état. Résultat non signé sur 32 bits. */
export function checksumState(s: SimState): number {
  const w = s.words;
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < w.length; i++) {
    const v = w[i]!;
    h = Math.imul(h ^ (v & 0xffff), 0x01000193);
    h = Math.imul(h ^ (v >>> 16), 0x01000193);
  }
  return h >>> 0;
}
