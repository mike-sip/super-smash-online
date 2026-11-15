import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, drawCode, formatCode, normalizeCode } from '../src/codes.ts';

describe('codes de salon', () => {
  it('alphabet de 30 symboles sans ambiguïté, codes de 6 caractères', () => {
    expect(CODE_ALPHABET).toHaveLength(30);
    expect(new Set(CODE_ALPHABET).size).toBe(30);
    for (const c of '01ILOU') expect(CODE_ALPHABET).not.toContain(c);
    expect(CODE_LENGTH).toBe(6);
  });

  it('tire chaque caractère par la source d’aléa, dans l’alphabet', () => {
    const calls: number[] = [];
    let i = 0;
    const code = drawCode((max) => {
      calls.push(max);
      return i++ % max;
    });
    expect(calls).toEqual([30, 30, 30, 30, 30, 30]);
    expect(code).toBe('ABCDEF');
    const many = new Set<string>();
    for (let k = 0; k < 500; k++) many.add(drawCode((max) => Math.floor(Math.random() * max)));
    for (const c of many) expect(normalizeCode(c)).toBe(c);
    expect(many.size).toBeGreaterThan(495);
  });

  it('normalise la saisie : minuscules, espaces et tirets ignorés', () => {
    expect(normalizeCode('abc-def')).toBe('ABCDEF');
    expect(normalizeCode('  AbC dEf ')).toBe('ABCDEF');
    expect(normalizeCode('a-b-c-d-e-f')).toBe('ABCDEF');
  });

  it('refuse une longueur fausse, un caractère exclu ou une valeur qui n’est pas un texte', () => {
    expect(normalizeCode('ABCDE')).toBeNull();
    expect(normalizeCode('ABCDEFG')).toBeNull();
    expect(normalizeCode('ABCDE0')).toBeNull();
    expect(normalizeCode('ABCDEO')).toBeNull();
    expect(normalizeCode('ABCDÉF')).toBeNull();
    expect(normalizeCode('')).toBeNull();
    expect(normalizeCode('A'.repeat(1000))).toBeNull();
    expect(normalizeCode(42 as unknown as string)).toBeNull();
  });

  it('affiche le code en deux groupes', () => {
    expect(formatCode('ABCDEF')).toBe('ABC-DEF');
  });
});
