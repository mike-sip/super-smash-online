/**
 * Panneau de réglage : modifier en direct les valeurs de gameplay du combattant de test.
 *
 * `sim-core` considère sa configuration comme figée. Le panneau ne la touche donc jamais : chaque
 * modification construit une copie de la configuration, avec laquelle la démo recrée la
 * simulation et le renderer. Les valeurs retenues s'exportent en texte, à reporter dans le code.
 *
 * Ne sont réglables que les valeurs que `sim-core` reçoit en données. Ses constantes internes
 * (durée du hitstun, vitesse d'éjection par point d'éjection, gel des coups) ne le sont pas.
 */
import { fx, fxToFloat, type FighterDef, type Fx, type SimConfig } from '@game/sim-core';

type FighterNumberKey = {
  [K in keyof FighterDef]: FighterDef[K] extends number ? K : never;
}[keyof FighterDef];

interface Field {
  readonly key: FighterNumberKey;
  readonly label: string;
  /** Vrai pour une durée ou un nombre entier ; faux pour une valeur en unités de jeu. */
  readonly integer: boolean;
  readonly min: number;
}

const unit = (key: FighterNumberKey, label: string, min = 0): Field => ({
  key,
  label,
  integer: false,
  min,
});
const frames = (key: FighterNumberKey, label: string, min = 0): Field => ({
  key,
  label,
  integer: true,
  min,
});

const GROUPS: readonly [title: string, fields: readonly Field[]][] = [
  [
    'Au sol',
    [
      unit('walkSpeed', 'Vitesse de marche'),
      unit('walkAccel', 'Accélération de marche'),
      unit('friction', 'Friction'),
      unit('dashSpeed', 'Vitesse du dash'),
      frames('dashFrames', 'Durée du dash', 1),
      unit('runSpeed', 'Vitesse de course'),
      unit('runAccel', 'Accélération de course'),
      frames('brakeFrames', 'Durée du freinage'),
      frames('turnFrames', 'Durée du demi-tour'),
    ],
  ],
  [
    'Saut',
    [
      frames('jumpSquatFrames', 'Pré-saut', 1),
      unit('jumpVelocity', 'Grand saut'),
      unit('shortHopVelocity', 'Petit saut'),
      unit('doubleJumpVelocity', 'Saut aérien'),
      frames('airJumps', 'Sauts aériens'),
      frames('landFrames', "Lag d'atterrissage"),
    ],
  ],
  [
    'En l’air',
    [
      unit('gravity', 'Gravité', 0.001),
      unit('maxFallSpeed', 'Vitesse de chute'),
      unit('fastFallSpeed', 'Chute rapide'),
      unit('airSpeed', 'Vitesse aérienne'),
      unit('airAccel', 'Accélération aérienne'),
      unit('airFriction', 'Friction aérienne'),
    ],
  ],
  [
    'Défense et éjection',
    [
      unit('weight', 'Poids', 1),
      unit('shieldMax', 'Résistance du bouclier', 1),
      frames('techFrames', 'Durée du rétablissement', 1),
      frames('downFrames', 'Durée à terre', 1),
      frames('airDodgeLandingLag', 'Lag après esquive aérienne'),
    ],
  ],
];

/** Multiplicateurs appliqués à tous les coups : attaques, projections, projectiles. */
interface Scales {
  damage: number;
  baseKnockback: number;
  knockbackGrowth: number;
}
const SCALE_FIELDS: readonly [key: keyof Scales, label: string][] = [
  ['damage', 'Dégâts ×'],
  ['baseKnockback', 'Éjection de base ×'],
  ['knockbackGrowth', 'Croissance de l’éjection ×'],
];

export type TuningValues = Partial<Record<FighterNumberKey, number>>;

/**
 * Écriture décimale la plus courte qui redonne exactement la valeur à virgule fixe : c'est celle
 * du code source (`fx(0.09)`), et non son arrondi interne (0,090087890625).
 */
export function shortestDecimal(value: Fx): number {
  const exact = fxToFloat(value);
  for (let digits = 0; digits <= 6; digits++) {
    const candidate = Number(exact.toFixed(digits));
    if (fx(candidate) === value) return candidate;
  }
  return exact;
}

const scaled = (value: Fx, factor: number): Fx => fx(fxToFloat(value) * factor);

interface Blow {
  readonly damage: Fx;
  readonly baseKnockback: Fx;
  readonly knockbackGrowth: Fx;
}

function scaleBlow<T extends Blow>(blow: T, scales: Scales): T {
  return {
    ...blow,
    damage: scaled(blow.damage, scales.damage),
    baseKnockback: scaled(blow.baseKnockback, scales.baseKnockback),
    knockbackGrowth: scaled(blow.knockbackGrowth, scales.knockbackGrowth),
  };
}

/**
 * Copie de `base` où le combattant de J1 reçoit `values` et où tous ses coups sont multipliés par
 * `scales`. Les joueurs qui ont le même personnage que J1 (mêmes données) les reçoivent aussi ; les
 * autres personnages ne changent pas. `base` n'est pas modifiée.
 */
export function buildConfig(base: SimConfig, values: TuningValues, scales: Scales): SimConfig {
  const neutral = scales.damage === 1 && scales.baseKnockback === 1 && scales.knockbackGrowth === 1;
  const overrides: Partial<Record<FighterNumberKey, number>> = {};
  for (const [, fields] of GROUPS) {
    for (const field of fields) {
      const value = values[field.key];
      if (value !== undefined) overrides[field.key] = field.integer ? value : fx(value);
    }
  }
  const reference = base.fighters[0];
  const fighters = base.fighters.map((def): FighterDef => {
    if (def !== reference) return def;
    const tuned = { ...def, ...overrides } as FighterDef;
    if (neutral) return tuned;
    return {
      ...tuned,
      moves: def.moves.map(
        (move) => move && { ...move, hits: move.hits.map((hit) => scaleBlow(hit, scales)) },
      ),
      throws: [
        scaleBlow(def.throws[0], scales),
        scaleBlow(def.throws[1], scales),
        scaleBlow(def.throws[2], scales),
        scaleBlow(def.throws[3], scales),
      ],
    };
  });
  const entities = neutral
    ? base.entities
    : base.entities?.map((def) => (def.hit ? { ...def, hit: scaleBlow(def.hit, scales) } : def));
  return { ...base, fighters, ...(entities ? { entities } : {}) };
}

export interface Tuning {
  toggle(): void;
  dispose(): void;
}

/**
 * Construit le panneau dans `panel` (caché au départ). `onChange` reçoit la configuration à
 * utiliser après chaque modification.
 */
export function createTuning(
  panel: HTMLElement,
  base: SimConfig,
  onChange: (config: SimConfig) => void,
): Tuning {
  const doc = panel.ownerDocument;
  const reference = base.fighters[0]!;
  const values: TuningValues = {};
  const scales: Scales = { damage: 1, baseKnockback: 1, knockbackGrowth: 1 };
  const resets: (() => void)[] = [];

  const output = doc.createElement('textarea');
  output.readOnly = true;
  output.rows = 6;
  output.dataset.tuning = 'export';

  function refreshExport(): void {
    const lines: string[] = [];
    for (const [, fields] of GROUPS) {
      for (const field of fields) {
        const value = values[field.key];
        if (value === undefined) continue;
        lines.push(`${field.key}: ${field.integer ? value : `fx(${value})`},`);
      }
    }
    for (const [key, label] of SCALE_FIELDS) {
      if (scales[key] !== 1) lines.push(`// ${label} ${scales[key]} sur tous les coups`);
    }
    output.value = lines.length > 0 ? lines.join('\n') : '// Aucune valeur modifiée.';
  }

  function apply(): void {
    refreshExport();
    onChange(buildConfig(base, values, scales));
  }

  function row(
    parent: HTMLElement,
    name: string,
    label: string,
    initial: number,
    step: number,
    min: number,
    commit: (value: number | undefined) => void,
  ): void {
    const line = doc.createElement('label');
    const text = doc.createElement('span');
    text.textContent = label;
    const input = doc.createElement('input');
    input.type = 'number';
    input.step = String(step);
    input.min = String(min);
    input.value = String(initial);
    input.dataset.tuning = name;
    input.addEventListener('change', () => {
      const parsed = Number(input.value);
      if (input.value.trim() === '' || !Number.isFinite(parsed)) {
        input.value = String(initial);
        commit(undefined);
      } else {
        const value = Math.max(min, step === 1 ? Math.round(parsed) : parsed);
        input.value = String(value);
        commit(value === initial ? undefined : value);
      }
      line.classList.toggle('changed', input.value !== String(initial));
      apply();
    });
    resets.push(() => {
      input.value = String(initial);
      line.classList.remove('changed');
    });
    line.append(text, input);
    parent.append(line);
  }

  const title = doc.createElement('h2');
  title.textContent = 'Réglages';
  panel.append(title);

  for (const [groupTitle, fields] of GROUPS) {
    const heading = doc.createElement('h3');
    heading.textContent = groupTitle;
    panel.append(heading);
    for (const field of fields) {
      const raw = reference[field.key];
      const initial = field.integer ? raw : shortestDecimal(raw as Fx);
      row(panel, field.key, field.label, initial, field.integer ? 1 : 0.01, field.min, (v) => {
        if (v === undefined) delete values[field.key];
        else values[field.key] = v;
      });
    }
  }

  const heading = doc.createElement('h3');
  heading.textContent = 'Tous les coups';
  panel.append(heading);
  for (const [key, label] of SCALE_FIELDS) {
    row(panel, key, label, 1, 0.05, 0, (v) => {
      scales[key] = v ?? 1;
    });
  }

  const resetButton = doc.createElement('button');
  resetButton.type = 'button';
  resetButton.textContent = 'Valeurs d’origine';
  resetButton.dataset.tuning = 'reset';
  resetButton.addEventListener('click', () => {
    for (const key of Object.keys(values) as FighterNumberKey[]) delete values[key];
    scales.damage = 1;
    scales.baseKnockback = 1;
    scales.knockbackGrowth = 1;
    for (const reset of resets) reset();
    apply();
    resetButton.blur();
  });

  const exportLabel = doc.createElement('h3');
  exportLabel.textContent = 'À reporter dans le code';
  panel.append(resetButton, exportLabel, output);
  refreshExport();

  return {
    toggle() {
      panel.hidden = !panel.hidden;
    },
    dispose() {
      panel.replaceChildren();
    },
  };
}
