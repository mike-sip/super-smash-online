/** Noms des emplacements d'attaque, pour les messages et le tableau de frame data. */
import {
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

interface SlotInfo {
  /** Nom de la constante de `sim-core`. */
  readonly code: string;
  /** Libellé lisible, pour le tableau. */
  readonly label: string;
}

const INFO: readonly (readonly [number, string, string])[] = [
  [M_JAB, 'M_JAB', 'Jab 1'],
  [M_JAB2, 'M_JAB2', 'Jab 2'],
  [M_JAB3, 'M_JAB3', 'Jab 3'],
  [M_FTILT, 'M_FTILT', 'Tilt avant'],
  [M_UTILT, 'M_UTILT', 'Tilt haut'],
  [M_DTILT, 'M_DTILT', 'Tilt bas'],
  [M_DASH_ATTACK, 'M_DASH_ATTACK', 'Attaque de dash'],
  [M_FSMASH, 'M_FSMASH', 'Smash avant'],
  [M_USMASH, 'M_USMASH', 'Smash haut'],
  [M_DSMASH, 'M_DSMASH', 'Smash bas'],
  [M_NAIR, 'M_NAIR', 'Aérienne neutre'],
  [M_FAIR, 'M_FAIR', 'Aérienne avant'],
  [M_BAIR, 'M_BAIR', 'Aérienne arrière'],
  [M_UAIR, 'M_UAIR', 'Aérienne haute'],
  [M_DAIR, 'M_DAIR', 'Aérienne basse'],
  [M_NSPECIAL, 'M_NSPECIAL', 'Spécial neutre'],
  [M_SSPECIAL, 'M_SSPECIAL', 'Spécial côté'],
  [M_USPECIAL, 'M_USPECIAL', 'Spécial haut'],
  [M_DSPECIAL, 'M_DSPECIAL', 'Spécial bas'],
  [M_LEDGE_ATTACK, 'M_LEDGE_ATTACK', 'Attaque de rebord'],
  [M_ULTIMATE, 'M_ULTIMATE', 'Ultime'],
  [M_EXTRA1, 'M_EXTRA1', 'Suite 1'],
  [M_EXTRA2, 'M_EXTRA2', 'Suite 2'],
];

export const SLOTS: readonly SlotInfo[] = (() => {
  const slots: SlotInfo[] = Array.from({ length: MOVE_SLOTS }, (_, i) => ({
    code: `#${i}`,
    label: `Emplacement ${i}`,
  }));
  for (const [slot, code, label] of INFO) slots[slot] = { code, label };
  return slots;
})();

/** Emplacements que chaque personnage doit remplir : les 20 standard et l'ultime. */
export const REQUIRED_SLOTS: readonly number[] = Array.from(
  { length: M_ULTIMATE + 1 },
  (_, i) => i,
);

/** Attaques aériennes : elles doivent avoir un lag d'atterrissage. */
export const AERIAL_SLOTS: readonly number[] = [M_NAIR, M_FAIR, M_BAIR, M_UAIR, M_DAIR];

/** Ordre d'affichage dans le tableau : normaux, smash, aériennes, spéciaux, ultime, suites, rebord. */
export const DISPLAY_ORDER: readonly number[] = [
  M_JAB,
  M_JAB2,
  M_JAB3,
  M_FTILT,
  M_UTILT,
  M_DTILT,
  M_DASH_ATTACK,
  M_FSMASH,
  M_USMASH,
  M_DSMASH,
  M_NAIR,
  M_FAIR,
  M_BAIR,
  M_UAIR,
  M_DAIR,
  M_NSPECIAL,
  M_SSPECIAL,
  M_USPECIAL,
  M_DSPECIAL,
  M_EXTRA1,
  M_EXTRA2,
  M_ULTIMATE,
  M_LEDGE_ATTACK,
];
