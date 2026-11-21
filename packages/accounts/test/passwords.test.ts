import { describe, expect, it } from 'vitest';
import { normalizePassword, validatePassword } from '../src/passwords.ts';

function problem(password: string, pseudo = 'Marius'): string | null {
  const result = validatePassword(password, pseudo);
  return result.ok ? null : result.problem;
}

describe('validatePassword', () => {
  it('accepte un mot de passe de 8 à 128 caractères sans règle de composition', () => {
    expect(problem('tartiflette')).toBeNull();
    expect(problem('a'.repeat(8) + 'b')).toBeNull();
    expect(problem('x'.repeat(127) + 'y')).toBeNull();
    expect(problem('phrase de passe avec des espaces')).toBeNull();
  });

  it('refuse moins de 8 ou plus de 128 caractères', () => {
    expect(problem('court12')).toBe('length');
    expect(problem('')).toBe('length');
    expect(problem('x'.repeat(129))).toBe('length');
    // Les caractères comptent, pas les octets.
    expect(problem('éèàùçôîê')).toBeNull();
  });

  it('refuse un mot de passe égal au pseudo, sans tenir compte de la casse', () => {
    expect(problem('Marius_42', 'Marius_42')).toBe('same_as_pseudo');
    expect(problem('marius_42', 'Marius_42')).toBe('same_as_pseudo');
    expect(problem('Élodie2024', 'elodie2024')).toBe('same_as_pseudo');
  });

  it('refuse les mots de passe les plus courants, sans tenir compte de la casse', () => {
    for (const pw of [
      'password',
      'PASSWORD1',
      '12345678',
      'azertyuiop',
      'motdepasse',
      'Qwertyuiop',
    ]) {
      expect(problem(pw), pw).toBe('too_common');
    }
  });
});

describe('normalizePassword', () => {
  it('rend identiques les formes composée et décomposée', () => {
    expect(normalizePassword('caf\u00e9-noir')).toBe(normalizePassword('cafe\u0301-noir'));
  });

  it('ne retire pas les espaces', () => {
    expect(normalizePassword(' abc ')).toBe(' abc ');
  });
});
