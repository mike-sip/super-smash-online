import {
  M_DAIR,
  M_DSMASH,
  M_DSPECIAL,
  M_FAIR,
  M_FSMASH,
  M_JAB,
  M_JAB2,
  M_NAIR,
  M_SSPECIAL,
  M_ULTIMATE,
  M_USPECIAL,
  M_UTILT,
  fx,
  type FighterDef,
} from '@game/sim-core';
import { TEST_ENTITIES, TEST_SPECIALIST } from '@game/sim-core/testing';
import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../src/build.ts';
import { STANDARD_BUILD, type Character } from '../src/character.ts';
import { formatIssue, validateCharacter } from '../src/validate.ts';
import { TEST_CHAR } from './helpers.ts';

/** Personnage complet et valide : le combattant de test spécialisé de `sim-core`. */
const VALID: Character = deepFreeze(
  structuredClone({
    id: 'valid',
    name: 'Valide',
    archetype: 'polyvalent' as const,
    def: TEST_SPECIALIST,
    entities: TEST_ENTITIES,
    look: { primary: 0x3366cc, secondary: 0xffffff, build: STANDARD_BUILD, parts: [] },
  }),
);

type Mutable<T> = T extends number | string | boolean
  ? T
  : { -readonly [K in keyof T]: Mutable<T[K]> };

/** Copie modifiable de VALID, modifiée par `mutate`, puis figée comme le serait un vrai personnage. */
function broken(mutate: (c: Mutable<Character>) => void): Character {
  const copy = structuredClone(VALID) as unknown as Mutable<Character>;
  mutate(copy);
  return deepFreeze(copy as unknown as Character);
}

/** Raccourci vers un coup de la copie. */
const m = (c: Mutable<Character>, slot: number) => (c.def as Mutable<FighterDef>).moves[slot]!;

function expectIssue(mutate: (c: Mutable<Character>) => void, path: string): void {
  const issues = validateCharacter(broken(mutate));
  const paths = issues.map((i) => i.path);
  expect(
    paths.some((p) => p.startsWith(path)),
    `attendu « ${path} » dans ${JSON.stringify(paths)}`,
  ).toBe(true);
}

describe('validateCharacter', () => {
  it('ne signale rien pour un personnage valide', () => {
    expect(validateCharacter(VALID).map(formatIssue)).toEqual([]);
  });

  it('signale seulement les emplacements vides du combattant de test ordinaire', () => {
    const issues = validateCharacter(TEST_CHAR);
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) expect(issue.message).toMatch(/emplacement vide/);
  });

  it('nomme le personnage, le coup et le champ fautif', () => {
    const issues = validateCharacter(broken((c) => (m(c, M_JAB).hits[0]!.start = 0)));
    expect(issues.map(formatIssue)).toContain(
      'valid › def.moves[M_JAB] « jab ».hits[0].start : doit être au moins 1 (reçu 0)',
    );
  });

  describe('rien de non fini', () => {
    it('refuse NaN', () => expectIssue((c) => (c.def.gravity = NaN as never), 'def.gravity'));
    it('refuse l’infini', () =>
      expectIssue((c) => (c.def.weight = Infinity as never), 'def.weight'));
    it('refuse une valeur non entière (hors virgule fixe)', () =>
      expectIssue((c) => (c.def.walkSpeed = 1.5 as never), 'def.walkSpeed'));
  });

  describe('frames cohérentes', () => {
    it('hitbox qui commence avant la frame 1', () =>
      expectIssue(
        (c) => (m(c, M_JAB).hits[0]!.start = 0),
        'def.moves[M_JAB] « jab ».hits[0].start',
      ));
    it('hitbox qui finit avant de commencer', () =>
      expectIssue((c) => (m(c, M_JAB).hits[0]!.end = 2), 'def.moves[M_JAB] « jab ».hits[0].end'));
    it('hitbox au-delà de la durée', () =>
      expectIssue((c) => (m(c, M_JAB).hits[0]!.end = 99), 'def.moves[M_JAB] « jab ».hits[0].end'));
    it('annulation hors de la durée', () =>
      expectIssue(
        (c) => (m(c, M_JAB).cancels[0]!.end = 99),
        'def.moves[M_JAB] « jab ».cancels[0].end',
      ));
    it('fenêtre d’élan hors de la durée', () =>
      expectIssue(
        (c) => (m(c, M_SSPECIAL).motion![0]!.end = 99),
        'def.moves[M_SSPECIAL] « lunge ».motion[0].end',
      ));
    it('fenêtre d’invincibilité inversée', () =>
      expectIssue(
        (c) => (m(c, M_USPECIAL).intangible!.start = 9),
        'def.moves[M_USPECIAL] « rise ».intangible',
      ));
    it('fenêtre d’armure hors de la durée', () =>
      expectIssue((c) => {
        const move = m(c, M_ULTIMATE);
        move.armor = { start: 1, end: 99, maxKnockback: fx(50) };
      }, 'def.moves[M_ULTIMATE] « ultimate ».armor.end'));
    it('fenêtre de contre hors de la durée', () =>
      expectIssue(
        (c) => (m(c, M_DSPECIAL).counter!.end = 99),
        'def.moves[M_DSPECIAL] « counter ».counter.end',
      ));
    it('frame de charge après le début des hitbox', () =>
      expectIssue(
        (c) => (m(c, M_FSMASH).charge!.frame = 13),
        'def.moves[M_FSMASH] « fsmash ».charge.frame',
      ));
    it('projectile qui part sur la frame de charge', () =>
      expectIssue((c) => {
        m(c, M_FSMASH).spawn = {
          frame: 5,
          kind: 1,
          x: 0 as never,
          y: 0 as never,
          velX: 0 as never,
          velY: 0 as never,
        };
      }, 'def.moves[M_FSMASH] « fsmash ».spawn.frame'));
    it('lag d’atterrissage négatif', () =>
      expectIssue((c) => (m(c, M_NAIR).landingLag = -1), 'def.moves[M_NAIR] « nair ».landingLag'));
    it('esquive dont l’intangibilité dépasse la durée', () =>
      expectIssue((c) => (c.def.roll.invEnd = 99), 'def.roll.invEnd'));
    it('saisie hors de sa durée', () => expectIssue((c) => (c.def.grab.end = 99), 'def.grab.end'));
    it('projection lâchée après sa fin', () =>
      expectIssue((c) => (c.def.throws[2].releaseFrame = 99), 'def.throws[2].releaseFrame'));
    it('coups pendant la prise sans délai', () =>
      expectIssue((c) => (c.def.grab.pummelFrames = 0), 'def.grab.pummelFrames'));
  });

  describe('hitbox dans des bornes', () => {
    it('rayon nul', () =>
      expectIssue(
        (c) => (m(c, M_JAB).hits[0]!.radius = 0 as never),
        'def.moves[M_JAB] « jab ».hits[0].radius',
      ));
    it('extrémité trop loin du personnage', () =>
      expectIssue((c) => (m(c, M_JAB).hits[0]!.x2 = fx(100)), 'def.moves[M_JAB] « jab ».hits[0]'));
    it('groupe hors de 0 à 3', () =>
      expectIssue(
        (c) => (m(c, M_DSMASH).hits[1]!.group = 4),
        'def.moves[M_DSMASH] « dsmash ».hits[1].group',
      ));
    it('angle hors de 0 à 360', () =>
      expectIssue(
        (c) => (m(c, M_JAB).hits[0]!.angle = 400),
        'def.moves[M_JAB] « jab ».hits[0].angle',
      ));
    it('dégâts excessifs', () =>
      expectIssue(
        (c) => (m(c, M_JAB).hits[0]!.damage = fx(70)),
        'def.moves[M_JAB] « jab ».hits[0].damage',
      ));
    it('éjection négative', () =>
      expectIssue(
        (c) => (m(c, M_JAB).hits[0]!.baseKnockback = fx(-1)),
        'def.moves[M_JAB] « jab ».hits[0].baseKnockback',
      ));
    it('hurtbox qui dépasse de la hauteur du corps', () =>
      expectIssue((c) => (c.def.hurtboxes[0]!.y2 = fx(20)), 'def.hurtboxes[0]'));
  });

  describe('moveset complet', () => {
    it('emplacement vide', () =>
      expectIssue((c) => (c.def.moves[M_UTILT] = undefined), 'def.moves[M_UTILT]'));
    it('aérienne sans lag d’atterrissage', () =>
      expectIssue((c) => delete m(c, M_FAIR).landingLag, 'def.moves[M_FAIR] « fair ».landingLag'));
    it('contre vers un emplacement vide', () =>
      expectIssue(
        (c) => (m(c, M_DSPECIAL).counter!.to = 22),
        'def.moves[M_DSPECIAL] « counter ».counter.to',
      ));
    it('annulation vers un emplacement vide', () =>
      expectIssue(
        (c) => (c.def.moves[M_JAB2] = undefined),
        'def.moves[M_JAB] « jab ».cancels[0].to',
      ));
    it('projectile inconnu', () =>
      expectIssue((c) => {
        m(c, M_DAIR).spawn = {
          frame: 5,
          kind: 3,
          x: 0 as never,
          y: 0 as never,
          velX: 0 as never,
          velY: 0 as never,
        };
      }, 'def.moves[M_DAIR] « dive ».spawn.kind'));
    it('ultime sans invincibilité', () =>
      expectIssue(
        (c) => delete m(c, M_ULTIMATE).intangible,
        'def.moves[M_ULTIMATE] « ultimate ».intangible',
      ));
  });

  describe('mouvement plausible', () => {
    it('vitesse nulle', () => expectIssue((c) => (c.def.walkSpeed = 0 as never), 'def.walkSpeed'));
    it('durée nulle', () => expectIssue((c) => (c.def.dashFrames = 0), 'def.dashFrames'));
    it('petit saut plus haut que le grand', () =>
      expectIssue((c) => (c.def.shortHopVelocity = fx(3)), 'def.shortHopVelocity'));
    it('chute rapide plus lente que la chute normale', () =>
      expectIssue((c) => (c.def.fastFallSpeed = fx(1)), 'def.fastFallSpeed'));
    it('course plus lente que la marche', () =>
      expectIssue((c) => (c.def.runSpeed = fx(0.5)), 'def.runSpeed'));
  });

  describe('projectiles et visuel', () => {
    it('projectile sans rayon', () =>
      expectIssue((c) => (c.entities[0]!.radius = 0 as never), 'entities[0] « shot ».radius'));
    it('projectile sans durée de vie', () =>
      expectIssue((c) => (c.entities[1]!.lifetime = 0), 'entities[1] « ball ».lifetime'));
    it('couleur hors de 0xRRGGBB', () =>
      expectIssue((c) => (c.look.primary = 0x1000000), 'look.primary'));
    it('proportion nulle', () =>
      expectIssue((c) => (c.look.build.headSize = 0), 'look.build.headSize'));
  });

  describe('coûts déterministes', () => {
    it('refuse des données non figées', () => {
      const issues = validateCharacter(structuredClone(VALID));
      expect(issues.map((i) => i.message)).toContain(
        'les données doivent être figées en profondeur',
      );
    });
  });
});
