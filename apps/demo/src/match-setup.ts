/**
 * Choix des règles du match dans la démo : mode, vies, temps, points de vie, équipes, tir allié,
 * ultime. Préfigure ce que fera le module `lobby` : produire une `MatchConfig` validée.
 *
 * Les règles sont aussi lisibles dans l'adresse, pour les tests et pour garder un réglage au
 * rechargement : `?rules=stock|time|stamina|free&stocks=3&time=420&hp=150&teams=0,1&ff=1&ultimate=0`.
 */
import {
  MAX_STAMINA,
  MAX_STOCKS,
  MAX_TEAMS,
  MAX_TIME_LIMIT,
  defaultMatchConfig,
  validateMatchConfig,
  type MatchConfig,
  type MatchMode,
} from '@game/match-rules';
import { TEAM_COLORS } from '@game/render';

export const TEAM_NAMES: readonly string[] = ['Rouge', 'Bleue', 'Verte', 'Jaune'];
const MODE_NAMES: Record<MatchMode, string> = {
  stock: 'Stock (vies)',
  time: 'Temps (score)',
  stamina: 'Endurance (points de vie)',
};

function intParam(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) ? undefined : value;
}

/**
 * Règles lues dans l'adresse ; `null` pour un combat libre (`rules=free`). Une valeur invalide
 * est ignorée au profit de la valeur par défaut du mode.
 */
export function matchFromParams(params: URLSearchParams, players: number): MatchConfig | null {
  const rules = params.get('rules') ?? 'stock';
  if (rules === 'free') return null;
  const mode: MatchMode = rules === 'time' || rules === 'stamina' ? rules : 'stock';
  const base = defaultMatchConfig(mode, players);
  const teamList = params
    .get('teams')
    ?.split(',')
    .map((t) => Number.parseInt(t, 10));
  const candidate: MatchConfig = {
    ...base,
    stocks: intParam(params, 'stocks') ?? base.stocks,
    timeLimit: intParam(params, 'time') ?? base.timeLimit,
    stamina: intParam(params, 'hp') ?? base.stamina,
    teams: teamList !== undefined,
    teamAttack: params.get('ff') === '1',
    ultimate: params.get('ultimate') !== '0',
    players:
      teamList !== undefined
        ? base.players.map((_, i) => ({ team: teamList[i] ?? i % 2 }))
        : base.players,
  };
  const checked = validateMatchConfig(candidate);
  return checked.ok ? checked.config : base;
}

/** Écrit les règles dans `params` (l'inverse de `matchFromParams`). */
export function matchToParams(config: MatchConfig | null, params: URLSearchParams): void {
  for (const key of ['rules', 'stocks', 'time', 'hp', 'teams', 'ff', 'ultimate'])
    params.delete(key);
  if (config === null) {
    params.set('rules', 'free');
    return;
  }
  params.set('rules', config.mode);
  if (config.mode !== 'time') params.set('stocks', String(config.stocks));
  params.set('time', String(config.timeLimit));
  if (config.mode === 'stamina') params.set('hp', String(config.stamina));
  if (config.teams) {
    params.set('teams', config.players.map((p) => p.team).join(','));
    if (config.teamAttack) params.set('ff', '1');
  }
  if (!config.ultimate) params.set('ultimate', '0');
}

export interface MatchSetupOptions {
  readonly panel: HTMLElement;
  readonly players: number;
  /** Lancer un match avec ces règles, ou un combat libre (`null`). */
  onStart(config: MatchConfig | null): void;
  /** Changer le nombre de joueurs : la démo se recharge. */
  onPlayers(players: number): void;
}

export interface MatchSetup {
  readonly visible: boolean;
  toggle(): void;
  open(current: MatchConfig | null): void;
  close(): void;
}

export function createMatchSetup(options: MatchSetupOptions): MatchSetup {
  const { panel, players } = options;
  const doc = panel.ownerDocument;

  function field(label: string, input: HTMLElement): HTMLLabelElement {
    const row = doc.createElement('label');
    const text = doc.createElement('span');
    text.textContent = label;
    row.append(text, input);
    return row;
  }
  function number(name: string, min: number, max: number): HTMLInputElement {
    const input = doc.createElement('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.dataset.setup = name;
    return input;
  }
  function checkbox(name: string): HTMLInputElement {
    const input = doc.createElement('input');
    input.type = 'checkbox';
    input.dataset.setup = name;
    return input;
  }
  function select(name: string, choices: [value: string, label: string][]): HTMLSelectElement {
    const element = doc.createElement('select');
    element.dataset.setup = name;
    for (const [value, label] of choices) {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = label;
      element.append(option);
    }
    return element;
  }

  const title = doc.createElement('h2');
  title.textContent = 'Règles du match';
  const mode = select(
    'mode',
    (Object.keys(MODE_NAMES) as MatchMode[]).map((m) => [m, MODE_NAMES[m]]),
  );
  const count = select(
    'players',
    Array.from({ length: 7 }, (_, i) => [String(i + 2), `${i + 2} joueurs`]),
  );
  const stocks = number('stocks', 1, MAX_STOCKS);
  const time = number('time', 0, MAX_TIME_LIMIT);
  const hp = number('hp', 1, MAX_STAMINA);
  const teams = checkbox('teams');
  const teamAttack = checkbox('teamAttack');
  const ultimate = checkbox('ultimate');
  const stocksRow = field('Vies', stocks);
  const timeRow = field('Temps (s, 0 = illimité)', time);
  const hpRow = field('Points de vie', hp);
  const teamAttackRow = field('Tir allié', teamAttack);

  const teamBox = doc.createElement('div');
  const teamSelects: HTMLSelectElement[] = [];
  for (let p = 0; p < players; p++) {
    const s = select(
      `team-${p}`,
      TEAM_NAMES.slice(0, MAX_TEAMS).map((name, t) => [String(t), name]),
    );
    s.addEventListener('change', () => paintTeam(p));
    teamSelects.push(s);
    teamBox.append(field(`J${p + 1}`, s));
  }
  function paintTeam(p: number): void {
    const color = TEAM_COLORS[Number(teamSelects[p]!.value)] ?? 0x94a3b8;
    teamSelects[p]!.style.borderLeft = `6px solid #${color.toString(16).padStart(6, '0')}`;
  }

  const message = doc.createElement('p');
  message.className = 'message';
  message.dataset.setup = 'errors';

  const buttons = doc.createElement('div');
  buttons.className = 'buttons';
  function button(label: string, name: string, run: () => void): void {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.dataset.setup = name;
    b.addEventListener('click', () => {
      run();
      b.blur();
    });
    buttons.append(b);
  }

  /** Affiche seulement les réglages qui ont un sens pour le mode et les équipes choisis. */
  function refresh(): void {
    const m = mode.value as MatchMode;
    stocksRow.hidden = m === 'time';
    hpRow.hidden = m !== 'stamina';
    teamBox.hidden = !teams.checked;
    teamAttackRow.hidden = !teams.checked;
  }
  mode.addEventListener('change', () => {
    // Un changement de mode reprend ses valeurs par défaut, plus parlantes qu'un reste du précédent.
    const d = defaultMatchConfig(mode.value as MatchMode, players);
    stocks.value = String(d.stocks);
    time.value = String(d.timeLimit);
    hp.value = String(d.stamina);
    refresh();
  });
  teams.addEventListener('change', refresh);
  count.addEventListener('change', () => options.onPlayers(Number(count.value)));

  function read(): MatchConfig | null {
    const base = defaultMatchConfig(mode.value as MatchMode, players);
    const checked = validateMatchConfig({
      ...base,
      stocks: Number(stocks.value),
      timeLimit: Number(time.value),
      stamina: Number(hp.value),
      teams: teams.checked,
      teamAttack: teams.checked && teamAttack.checked,
      ultimate: ultimate.checked,
      players: teamSelects.map((s) => ({ team: Number(s.value) })),
    });
    if (checked.ok) {
      message.textContent = '';
      return checked.config;
    }
    message.textContent = checked.errors.join(' ');
    return null;
  }

  function fill(config: MatchConfig): void {
    mode.value = config.mode;
    stocks.value = String(config.stocks);
    time.value = String(config.timeLimit);
    hp.value = String(config.stamina);
    teams.checked = config.teams;
    teamAttack.checked = config.teamAttack;
    ultimate.checked = config.ultimate;
    config.players.forEach((p, i) => {
      if (teamSelects[i] !== undefined) teamSelects[i].value = String(p.team);
    });
    for (let p = 0; p < players; p++) paintTeam(p);
    refresh();
  }

  button('Lancer le match', 'start', () => {
    const config = read();
    if (config === null) return;
    panel.hidden = true;
    options.onStart(config);
  });
  button('Combat libre', 'free', () => {
    panel.hidden = true;
    options.onStart(null);
  });
  button('Fermer', 'close', () => {
    panel.hidden = true;
  });

  const note = doc.createElement('p');
  note.className = 'note';
  note.textContent =
    'Objets : sans effet dans la démo tant que le module stages-items n’est pas fusionné.';

  count.value = String(players);
  panel.append(
    title,
    field('Joueurs', count),
    field('Mode', mode),
    stocksRow,
    timeRow,
    hpRow,
    field('Attaque ultime', ultimate),
    field('Équipes', teams),
    teamAttackRow,
    teamBox,
    message,
    buttons,
    note,
  );
  fill(defaultMatchConfig('stock', players));

  return {
    get visible() {
      return !panel.hidden;
    },
    toggle() {
      panel.hidden = !panel.hidden;
    },
    open(current) {
      fill(current ?? defaultMatchConfig('stock', players));
      message.textContent = '';
      panel.hidden = false;
    },
    close() {
      panel.hidden = true;
    },
  };
}
