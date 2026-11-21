import { readFileSync } from 'node:fs';
import { M_DSMASH, M_FSMASH, M_JAB, M_NAIR, M_NSPECIAL } from '@game/sim-core';
import { TEST_ENTITIES, TEST_SPECIALIST } from '@game/sim-core/testing';
import { describe, expect, it } from 'vitest';
import { defineCharacter, STANDARD_BUILD } from '../src/character.ts';
import { fingerprint } from '../src/fingerprint.ts';
import { frameData, frameDataMarkdown } from '../src/framedata.ts';
import { ROSTER } from '../src/roster.ts';
import { TEST_CHAR } from './helpers.ts';

const SPECIALIST = defineCharacter({
  id: 'specialist',
  name: 'Spécialiste',
  archetype: 'polyvalent',
  def: structuredClone(TEST_SPECIALIST),
  entities: TEST_ENTITIES,
  look: { primary: 0, secondary: 0, build: STANDARD_BUILD, parts: [] },
});

const row = (c: typeof TEST_CHAR, slot: number) => frameData(c).find((r) => r.slot === slot)!;

describe('frameData', () => {
  it('décrit un coup simple : démarrage, frames actives, durée, dégâts, éjection', () => {
    expect(row(TEST_CHAR, M_JAB)).toMatchObject({
      label: 'Jab 1',
      name: 'jab',
      startup: 3,
      active: '3–4',
      total: 16,
      damage: '3',
      angle: '70',
      knockback: '8 / 0,3',
      landingLag: null,
    });
    expect(row(TEST_CHAR, M_JAB).notes).toContain('suite : Jab 2 (frames 6–16)');
  });

  it('donne le bonus de charge maximal et les fenêtres d’un coup multiple', () => {
    expect(row(TEST_CHAR, M_FSMASH).damage).toBe('16 (22,4 chargé)');
    expect(row(TEST_CHAR, M_DSMASH).active).toBe('6–8, 14–16');
    expect(row(TEST_CHAR, M_DSMASH).damage).toBe('5 + 8 (7 + 11,2 chargé)');
  });

  it('donne le lag d’atterrissage des aériennes', () => {
    expect(row(TEST_CHAR, M_NAIR).landingLag).toBe(6);
  });

  it('décrit un projectile par sa frame d’apparition', () => {
    const shot = row(TEST_CHAR, M_NSPECIAL);
    expect(shot.startup).toBe(12);
    expect(shot.active).toBe('—');
    expect(shot.notes).toContain('projectile « shot » (5 %)');
  });

  it('signale élan, chute impuissante, invincibilité, armure, contre', () => {
    const notes = frameData(SPECIALIST).map((r) => `${r.name} : ${r.notes}`);
    expect(notes).toEqual(
      expect.arrayContaining([expect.stringMatching(/^lunge : .*élan 5–14.*chute impuissante/)]),
    );
    expect(notes).toEqual(
      expect.arrayContaining([expect.stringMatching(/^rise : .*invincible 1–5/)]),
    );
    expect(notes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^armored punch : .*armure 1–20 \(éjection ≤ 60\)/),
      ]),
    );
    expect(notes).toEqual(
      expect.arrayContaining([expect.stringMatching(/^counter : .*contre 4–20 → Suite 1/)]),
    );
  });
});

describe('frameDataMarkdown', () => {
  it('a une section par personnage, avec mouvement, coups, saisie et projections', () => {
    const md = frameDataMarkdown([TEST_CHAR]);
    expect(md).toContain('## Test');
    expect(md).toContain('| Poids | 100 |');
    expect(md).toContain('| Jab 1 | jab | 3 | 3–4 | 16 |');
    expect(md).toContain('| Saisie |');
    expect(md).toContain('| Projection arrière |');
  });

  it('FRAMEDATA.md versionné est à jour (sinon : pnpm --filter @game/fighters framedata)', () => {
    const file = readFileSync(new URL('../FRAMEDATA.md', import.meta.url), 'utf8');
    expect(file).toBe(frameDataMarkdown(ROSTER));
  });
});

describe('fingerprint', () => {
  it('est identique pour deux constructions des mêmes données', () => {
    const copy = defineCharacter(structuredClone(SPECIALIST));
    expect(fingerprint(copy)).toBe(fingerprint(SPECIALIST));
  });

  it('change dès qu’une seule valeur change', () => {
    const copy = structuredClone(SPECIALIST);
    (copy.def.moves[M_JAB]!.hits[0] as { damage: number }).damage += 1;
    expect(fingerprint(copy)).not.toBe(fingerprint(SPECIALIST));
  });

  it('ignore l’apparence, qui ne touche pas au jeu', () => {
    const copy = structuredClone(SPECIALIST);
    (copy.look as { primary: number }).primary = 0xffffff;
    expect(fingerprint(copy)).toBe(fingerprint(SPECIALIST));
  });

  it('est un entier non signé sur 32 bits', () => {
    const f = fingerprint(SPECIALIST);
    expect(Number.isInteger(f) && f >= 0 && f <= 0xffffffff).toBe(true);
  });
});
