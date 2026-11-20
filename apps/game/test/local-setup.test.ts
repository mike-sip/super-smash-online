import { describe, expect, it } from 'vitest';
import {
  LOCAL_PREFS_KEY,
  PRESETS,
  canContinue,
  createLocalSetup,
  cycleFighter,
  cyclePalette,
  join,
  joined,
  leave,
  loadLocalPrefs,
  matchFromRules,
  resolveFighters,
  saveLocalPrefs,
  setCpuCount,
  setCpuLevel,
  cpuCount,
  slotOf,
  toggleReady,
} from '../src/local-setup.ts';

const ROSTER = ['sorel', 'zephine', 'ferroc', 'nacre'];

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('sélection locale', () => {
  it('rejoindre : première place libre, une place par périphérique, quatre au plus', () => {
    const s = createLocalSetup(ROSTER);
    expect(join(s, 'keyboard')).toBe(0);
    expect(join(s, 'keyboard')).toBe(0);
    expect(join(s, 'gamepad-0')).toBe(1);
    expect(join(s, 'gamepad-1')).toBe(2);
    expect(join(s, 'gamepad-2')).toBe(3);
    expect(join(s, 'gamepad-3')).toBe(-1);
    expect(joined(s)).toBe(4);
    leave(s, 1);
    expect(slotOf(s, 'gamepad-0')).toBe(-1);
    expect(join(s, 'gamepad-3')).toBe(1);
  });

  it('personnages : défilement avec « Au hasard », personnages précédents repris', () => {
    const s = createLocalSetup(ROSTER, ['nacre']);
    join(s, 'keyboard');
    expect(s.slots[0]!.fighter).toBe('nacre');
    cycleFighter(s, 0, 1);
    expect(s.slots[0]!.fighter).toBe('random');
    cycleFighter(s, 0, 1);
    expect(s.slots[0]!.fighter).toBe('sorel');
    cycleFighter(s, 0, -1);
    cycleFighter(s, 0, -1);
    expect(s.slots[0]!.fighter).toBe('nacre');
  });

  it('couleurs : huit par personnage, en boucle ; reprises par le tirage des joueurs', () => {
    const s = createLocalSetup(ROSTER);
    join(s, 'keyboard');
    expect(s.slots[0]!.palette).toBe(0);
    cyclePalette(s, 0, -1);
    expect(s.slots[0]!.palette).toBe(7);
    cyclePalette(s, 0, 2);
    expect(s.slots[0]!.palette).toBe(1);
    expect(resolveFighters(s, ROSTER, () => 0)[0]!.palette).toBe(1);
  });

  it('prêt : changer de personnage retire « prêt » ; continuer avec au moins deux joueurs prêts', () => {
    const s = createLocalSetup(ROSTER);
    join(s, 'keyboard');
    toggleReady(s, 0);
    expect(canContinue(s, 2)).toBe(false);
    join(s, 'gamepad-0');
    expect(canContinue(s, 2)).toBe(false);
    toggleReady(s, 1);
    expect(canContinue(s, 2)).toBe(true);
    cycleFighter(s, 1, 1);
    expect(s.slots[1]!.ready).toBe(false);
    expect(canContinue(s, 2)).toBe(false);
    expect(canContinue(createLocalSetup(ROSTER), 1)).toBe(false);
  });

  it('« Au hasard » tiré au lancement, dans l’ordre des places', () => {
    const s = createLocalSetup(ROSTER);
    join(s, 'keyboard');
    join(s, 'gamepad-0');
    cycleFighter(s, 1, -2); // zephine → sorel → au hasard
    expect(s.slots[1]!.fighter).toBe('random');
    const picks = resolveFighters(s, ROSTER, () => 0.99);
    expect(picks).toEqual([
      { slot: 0, device: 'keyboard', fighter: 'sorel', palette: 0, cpu: null },
      { slot: 1, device: 'gamepad-0', fighter: 'nacre', palette: 0, cpu: null },
    ]);
  });

  it('ordinateurs : places libres, toujours prêts, cédés à un joueur qui rejoint', () => {
    const s = createLocalSetup(ROSTER);
    join(s, 'keyboard');
    expect(setCpuCount(s, 3, 7)).toBe(3);
    expect(cpuCount(s)).toBe(3);
    expect(s.slots.slice(1).every((slot) => slot.ready && slot.level === 7)).toBe(true);
    toggleReady(s, 0);
    expect(canContinue(s, 2)).toBe(true);
    // Un joueur humain qui rejoint prend la place du dernier ordinateur.
    expect(join(s, 'gamepad-0')).toBe(3);
    expect(cpuCount(s)).toBe(2);
    setCpuLevel(s, 2);
    const picks = resolveFighters(s, ROSTER, () => 0);
    expect(picks.map((x) => x.cpu)).toEqual([null, 2, 2, null]);
    expect(setCpuCount(s, 0, 2)).toBe(0);
    expect(joined(s)).toBe(2);
  });

  it('préréglages valides et conversion en MatchConfig', () => {
    for (const preset of PRESETS) {
      const r = matchFromRules(preset.rules, [0, 1, 0]);
      expect(r.ok).toBe(true);
    }
    const teams = matchFromRules({ ...PRESETS[0]!.rules, teams: true }, [0, 0]);
    expect(teams.ok).toBe(false);
    if (!teams.ok) expect(teams.errors.join(' ')).toMatch(/équipe/i);
  });

  it('derniers réglages : écrits, relus, ignorés s’ils sont illisibles', () => {
    const m = memory();
    expect(loadLocalPrefs(m)).toBeNull();
    saveLocalPrefs(m, {
      fighters: ['ferroc', 'nacre'],
      stage: 'canal',
      hazards: false,
      rules: PRESETS[1]!.rules,
    });
    expect(loadLocalPrefs(m)).toEqual({
      fighters: ['ferroc', 'nacre'],
      stage: 'canal',
      hazards: false,
      rules: PRESETS[1]!.rules,
    });
    m.setItem(LOCAL_PREFS_KEY, '{"fighters":"x"}');
    expect(loadLocalPrefs(m)).toBeNull();
    m.setItem(
      LOCAL_PREFS_KEY,
      JSON.stringify({ fighters: [], stage: 'canal', hazards: true, rules: { mode: 'chaos' } }),
    );
    expect(loadLocalPrefs(m)).toBeNull();
  });
});
