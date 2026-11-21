import { describe, expect, it } from 'vitest';
import { testConfig } from '@game/sim-core/testing';
import {
  createMatchSimConfig,
  defaultMatchConfig,
  validateMatchConfig,
  type MatchConfig,
  type MatchMode,
} from '../src/index.ts';

const MODES: MatchMode[] = ['stock', 'time', 'stamina'];

/** Copie modifiable d'une configuration par défaut, pour fabriquer des cas invalides. */
function base(mode: MatchMode = 'stock', players = 2): Record<string, unknown> {
  return JSON.parse(JSON.stringify(defaultMatchConfig(mode, players))) as Record<string, unknown>;
}

function errorsOf(value: unknown): string[] {
  const r = validateMatchConfig(value);
  return r.ok ? [] : r.errors;
}

describe('defaultMatchConfig', () => {
  it('donne les valeurs par défaut de la spec', () => {
    const stock = defaultMatchConfig('stock', 4);
    expect(stock).toMatchObject({ version: 1, mode: 'stock', stocks: 3, timeLimit: 420 });
    expect(stock.players).toHaveLength(4);
    expect(defaultMatchConfig('time', 2)).toMatchObject({ mode: 'time', timeLimit: 180 });
    expect(defaultMatchConfig('stamina', 2)).toMatchObject({
      mode: 'stamina',
      stamina: 150,
      stocks: 1,
      timeLimit: 0,
    });
  });

  it('produit toujours une configuration valide, de 2 à 8 joueurs, avec ou sans équipes', () => {
    for (const mode of MODES) {
      for (let players = 2; players <= 8; players++) {
        const config = defaultMatchConfig(mode, players);
        expect(validateMatchConfig(config)).toEqual({ ok: true, config });
        expect(validateMatchConfig({ ...config, teams: true }).ok).toBe(true);
      }
    }
  });
});

describe('validateMatchConfig', () => {
  it('fait l’aller-retour JSON sans perte', () => {
    const config: MatchConfig = {
      ...defaultMatchConfig('time', 6),
      teams: true,
      teamAttack: true,
      ultimate: false,
      items: { enabled: false, frequency: 'high' },
      players: [0, 1, 2, 3, 0, 1].map((team) => ({ team })),
    };
    const back = validateMatchConfig(JSON.parse(JSON.stringify(config)));
    expect(back).toEqual({ ok: true, config });
  });

  it('refuse ce qui n’est pas un objet', () => {
    for (const v of [null, undefined, 3, 'stock', [], true]) {
      expect(errorsOf(v).length).toBeGreaterThan(0);
    }
  });

  it('refuse les champs inconnus, à tous les niveaux', () => {
    expect(errorsOf({ ...base(), extra: 1 })).toEqual([expect.stringContaining('extra')]);
    const items = { ...base(), items: { enabled: true, frequency: 'low', rate: 2 } };
    expect(errorsOf(items)).toEqual([expect.stringContaining('rate')]);
    const players = { ...base(), players: [{ team: 0 }, { team: 1, name: 'x' }] };
    expect(errorsOf(players)).toEqual([expect.stringContaining('name')]);
  });

  it('signale chaque champ manquant', () => {
    const errors = errorsOf({});
    for (const key of ['version', 'mode', 'stocks', 'timeLimit', 'stamina', 'teams']) {
      expect(errors.some((e) => e.includes(key))).toBe(true);
    }
  });

  it('vérifie la version et le mode', () => {
    expect(errorsOf({ ...base(), version: 2 })).toHaveLength(1);
    expect(errorsOf({ ...base(), mode: 'coins' })).toHaveLength(1);
  });

  it('borne les vies de 1 à 99, en entiers', () => {
    expect(errorsOf({ ...base(), stocks: 1 })).toEqual([]);
    expect(errorsOf({ ...base(), stocks: 99 })).toEqual([]);
    for (const stocks of [0, 100, 2.5, '3', Number.NaN]) {
      expect(errorsOf({ ...base(), stocks })).toHaveLength(1);
    }
  });

  it('borne la limite de temps : 0 ou de 30 à 3 600 s, jamais 0 en Temps', () => {
    for (const timeLimit of [0, 30, 3600]) expect(errorsOf({ ...base(), timeLimit })).toEqual([]);
    for (const timeLimit of [29, 3601, -1, 60.5]) {
      expect(errorsOf({ ...base(), timeLimit })).toHaveLength(1);
    }
    expect(errorsOf({ ...base('time'), timeLimit: 0 })).toHaveLength(1);
    expect(errorsOf({ ...base('time'), timeLimit: 30 })).toEqual([]);
  });

  it('borne les points de vie de 1 à 999', () => {
    for (const stamina of [1, 999]) expect(errorsOf({ ...base('stamina'), stamina })).toEqual([]);
    for (const stamina of [0, 1000, 1.5]) {
      expect(errorsOf({ ...base('stamina'), stamina })).toHaveLength(1);
    }
  });

  it('vérifie les booléens et le réglage des objets', () => {
    for (const key of ['teams', 'teamAttack', 'ultimate']) {
      expect(errorsOf({ ...base(), [key]: 1 })).toHaveLength(1);
    }
    expect(errorsOf({ ...base(), items: { enabled: 'yes', frequency: 'low' } })).toHaveLength(1);
    expect(errorsOf({ ...base(), items: { enabled: true, frequency: 'max' } })).toHaveLength(1);
    expect(errorsOf({ ...base(), items: null })).toHaveLength(1);
  });

  it('accepte de 2 à 8 joueurs, chacun avec une équipe de 0 à 3', () => {
    const team = (n: number) => Array.from({ length: n }, (_, i) => ({ team: i % 4 }));
    expect(errorsOf({ ...base(), players: team(1) })).toHaveLength(1);
    expect(errorsOf({ ...base(), players: team(9) })).toHaveLength(1);
    expect(errorsOf({ ...base(), players: team(8) })).toEqual([]);
    expect(errorsOf({ ...base(), players: [{ team: 0 }, { team: 4 }] })).toHaveLength(1);
    expect(errorsOf({ ...base(), players: [{ team: 0 }, { team: -1 }] })).toHaveLength(1);
    expect(errorsOf({ ...base(), players: [{ team: 0 }, null] })).toHaveLength(1);
    expect(errorsOf({ ...base(), players: 'all' })).toHaveLength(1);
  });

  it('en équipes, exige au moins deux équipes différentes', () => {
    const same = {
      ...base('stock', 3),
      teams: true,
      players: [{ team: 2 }, { team: 2 }, { team: 2 }],
    };
    expect(errorsOf(same)).toEqual([expect.stringContaining('équipes')]);
    expect(errorsOf({ ...same, teams: false })).toEqual([]);
  });

  it('cumule les erreurs, une par champ fautif', () => {
    expect(errorsOf({ ...base(), stocks: 0, stamina: 0, teams: 'no' })).toHaveLength(3);
  });
});

describe('createMatchSimConfig', () => {
  const content = (players: number) => {
    const { stage, fighters, entities } = testConfig(players);
    return { stage, fighters, entities, seed: 5 };
  };

  it('transmet le contenu, le crochet de règles, et les équipes seulement en équipes', () => {
    const ffa = createMatchSimConfig(defaultMatchConfig('stock', 3), content(3));
    expect(ffa.fighters).toHaveLength(3);
    expect(ffa.seed).toBe(5);
    expect(ffa.rules).toBeDefined();
    expect(ffa.teams).toBeUndefined();

    const teams = createMatchSimConfig(
      { ...defaultMatchConfig('stock', 4), teams: true, teamAttack: false },
      content(4),
    );
    expect(teams.teams).toEqual([0, 1, 0, 1]);
    expect(teams.teamAttack).toBe(false);
  });

  it('lève sur une configuration invalide ou un nombre de combattants différent', () => {
    expect(() =>
      createMatchSimConfig({ ...defaultMatchConfig('stock', 2), stocks: 0 }, content(2)),
    ).toThrow(/stocks/);
    expect(() => createMatchSimConfig(defaultMatchConfig('stock', 3), content(2))).toThrow(
      /combattants/,
    );
  });
});
