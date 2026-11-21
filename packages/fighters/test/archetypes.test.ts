/**
 * Identité des archétypes (SPEC-fighters.md, « Valeurs cibles par archétype ») : ce sont les écarts
 * entre personnages qui sont vérifiés, pas les valeurs elles-mêmes.
 */
import {
  M_BAIR,
  M_DAIR,
  M_DASH_ATTACK,
  M_DSMASH,
  M_DTILT,
  M_FAIR,
  M_FSMASH,
  M_FTILT,
  M_JAB,
  M_NAIR,
  M_UAIR,
  M_ULTIMATE,
  M_USMASH,
  M_UTILT,
  fxToFloat,
} from '@game/sim-core';
import { describe, expect, it } from 'vitest';
import type { Character } from '../src/character.ts';
import { character } from '../src/roster.ts';
import { strongestLaunch } from './characters/harness.ts';

const SOREL = character('sorel');
const ZEPHINE = character('zephine');
const FERROC = character('ferroc');
const NACRE = character('nacre');
const ALL = [SOREL, ZEPHINE, FERROC, NACRE];

/** Attaques normales, smash et aériennes : celles dont le démarrage fait le rythme du personnage. */
const NORMALS = [
  M_JAB,
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
];

const meanStartup = (c: Character): number =>
  NORMALS.reduce((sum, slot) => sum + Math.min(...c.def.moves[slot]!.hits.map((h) => h.start)), 0) /
  NORMALS.length;

/** Plus grande allonge d'une hitbox, hors ultime : extrémité la plus en avant ou en arrière, rayon compris. */
const reach = (c: Character): number => {
  let best = 0;
  c.def.moves.forEach((move, slot) => {
    if (move === undefined || slot === M_ULTIMATE) return;
    for (const h of move.hits) {
      best = Math.max(best, fxToFloat(Math.max(Math.abs(h.x1), Math.abs(h.x2)) + h.radius));
    }
  });
  return best;
};

/** Portée horizontale de chaque projectile lancé par un coup : vitesse × durée de vie. */
const projectileRanges = (c: Character): number[] =>
  c.def.moves.flatMap((move) => {
    const spawn = move?.spawn;
    if (spawn === undefined) return [];
    const e = c.entities[spawn.kind - 1]!;
    return [fxToFloat(Math.abs(spawn.velX)) * e.lifetime];
  });

const fsmashLaunch = new Map(ALL.map((c) => [c, strongestLaunch(c, M_FSMASH, 100)]));

const METRICS: Record<string, (c: Character) => number> = {
  course: (c) => c.def.runSpeed,
  'vitesse aérienne': (c) => c.def.airSpeed,
  dash: (c) => c.def.dashSpeed,
  poids: (c) => c.def.weight,
  'éjection du smash avant': (c) => fsmashLaunch.get(c)!,
  'démarrage moyen': meanStartup,
  allonge: reach,
};

/** Le personnage qui a la plus grande valeur, et celui qui a la plus petite. */
function extremes(metric: (c: Character) => number): [best: Character, worst: Character] {
  const sorted = [...ALL].sort((a, b) => metric(b) - metric(a));
  // Pas d'égalité aux extrémités : sinon « le plus » n'aurait pas de sens.
  expect(metric(sorted[0]!)).toBeGreaterThan(metric(sorted[1]!));
  expect(metric(sorted[2]!)).toBeGreaterThan(metric(sorted[3]!));
  return [sorted[0]!, sorted[3]!];
}

describe('identité des archétypes', () => {
  it('Zéphine a la course, la vitesse aérienne et le dash les plus rapides, et le poids le plus faible', () => {
    expect(extremes(METRICS.course!)[0]).toBe(ZEPHINE);
    expect(extremes(METRICS['vitesse aérienne']!)[0]).toBe(ZEPHINE);
    expect(extremes(METRICS.dash!)[0]).toBe(ZEPHINE);
    expect(extremes(METRICS.poids!)[1]).toBe(ZEPHINE);
  });

  it('Ferroc a le poids le plus élevé, le smash avant le plus fort et les démarrages les plus lents', () => {
    expect(extremes(METRICS.poids!)[0]).toBe(FERROC);
    expect(extremes(METRICS['éjection du smash avant']!)[0]).toBe(FERROC);
    expect(extremes(METRICS['démarrage moyen']!)[0]).toBe(FERROC);
  });

  it('Nacre a la plus grande allonge et les seuls projectiles à plus de 60 unités', () => {
    expect(extremes(METRICS.allonge!)[0]).toBe(NACRE);
    expect(Math.max(...projectileRanges(NACRE))).toBeGreaterThan(60);
    for (const c of [SOREL, ZEPHINE, FERROC]) {
      for (const range of projectileRanges(c)) expect(range, c.name).toBeLessThanOrEqual(60);
    }
  });

  it('Sorel n’est ni premier ni dernier sur aucune de ces mesures', () => {
    for (const [name, metric] of Object.entries(METRICS)) {
      const [best, worst] = extremes(metric);
      expect(best, `${name} : premier`).not.toBe(SOREL);
      expect(worst, `${name} : dernier`).not.toBe(SOREL);
    }
  });
});
