/**
 * Écrans du combat local : joueurs et personnages, stage, règles ; entraînement. Le combat
 * lui-même est dans `local-match.ts`, les résultats dans `results.ts`.
 */
import { KEYBOARD_ID, gamepadId, type Device } from '@game/input';
import type { MatchConfig } from '@game/match-rules';
import { TEAM_COLORS } from '@game/render';
import type { ItemFrequency } from '@game/stages-items';
import type { App, Screen } from '../app.ts';
import { CONTENT_IDS } from '../content-ids.ts';
import { FIGHTER_INFO, RANDOM, STAGE_INFO, fighterName, stageName } from '../content.ts';
import { DUMMY_MODES, type DummyMode } from '../dummies.ts';
import {
  PRESETS,
  canContinue,
  createLocalSetup,
  cycleFighter,
  join,
  joined,
  leave,
  loadLocalPrefs,
  matchFromRules,
  resolveFighters,
  saveLocalPrefs,
  slotOf,
  toggleReady,
  type LocalRules,
  type LocalSetup,
} from '../local-setup.ts';
import { localMatch } from '../local-match.ts';
import { STANDARD_HINTS, button, choice, hints, menu, toggle, type Choice } from './components.ts';
import { el } from './dom.ts';
import { TEAM_NAMES, resultsScreen } from './results.ts';

const ROSTER: readonly string[] = CONTENT_IDS.fighters;
const STAGES: readonly string[] = CONTENT_IDS.stages;

/** Choix du combat local en cours, gardés d'un écran à l'autre. */
interface LocalPlan {
  setup: LocalSetup;
  stage: string;
  hazards: boolean;
  rules: LocalRules;
  teams: number[];
}

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

function deviceName(app: App, id: string): string {
  if (id === KEYBOARD_ID) return 'Clavier';
  const d = app.input.devices().find((x) => x.id === id);
  return d === undefined ? 'Manette' : d.label;
}

// --- Joueurs et personnages ------------------------------------------------------------------

export function openLocal(app: App): void {
  const prefs = loadLocalPrefs(app.storage);
  const plan: LocalPlan = {
    setup: createLocalSetup(ROSTER, prefs?.fighters ?? []),
    stage: prefs?.stage ?? STAGES[0]!,
    hazards: prefs?.hazards ?? true,
    rules: prefs?.rules ?? PRESETS[0]!.rules,
    teams: [0, 1, 0, 1],
  };
  app.push(localSetupScreen(app, plan));
}

function localSetupScreen(app: App, plan: LocalPlan): Screen {
  const { setup } = plan;
  const sample = new Uint32Array(4);
  let unsubscribe: (() => void) | null = null;

  // Le clavier tient J1 au départ ; les manettes rejoignent en appuyant.
  for (let i = 0; i < 4; i++) app.input.assign(i, null);
  app.input.assign(0, KEYBOARD_ID);
  join(setup, KEYBOARD_ID);

  const cards = setup.slots.map((_, slot) => {
    const name = el('span', { className: 'name' });
    const meta = el('span', { className: 'meta' });
    const status = el('span', { className: 'badge' });
    const prev = button('‹', () => change(slot, -1), {
      description: `Personnage précédent, J${slot + 1}`,
    });
    const next = button('›', () => change(slot, 1), {
      description: `Personnage suivant, J${slot + 1}`,
    });
    prev.setAttribute('aria-label', `J${slot + 1} : personnage précédent`);
    next.setAttribute('aria-label', `J${slot + 1} : personnage suivant`);
    const ready = button('Prêt', () => ready_(slot), { id: `ready-${slot}` });
    // Souris seulement : au clavier et à la manette, chaque joueur commande sa carte par ses directions.
    for (const b of [prev, next, ready]) b.tabIndex = -1;
    const swatch = el('div', { className: 'swatch' });
    const card = el(
      'div',
      {
        className: 'card',
        id: `slot-${slot}`,
        attrs: { role: 'group', 'aria-label': `Joueur ${slot + 1}` },
      },
      [
        el('strong', { text: `J${slot + 1}` }),
        swatch,
        name,
        meta,
        status,
        el('div', { className: 'row' }, [prev, next, ready]),
      ],
    );
    return { card, name, meta, status, prev, next, ready, swatch };
  });
  const cont = button('Choisir le stage', () => proceed(), { primary: true, id: 'local-continue' });
  const help = el('p', { className: 'muted', attrs: { 'aria-live': 'polite' } });

  function render(): void {
    setup.slots.forEach((s, slot) => {
      const c = cards[slot]!;
      const present = s.device !== null;
      c.card.classList.toggle('selected', present && s.ready);
      c.name.textContent = present ? fighterName(s.fighter) : 'Libre';
      const info = FIGHTER_INFO[s.fighter];
      c.meta.textContent = present
        ? `${deviceName(app, s.device!)} · ${info === undefined ? 'Tiré au lancement' : `${info.archetype} — ${info.summary}`}`
        : 'Appuyez sur un bouton d’une manette (ou une touche du jeu) pour rejoindre.';
      c.swatch.style.background = present ? (info?.color ?? '#888888') : 'transparent';
      c.status.textContent = present ? (s.ready ? 'Prêt' : 'Choisit…') : '';
      c.status.className = `badge ${s.ready ? 'ok' : ''}`;
      for (const b of [c.prev, c.next, c.ready]) b.disabled = !present;
      c.ready.querySelector('.label')!.textContent = s.ready ? 'Annuler' : 'Prêt';
    });
    const n = joined(setup);
    cont.disabled = !canContinue(setup, 2);
    help.textContent =
      n < 2
        ? 'Il faut au moins deux joueurs. Branchez une manette et appuyez sur un bouton. Seul ? Essayez l’Entraînement.'
        : canContinue(setup, 2)
          ? 'Tout le monde est prêt : Entrée ou A pour choisir le stage.'
          : 'Chacun choisit son personnage (← →) et se déclare prêt (Entrée ou A).';
  }

  function change(slot: number, delta: number): void {
    cycleFighter(setup, slot, delta);
    render();
  }

  function ready_(slot: number): void {
    toggleReady(setup, slot);
    const s = setup.slots[slot]!;
    if (s.ready) app.announce(`J${slot + 1} prêt avec ${fighterName(s.fighter)}`);
    render();
  }

  function confirmFrom(slot: number): void {
    if (slot < 0) return;
    if (canContinue(setup, 2)) proceed();
    else ready_(slot);
  }

  function backFrom(slot: number): void {
    const s = setup.slots[slot];
    if (s === undefined) return;
    if (s.ready) {
      s.ready = false;
      render();
    } else if (s.device !== KEYBOARD_ID) {
      app.input.assign(slot, null);
      leave(setup, slot);
      app.announce(`J${slot + 1} a quitté`);
      render();
    } else app.back();
  }

  function proceed(): void {
    if (!canContinue(setup, 2)) return;
    app.push(stageScreen(app, plan));
  }

  function onJoin(device: Device): void {
    const slot = join(setup, device.id);
    if (slot < 0) {
      app.toast('Quatre joueurs au plus.');
      return;
    }
    app.input.assign(slot, device.id);
    app.announce(`J${slot + 1} a rejoint : ${deviceName(app, device.id)}`);
    render();
  }

  const root = el('section', { className: 'screen', attrs: { 'aria-labelledby': 'local-title' } }, [
    el('header', {}, [
      el('h1', { id: 'local-title', text: 'Combat local' }),
      el('span', { className: 'muted', text: 'Joueurs et personnages' }),
    ]),
    el(
      'div',
      { className: 'cards' },
      cards.map((c) => c.card),
    ),
    help,
    menu('Suite', [cont]),
    hints([
      ['← →', 'personnage'],
      ['Entrée / A', 'prêt'],
      ['Échap / B', 'annuler ou quitter'],
    ]),
  ]);
  render();

  return {
    id: 'local-setup',
    back: 'pop',
    root,
    shown() {
      unsubscribe = app.input.onJoinRequest(onJoin);
      app.input.sample(sample);
      render();
    },
    hidden() {
      unsubscribe?.();
      unsubscribe = null;
    },
    frame() {
      // Lit les périphériques : c'est ce qui détecte qu'une manette veut rejoindre.
      app.input.sample(sample);
    },
    onKey(event) {
      const kb = slotOf(setup, KEYBOARD_ID);
      const target = event.target;
      if (
        (event.key === 'Enter' || event.key === ' ') &&
        target instanceof HTMLButtonElement &&
        root.contains(target)
      ) {
        return false;
      }
      if (event.repeat && (event.key === 'Enter' || event.key === 'Escape')) return true;
      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowRight':
          if (kb < 0) return false;
          change(kb, event.key === 'ArrowLeft' ? -1 : 1);
          return true;
        case 'Enter':
          confirmFrom(kb);
          return true;
        case 'Escape':
          if (kb >= 0) backFrom(kb);
          else app.back();
          return true;
      }
      return false;
    },
    onPad(action) {
      const slot = slotOf(setup, gamepadId(action.pad));
      if (slot < 0) return true; // pas encore rejoint : `input` s'en charge
      if (action.type === 'move') {
        if (action.dir === 'left' || action.dir === 'right')
          change(slot, action.dir === 'left' ? -1 : 1);
        return true;
      }
      if (action.type === 'confirm' || action.type === 'start') confirmFrom(slot);
      else if (action.type === 'back') backFrom(slot);
      return true;
    },
  };
}

// --- Stage -----------------------------------------------------------------------------------

function stageScreen(app: App, plan: LocalPlan): Screen {
  const pick = (id: string): void => {
    plan.stage = id;
    app.push(rulesScreen(app, plan));
  };
  const cards = [...STAGES, RANDOM].map((id) => {
    const info = STAGE_INFO[id];
    const card = el(
      'button',
      {
        className: 'card',
        id: `stage-${id}`,
        attrs: { type: 'button', 'aria-pressed': String(plan.stage === id) },
      },
      [
        el('span', { className: 'name', text: stageName(id) }),
        el('span', {
          className: 'meta',
          text: info?.description ?? 'Un stage tiré au sort au lancement.',
        }),
        info?.hasHazards === true ? el('span', { className: 'badge warn', text: 'Dangers' }) : null,
      ],
    );
    card.addEventListener('click', () => pick(id));
    if (plan.stage === id) card.dataset.autofocus = '';
    return card;
  });
  const hazards = toggle(
    'Dangers des stages',
    plan.hazards,
    (on) => (plan.hazards = on),
    'stage-hazards',
  );
  const root = el('section', { className: 'screen', attrs: { 'aria-labelledby': 'stage-title' } }, [
    el('header', {}, [el('h1', { id: 'stage-title', text: 'Choix du stage' })]),
    el('div', { className: 'cards' }, cards),
    menu('Options du stage', [hazards.element]),
    hints(STANDARD_HINTS),
  ]);
  return { id: 'local-stage', back: 'pop', root };
}

// --- Règles ----------------------------------------------------------------------------------

const MINUTES = [0, 1, 2, 3, 5, 7, 10];
const ITEM_CHOICES: readonly { value: ItemFrequency; label: string }[] = [
  { value: 'off', label: 'Aucun' },
  { value: 'low', label: 'Rares' },
  { value: 'normal', label: 'Normaux' },
  { value: 'high', label: 'Fréquents' },
];

function rulesScreen(app: App, plan: LocalPlan): Screen {
  const players = resolveFighters(plan.setup, ROSTER, () => 0).length;
  const errors = el('p', {
    className: 'error-text',
    id: 'rules-errors',
    attrs: { 'aria-live': 'polite' },
  });
  const fight = button('Combattre !', () => launch(), { primary: true, id: 'rules-fight' });
  const list = el('div', { className: 'menu' });
  const controls: Choice<unknown>[] = [];

  function setRules(next: Partial<LocalRules>): void {
    plan.rules = { ...plan.rules, ...next };
    refresh();
  }

  const preset = choice(
    'Préréglage',
    [
      { value: 'custom', label: 'Personnalisé' },
      ...PRESETS.map((p) => ({ value: p.id, label: p.label })),
    ],
    'custom',
    (id) => {
      const p = PRESETS.find((x) => x.id === id);
      if (p !== undefined) {
        plan.rules = { ...p.rules };
        syncControls();
        refresh();
      }
    },
    'rules-preset',
  );
  const mode = choice(
    'Mode',
    [
      { value: 'stock' as const, label: 'Vies' },
      { value: 'time' as const, label: 'Temps' },
      { value: 'stamina' as const, label: 'Endurance' },
    ],
    plan.rules.mode,
    (m) =>
      setRules({
        mode: m,
        timeLimit: m === 'time' && plan.rules.timeLimit === 0 ? 120 : plan.rules.timeLimit,
      }),
    'rules-mode',
  );
  const stocks = choice(
    'Vies',
    Array.from({ length: 10 }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
    plan.rules.stocks,
    (v) => setRules({ stocks: v }),
    'rules-stocks',
  );
  const time = choice(
    'Temps',
    MINUTES.map((m) => ({ value: m * 60, label: m === 0 ? 'Sans limite' : `${m} min` })),
    plan.rules.timeLimit,
    (v) => setRules({ timeLimit: v }),
    'rules-time',
  );
  const stamina = choice(
    'Points de vie',
    [50, 100, 150, 200, 300].map((v) => ({ value: v, label: `${v} PV` })),
    plan.rules.stamina,
    (v) => setRules({ stamina: v }),
    'rules-stamina',
  );
  const teams = toggle('Équipes', plan.rules.teams, (v) => setRules({ teams: v }), 'rules-teams');
  const teamAttack = toggle(
    'Tir allié',
    plan.rules.teamAttack,
    (v) => setRules({ teamAttack: v }),
    'rules-team-attack',
  );
  const ultimate = toggle(
    'Attaque ultime',
    plan.rules.ultimate,
    (v) => setRules({ ultimate: v }),
    'rules-ultimate',
  );
  const items = choice(
    'Objets',
    ITEM_CHOICES,
    plan.rules.items.enabled ? plan.rules.items.frequency : 'off',
    (v) =>
      setRules({
        items:
          v === 'off' ? { enabled: false, frequency: 'normal' } : { enabled: true, frequency: v },
      }),
    'rules-items',
  );
  const teamChoices = Array.from({ length: players }, (_, p) =>
    choice(
      `J${p + 1} : équipe`,
      TEAM_NAMES.map((name, t) => ({ value: t, label: `${t + 1} — ${name}` })),
      plan.teams[p] ?? p % 2,
      (t) => {
        plan.teams[p] = t;
        refresh();
      },
      `rules-team-${p}`,
    ),
  );
  controls.push(mode, stocks, time, stamina, teams, teamAttack, ultimate, items, ...teamChoices);

  function syncControls(): void {
    mode.set(plan.rules.mode);
    stocks.set(plan.rules.stocks);
    time.set(plan.rules.timeLimit);
    stamina.set(plan.rules.stamina);
    teams.set(plan.rules.teams);
    teamAttack.set(plan.rules.teamAttack);
    ultimate.set(plan.rules.ultimate);
    items.set(plan.rules.items.enabled ? plan.rules.items.frequency : 'off');
  }

  function current(): ReturnType<typeof matchFromRules> {
    return matchFromRules(plan.rules, plan.teams.slice(0, players));
  }

  function refresh(): void {
    const r = plan.rules;
    stocks.element.disabled = r.mode !== 'stock';
    stamina.element.disabled = r.mode !== 'stamina';
    teamAttack.element.disabled = !r.teams;
    teamChoices.forEach((c, p) => {
      c.element.disabled = !r.teams;
      c.element.style.borderLeft = r.teams
        ? `6px solid ${hex(TEAM_COLORS[plan.teams[p] ?? 0]!)}`
        : '';
    });
    const v = current();
    errors.textContent = v.ok ? '' : v.errors.join(' ');
    fight.disabled = !v.ok;
  }

  function launch(): void {
    const v = current();
    if (!v.ok) return;
    const picks = resolveFighters(plan.setup, ROSTER, Math.random);
    saveLocalPrefs(app.storage, {
      fighters: plan.setup.slots.map((s) => s.fighter),
      stage: plan.stage,
      hazards: plan.hazards,
      rules: plan.rules,
    });
    const stage =
      plan.stage === RANDOM ? STAGES[Math.floor(Math.random() * STAGES.length)]! : plan.stage;
    startLocalMatch(
      app,
      v.match,
      stage,
      plan.hazards,
      picks.map((p) => p.fighter),
      picks.map((p) => p.slot),
    );
  }

  list.append(preset.element, ...controls.map((c) => c.element));
  syncControls();
  refresh();
  mode.element.dataset.autofocus = '';
  const root = el('section', { className: 'screen', attrs: { 'aria-labelledby': 'rules-title' } }, [
    el('header', {}, [
      el('h1', { id: 'rules-title', text: 'Règles' }),
      el('span', { className: 'muted', text: `${players} joueurs · ${stageName(plan.stage)}` }),
    ]),
    list,
    errors,
    menu('Lancer', [fight]),
    hints([
      ['↑ ↓', 'réglage'],
      ['← →', 'valeur'],
      ['Échap / B', 'retour'],
    ]),
  ]);
  return { id: 'local-rules', back: 'pop', root };
}

function startLocalMatch(
  app: App,
  match: MatchConfig,
  stage: string,
  hazards: boolean,
  fighters: readonly string[],
  controllers: readonly number[],
): void {
  const names = fighters.map((_, i) => `J${controllers[i]! + 1}`);
  const screen = localMatch(app, {
    match,
    stage,
    hazards,
    fighters,
    controllers,
    onQuit: () => app.popTo('local-setup'),
    onEnd: (result) =>
      app.replace(
        resultsScreen(app, {
          result,
          names,
          fighters,
          back: () => app.popTo('local-setup'),
          actions: [
            {
              id: 'results-rematch',
              label: 'Revanche',
              primary: true,
              action: () => {
                app.pop();
                startLocalMatch(app, match, stage, hazards, fighters, controllers);
              },
            },
            {
              id: 'results-change',
              label: 'Changer de personnages',
              action: () => app.popTo('local-setup'),
            },
            { id: 'results-menu', label: 'Menu principal', action: () => app.popTo('main-menu') },
          ],
        }),
      ),
  });
  app.push(screen);
}

// --- Mesure de performance (prise de test) ---

/** Scénario de la mesure : 8 combattants, mannequins à inputs aléatoires, objets fréquents. */
export function perfTraining(app: App, stage: string): void {
  app.input.assign(0, KEYBOARD_ID);
  app.push(
    localMatch(app, {
      match: null,
      stage,
      hazards: true,
      fighters: Array.from({ length: 8 }, (_, i) => ROSTER[i % ROSTER.length]!),
      controllers: [0, -1, -1, -1, -1, -1, -1, -1],
      dummyMode: 'random',
      trainingItems: 'high',
      seed: 1,
      onEnd: () => {},
      onQuit: () => app.pop(),
    }),
  );
}

// --- Entraînement ----------------------------------------------------------------------------

export function openTraining(app: App): void {
  const prefs = loadLocalPrefs(app.storage);
  let fighter =
    prefs?.fighters[0] && ROSTER.includes(prefs.fighters[0]) ? prefs.fighters[0] : ROSTER[0]!;
  let stage = prefs?.stage && STAGES.includes(prefs.stage) ? prefs.stage : STAGES[0]!;
  let hazards = true;
  let count = 1;
  let mode: DummyMode = 'idle';
  let items: ItemFrequency = 'off';
  const controls = [
    choice(
      'Personnage',
      ROSTER.map((id) => ({ value: id, label: fighterName(id) })),
      fighter,
      (v) => (fighter = v),
      'training-fighter',
    ),
    choice(
      'Stage',
      STAGES.map((id) => ({ value: id, label: stageName(id) })),
      stage,
      (v) => (stage = v),
      'training-stage',
    ),
    toggle('Dangers', hazards, (v) => (hazards = v), 'training-hazards'),
    choice(
      'Mannequins',
      Array.from({ length: 7 }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
      count,
      (v) => (count = v),
      'training-count',
    ),
    choice('Comportement', DUMMY_MODES, mode, (v) => (mode = v), 'training-mode'),
    choice('Objets', ITEM_CHOICES, items, (v) => (items = v), 'training-items'),
  ];
  controls[0]!.element.dataset.autofocus = '';
  const start = button(
    'Commencer',
    () => {
      app.input.assign(0, KEYBOARD_ID);
      for (let i = 1; i < 4; i++) app.input.assign(i, null);
      const fighters = [
        fighter,
        ...Array.from(
          { length: count },
          (_, i) => ROSTER[(ROSTER.indexOf(fighter) + 1 + i) % ROSTER.length]!,
        ),
      ];
      app.push(
        localMatch(app, {
          match: null,
          stage,
          hazards,
          fighters,
          controllers: [0, ...Array.from({ length: count }, () => -1)],
          dummyMode: mode,
          trainingItems: items,
          onEnd: () => {},
          onQuit: () => app.pop(),
        }),
      );
    },
    { primary: true, id: 'training-start' },
  );
  const root = el(
    'section',
    { className: 'screen', attrs: { 'aria-labelledby': 'training-title' } },
    [
      el('header', {}, [
        el('h1', { id: 'training-title', text: 'Entraînement' }),
        el('span', {
          className: 'muted',
          text: 'Contre des mannequins, sans fin. Échap ou Start : pause.',
        }),
      ]),
      menu('Réglages de l’entraînement', [...controls.map((c) => c.element), start]),
      hints(STANDARD_HINTS),
    ],
  );
  app.push({ id: 'training-setup', back: 'pop', root });
}
