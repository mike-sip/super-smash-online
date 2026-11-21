import { describe, expect, it } from 'vitest';
import { generateGuestPseudo, pseudoKey, validatePseudo } from '../src/names.ts';

function problem(raw: string): string | null {
  const result = validatePseudo(raw);
  return result.ok ? null : result.problem;
}

describe('validatePseudo', () => {
  it('accepte un pseudo ordinaire et le rend tel quel', () => {
    expect(validatePseudo('Marius_42')).toEqual({
      ok: true,
      pseudo: 'Marius_42',
      key: 'marius_42',
    });
  });

  it('retire les espaces de bord et normalise en NFKC', () => {
    // « Ｍａｘ » en caractères pleine largeur devient « Max ».
    const result = validatePseudo('  \uFF2D\uFF41\uFF58  ');
    expect(result).toEqual({ ok: true, pseudo: 'Max', key: 'max' });
    // é décomposé (e + accent combinant) est recomposé.
    const composed = validatePseudo('Ele\u0301na');
    expect(composed.ok && composed.pseudo).toBe('El\u00e9na');
  });

  it('borne la longueur entre 3 et 16 caractères', () => {
    expect(problem('ab')).toBe('length');
    expect(problem('abc')).toBeNull();
    expect(problem('a'.repeat(16))).toBeNull();
    expect(problem('a'.repeat(17))).toBe('length');
    expect(problem('')).toBe('length');
    // Les lettres accentuées comptent pour un caractère.
    expect(problem('éèà')).toBeNull();
  });

  it('accepte les lettres latines accentuées', () => {
    for (const name of ['Élodie', 'Zoë', 'Łukasz', 'Ægir', 'Œdipe', 'Ñandú', 'Øystein']) {
      expect(problem(name), name).toBeNull();
    }
  });

  it('refuse les caractères hors liste', () => {
    for (const name of [
      'jean paul',
      'max!',
      'a.b.c',
      'Вася',
      'José😀',
      'tab\tby',
      'a/b/c',
      '名前です',
    ]) {
      expect(problem(name), name).toBe('characters');
    }
    // Lettre cyrillique « а » glissée dans un nom latin : homoglyphe refusé.
    expect(problem('m\u0430rius')).toBe('characters');
    // Caractères invisibles.
    expect(problem('mar\u200Bius')).toBe('characters');
  });

  it('exige une lettre en premier', () => {
    expect(problem('1abc')).toBe('start');
    expect(problem('_abc')).toBe('start');
    expect(problem('-abc')).toBe('start');
  });

  it('refuse deux séparateurs de suite', () => {
    expect(problem('ab__cd')).toBe('separators');
    expect(problem('ab-_cd')).toBe('separators');
    expect(problem('ab_c-d')).toBeNull();
  });

  it('refuse les mots interdits, même déguisés', () => {
    for (const name of [
      'admin',
      'SuperAdmin',
      'Adm1n',
      'SuperAdm1n',
      'Ad-min',
      'Moderateur',
      'Modérateur',
      'Support_Team',
      'Invité-12',
      'Invite',
      'guest42',
      'Hitler',
      'h1tl3r',
      'con',
      'Con_123',
    ]) {
      expect(problem(name), name).toBe('forbidden');
    }
  });

  it('ne refuse pas les noms qui contiennent par hasard un mot court interdit', () => {
    for (const name of ['Constance', 'Scunthorpe', 'Computer', 'Torpedo', 'Montenegro', 'Grape']) {
      expect(problem(name), name).toBeNull();
    }
  });
});

describe('pseudoKey', () => {
  it('ignore la casse et les accents', () => {
    expect(pseudoKey('Élodie')).toBe(pseudoKey('elodie'));
    expect(pseudoKey('ÉLODIE')).toBe('elodie');
    expect(pseudoKey('Œdipe')).toBe('oedipe');
    expect(pseudoKey('Łukasz')).toBe('lukasz');
    expect(pseudoKey('Straße')).toBe('strasse');
  });

  it('garde les séparateurs et les chiffres', () => {
    expect(pseudoKey('Max_1')).not.toBe(pseudoKey('Max-1'));
    expect(pseudoKey('Max1')).not.toBe(pseudoKey('Max2'));
  });

  it('normalise avant de calculer la clé', () => {
    expect(pseudoKey('  \uFF2D\uFF41\uFF58 ')).toBe('max');
  });
});

describe('generateGuestPseudo', () => {
  it('donne « Invité- » suivi de cinq chiffres', () => {
    for (let i = 0; i < 50; i++) expect(generateGuestPseudo()).toMatch(/^Invité-\d{5}$/);
  });

  it('varie d’un appel à l’autre', () => {
    const names = new Set(Array.from({ length: 50 }, () => generateGuestPseudo()));
    expect(names.size).toBeGreaterThan(40);
  });
});
