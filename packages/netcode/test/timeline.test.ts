import { describe, expect, it } from 'vitest';
import { HISTORY_FRAMES } from '../src/constants.ts';
import {
  confirmInputs,
  createTimeline,
  fillInputs,
  frontier,
  inputFor,
  pushLocal,
} from '../src/timeline.ts';

const u32 = (...values: number[]): Uint32Array => Uint32Array.from(values);

describe('historique des inputs', () => {
  it('confirme d’office des inputs nuls pour les frames 0 à D-1', () => {
    const t = createTimeline(3, [1], 2);
    expect(Array.from(t.known)).toEqual([2, 2, 2]);
    expect(frontier(t)).toBe(2);
    expect(t.localUpTo).toBe(2);
    for (let p = 0; p < 3; p++) {
      expect(inputFor(t, p, 0)).toBe(0);
      expect(inputFor(t, p, 1)).toBe(0);
    }
  });

  it('prédit un joueur distant par son dernier input confirmé', () => {
    const t = createTimeline(2, [0], 0);
    expect(inputFor(t, 1, 5)).toBe(0);
    confirmInputs(t, 1, 0, u32(7, 8, 9), 0, 3, 0, 0);
    expect(inputFor(t, 1, 1)).toBe(8);
    expect(inputFor(t, 1, 3)).toBe(9);
    expect(inputFor(t, 1, 50)).toBe(9);
  });

  it('prend l’input lu localement pour un joueur local', () => {
    const t = createTimeline(2, [1], 2);
    pushLocal(t, 2, u32(42));
    pushLocal(t, 3, u32(43));
    expect(inputFor(t, 1, 2)).toBe(42);
    expect(inputFor(t, 1, 3)).toBe(43);
    // Au-delà de ce qui a été lu : prédiction comme pour un distant.
    expect(inputFor(t, 1, 4)).toBe(0);
    expect(inputFor(t, 0, 2)).toBe(0);
  });

  it('préfère l’input confirmé à l’input local, et compte les remplacements', () => {
    const t = createTimeline(2, [0], 0);
    pushLocal(t, 0, u32(5));
    pushLocal(t, 1, u32(6));
    confirmInputs(t, 0, 0, u32(5, 99), 0, 2, 0, 0);
    expect(inputFor(t, 0, 1)).toBe(99);
    expect(t.lateInputs).toBe(1);
  });

  it('renvoie la première frame simulée mal prédite', () => {
    const t = createTimeline(2, [0], 0);
    const out = new Uint32Array(2);
    for (let f = 0; f < 6; f++) fillInputs(t, f, out); // tout prédit à 0 pour le joueur 1
    expect(confirmInputs(t, 1, 0, u32(0, 0, 3, 3, 0), 0, 5, 6, 0)).toBe(2);
    // Déjà connu : ignoré, plus rien de faux.
    expect(confirmInputs(t, 1, 0, u32(0, 0, 3, 3, 0), 0, 5, 6, 0)).toBe(-1);
    // Frame 5 simulée avec 0, confirmée à 0 : juste. Frame 6 pas encore simulée : pas de rollback.
    expect(confirmInputs(t, 1, 5, u32(0, 4), 0, 2, 6, 0)).toBe(-1);
    expect(t.known[1]).toBe(7);
  });

  it('applique la partie nouvelle d’un bloc qui chevauche le connu', () => {
    const t = createTimeline(2, [0], 0);
    confirmInputs(t, 1, 0, u32(1, 2), 0, 2, 0, 0);
    confirmInputs(t, 1, 1, u32(222, 3, 4), 0, 3, 0, 0);
    expect(t.known[1]).toBe(4);
    expect(inputFor(t, 1, 1)).toBe(2);
    expect(inputFor(t, 1, 3)).toBe(4);
  });

  it('ignore un bloc qui laisse un trou', () => {
    const t = createTimeline(2, [0], 0);
    expect(confirmInputs(t, 1, 3, u32(1, 2), 0, 2, 10, 0)).toBe(-1);
    expect(t.known[1]).toBe(0);
  });

  it('lit un bloc à partir d’un décalage', () => {
    const t = createTimeline(2, [0], 0);
    confirmInputs(t, 1, 0, u32(9, 9, 1, 2), 2, 2, 0, 0);
    expect(inputFor(t, 1, 0)).toBe(1);
    expect(inputFor(t, 1, 1)).toBe(2);
  });

  it('n’accepte rien au-delà de la capacité de l’anneau', () => {
    const t = createTimeline(2, [0], 0);
    const many = new Uint32Array(HISTORY_FRAMES + 10).map((_, i) => i + 1);
    confirmInputs(t, 1, 0, many, 0, many.length, 0, 0);
    expect(t.known[1]).toBe(HISTORY_FRAMES - 1);
    // Une fois la frontière et la simulation avancées, la suite passe.
    confirmInputs(t, 1, 0, many, 0, many.length, 0, 20);
    expect(t.known[1]).toBe(HISTORY_FRAMES + 10);
    expect(inputFor(t, 1, HISTORY_FRAMES + 5)).toBe(HISTORY_FRAMES + 6);
  });

  it('calcule la frontière comme le minimum des joueurs', () => {
    const t = createTimeline(3, [0], 0);
    confirmInputs(t, 0, 0, u32(1, 1, 1), 0, 3, 0, 0);
    confirmInputs(t, 2, 0, u32(1), 0, 1, 0, 0);
    expect(frontier(t)).toBe(0);
    confirmInputs(t, 1, 0, u32(1, 1), 0, 2, 0, 0);
    expect(frontier(t)).toBe(1);
  });

  it('mémorise les inputs utilisés pour chaque frame', () => {
    const t = createTimeline(2, [0], 0);
    pushLocal(t, 0, u32(11));
    const out = new Uint32Array(2);
    fillInputs(t, 0, out);
    expect(Array.from(out)).toEqual([11, 0]);
    expect(t.used[0]).toBe(11);
  });
});
