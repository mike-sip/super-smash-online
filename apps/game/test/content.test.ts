import { ROSTER } from '@game/fighters';
import { defaultMatchConfig, type MatchConfig } from '@game/match-rules';
import { checksum, createSim, step } from '@game/sim-core';
import { STAGES } from '@game/stages-items';
import { describe, expect, it } from 'vitest';
import {
  FIGHTER_INFO,
  STAGE_INFO,
  buildSimConfig,
  fighterName,
  stageName,
} from '../src/content.ts';
import { CONTENT_IDS } from '../src/content-ids.ts';

/** Simule `frames` frames d'inputs pseudo-aléatoires reproductibles ; renvoie l'empreinte. */
function run(match: MatchConfig, fighters: string[], stage: string, frames = 600): number {
  const sim = createSim(buildSimConfig(match, { stage, fighters, seed: 1234 }));
  const inputs = new Uint32Array(fighters.length);
  let x = 99;
  for (let f = 0; f < frames; f++) {
    for (let p = 0; p < inputs.length; p++) {
      x = (x * 1103515245 + 12345) >>> 0;
      inputs[p] = (x >>> 16) & 0x0fff00ff;
    }
    step(sim, inputs);
  }
  return checksum(sim);
}

describe('contenu', () => {
  it('les identifiants proposés en ligne sont exactement ceux des modules, dans l’ordre', () => {
    expect([...CONTENT_IDS.fighters]).toEqual(ROSTER.map((c) => c.id));
    expect([...CONTENT_IDS.stages]).toEqual(STAGES.map((s) => s.id));
  });

  it('chaque personnage et chaque stage a un nom et une description', () => {
    for (const id of CONTENT_IDS.fighters) {
      expect(FIGHTER_INFO[id]!.name.length).toBeGreaterThan(0);
      expect(FIGHTER_INFO[id]!.summary.length).toBeGreaterThan(10);
    }
    for (const id of CONTENT_IDS.stages) {
      expect(STAGE_INFO[id]!.description.length).toBeGreaterThan(10);
    }
    expect(fighterName('random')).toBe('Au hasard');
    expect(stageName('random')).toBe('Au hasard');
    expect(fighterName('inconnu')).toBe('inconnu');
  });

  it.each(CONTENT_IDS.stages.map((s) => [s]))(
    'stage %s : se construit avec les 4 personnages et les objets',
    (stage) => {
      const match = {
        ...defaultMatchConfig('stock', 4),
        items: { enabled: true, frequency: 'high' as const },
      };
      expect(() => run(match, [...CONTENT_IDS.fighters], stage, 300)).not.toThrow();
    },
  );

  it('même entrée, même empreinte : deux navigateurs construisent la même partie', () => {
    const match = {
      ...defaultMatchConfig('time', 2),
      items: { enabled: true, frequency: 'normal' as const },
    };
    const a = run(match, ['sorel', 'nacre'], 'geysers');
    const b = run(match, ['sorel', 'nacre'], 'geysers');
    expect(a).toBe(b);
    expect(run(match, ['sorel', 'ferroc'], 'geysers')).not.toBe(a);
  });

  it('chaque mode de match se construit', () => {
    for (const mode of ['stock', 'time', 'stamina'] as const) {
      expect(() =>
        run(defaultMatchConfig(mode, 3), ['zephine', 'ferroc', 'sorel'], 'recif', 60),
      ).not.toThrow();
    }
  });

  it('les dangers peuvent être coupés', () => {
    const match = defaultMatchConfig('stock', 2);
    const on = buildSimConfig(match, { stage: 'geysers', fighters: ['sorel', 'nacre'], seed: 1 });
    const off = buildSimConfig(match, {
      stage: 'geysers',
      fighters: ['sorel', 'nacre'],
      seed: 1,
      hazards: false,
    });
    expect(on.stage.hazards?.length ?? 0).toBeGreaterThan(0);
    expect(off.stage.hazards?.length ?? 0).toBe(0);
  });

  it('refuse un identifiant inconnu', () => {
    const match = defaultMatchConfig('stock', 2);
    expect(() =>
      buildSimConfig(match, { stage: 'nulle-part', fighters: ['sorel', 'nacre'], seed: 1 }),
    ).toThrow();
    expect(() =>
      buildSimConfig(match, { stage: 'recif', fighters: ['sorel', 'personne'], seed: 1 }),
    ).toThrow();
  });
});
