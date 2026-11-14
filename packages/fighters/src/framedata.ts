/**
 * Tableau de frame data, calculé depuis les données : jamais écrit à la main. Le même calcul
 * alimente `FRAMEDATA.md` et le panneau de la démo.
 */
import { FX_ONE, fxToFloat, type FighterDef, type HitDef, type MoveDef } from '@game/sim-core';
import type { Character } from './character.ts';
import { DISPLAY_ORDER, SLOTS } from './slots.ts';

export interface FrameDataRow {
  readonly slot: number;
  /** Libellé de l'emplacement (« Smash avant »). */
  readonly label: string;
  /** Nom du coup chez ce personnage. */
  readonly name: string;
  /** Première frame active (hitbox, projectile ou contre), ou `null`. */
  readonly startup: number | null;
  /** Fenêtres actives, « 3–4, 9–10 », ou « — ». */
  readonly active: string;
  readonly total: number;
  /** Dégâts par groupe de coups (« 5 + 8 »), variantes d'un même coup (« 12 / 9 »), bonus de charge. */
  readonly damage: string;
  readonly angle: string;
  /** Éjection de base / croissance. */
  readonly knockback: string;
  readonly landingLag: number | null;
  readonly notes: string;
}

/** Nombre lisible, à la française : 3 décimales au plus, virgule. */
export function num(value: number): string {
  return String(Math.round(value * 1000) / 1000).replace('.', ',');
}
const units = (fx: number): string => num(fxToFloat(fx));
const distinct = (values: readonly string[]): string[] => [...new Set(values)];
const label = (slot: number): string => SLOTS[slot]?.label ?? `#${slot}`;

function activeWindows(hits: readonly HitDef[]): string {
  if (hits.length === 0) return '—';
  const windows = hits.map((h) => [h.start, h.end] as [number, number]).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last !== undefined && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
    else merged.push([w[0], w[1]]);
  }
  return merged.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');
}

/** Dégâts groupe par groupe, avec un facteur (1 sans charge), au dixième de pourcent près. */
function damageText(hits: readonly HitDef[], scale: number): string {
  const groups = distinct(hits.map((h) => String(h.group)));
  return groups
    .map((g) =>
      distinct(
        hits
          .filter((h) => String(h.group) === g)
          .map((h) => num(Math.round(fxToFloat(h.damage) * scale * 10) / 10)),
      ).join(' / '),
    )
    .join(' + ');
}

function notesOf(c: Character, move: MoveDef): string {
  const notes: string[] = [];
  for (const cancel of move.cancels) {
    notes.push(
      `suite : ${label(cancel.to)} (frames ${cancel.start}–${cancel.end})${cancel.requiresHit ? ' si touché' : ''}`,
    );
  }
  if (move.charge !== undefined) notes.push(`chargeable (jusqu'à ${move.charge.maxFrames} frames)`);
  if (move.spawn !== undefined) {
    const e = c.entities[move.spawn.kind - 1];
    const dmg = e?.hit === undefined ? '' : ` (${units(e.hit.damage)} %)`;
    notes.push(`projectile « ${e?.name ?? '?'} »${dmg}`);
  }
  for (const m of move.motion ?? []) {
    const parts: string[] = [];
    if (m.velX !== undefined) parts.push(`avant ${units(m.velX)}`);
    if (m.velY !== undefined)
      parts.push(`${m.velY >= 0 ? 'haut' : 'bas'} ${units(Math.abs(m.velY))}`);
    notes.push(`élan ${m.start}–${m.end} (${parts.join(', ')})`);
  }
  if (move.helpless === true) notes.push('chute impuissante');
  if (move.intangible !== undefined)
    notes.push(`invincible ${move.intangible.start}–${move.intangible.end}`);
  if (move.armor !== undefined) {
    notes.push(
      `armure ${move.armor.start}–${move.armor.end} (éjection ≤ ${units(move.armor.maxKnockback)})`,
    );
  }
  if (move.counter !== undefined) {
    notes.push(`contre ${move.counter.start}–${move.counter.end} → ${label(move.counter.to)}`);
  }
  return notes.join(' ; ');
}

function rowOf(c: Character, slot: number, move: MoveDef): FrameDataRow {
  const hits = move.hits;
  const first = hits.reduce((min, h) => Math.min(min, h.start), Infinity);
  const startup = Number.isFinite(first)
    ? first
    : (move.spawn?.frame ?? move.counter?.start ?? null);
  let damage = hits.length === 0 ? '—' : damageText(hits, 1);
  if (move.charge !== undefined && hits.length > 0) {
    damage += ` (${damageText(hits, move.charge.maxScale / FX_ONE)} chargé)`;
  }
  return {
    slot,
    label: label(slot),
    name: move.name,
    startup,
    active: activeWindows(hits),
    total: move.totalFrames,
    damage,
    angle: hits.length === 0 ? '—' : distinct(hits.map((h) => String(h.angle))).join(' / '),
    knockback:
      hits.length === 0
        ? '—'
        : distinct(hits.map((h) => `${units(h.baseKnockback)} / ${units(h.knockbackGrowth)}`)).join(
            ' ; ',
          ),
    landingLag: move.landingLag ?? null,
    notes: notesOf(c, move),
  };
}

/** Une ligne par coup du personnage, dans l'ordre d'affichage. */
export function frameData(c: Character): FrameDataRow[] {
  const rows: FrameDataRow[] = [];
  for (const slot of DISPLAY_ORDER) {
    const move = c.def.moves[slot];
    if (move !== undefined) rows.push(rowOf(c, slot, move));
  }
  return rows;
}

/** Valeurs de mouvement, libellé et valeur lisible. */
export function movementData(def: FighterDef): [string, string][] {
  const d = (x: { totalFrames: number; invStart: number; invEnd: number }) =>
    `${x.totalFrames} (intangible ${x.invStart}–${x.invEnd})`;
  return [
    ['Poids', units(def.weight)],
    ['Taille / demi-largeur', `${units(def.height)} / ${units(def.halfWidth)}`],
    ['Marche', units(def.walkSpeed)],
    ['Dash (vitesse, frames)', `${units(def.dashSpeed)}, ${def.dashFrames}`],
    ['Course', units(def.runSpeed)],
    ['Pré-saut', `${def.jumpSquatFrames}`],
    [
      'Saut / petit saut / double saut',
      `${units(def.jumpVelocity)} / ${units(def.shortHopVelocity)} / ${units(def.doubleJumpVelocity)}`,
    ],
    ['Sauts aériens', `${def.airJumps}`],
    ['Vitesse aérienne', units(def.airSpeed)],
    ['Gravité', units(def.gravity)],
    ['Chute max / rapide', `${units(def.maxFallSpeed)} / ${units(def.fastFallSpeed)}`],
    ['Atterrissage (frames)', `${def.landFrames}`],
    ['Bouclier', units(def.shieldMax)],
    ['Esquive sur place', d(def.spotDodge)],
    ['Roulade', d(def.roll)],
    ['Esquive aérienne', d(def.airDodge)],
  ];
}

const THROW_LABELS = [
  'Projection avant',
  'Projection arrière',
  'Projection haute',
  'Projection basse',
];
const ARCHETYPE_LABELS: Record<string, string> = {
  polyvalent: 'polyvalent',
  rapide: 'rapide',
  lourd: 'lourd',
  zoneur: 'zoneur',
};
const cell = (v: string | number | null): string =>
  v === null ? '—' : String(v).replace(/\|/g, '\\|');
const line = (cells: readonly (string | number | null)[]): string =>
  `| ${cells.map(cell).join(' | ')} |`;

function section(c: Character): string[] {
  const def = c.def;
  const out: string[] = [
    `## ${c.name} — ${ARCHETYPE_LABELS[c.archetype] ?? c.archetype}`,
    '',
    '### Mouvement',
    '',
  ];
  out.push('| Valeur | |', '|---|---|');
  for (const [k, v] of movementData(def)) out.push(line([k, v]));
  out.push('', '### Coups', '');
  out.push(
    line([
      'Coup',
      'Nom',
      'Démarrage',
      'Actives',
      'Durée',
      'Dégâts (%)',
      'Angle',
      'Éjection (base / croissance)',
      'Atterrissage',
      'Notes',
    ]),
    '|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const r of frameData(c)) {
    out.push(
      line([
        r.label,
        r.name,
        r.startup,
        r.active,
        r.total,
        r.damage,
        r.angle,
        r.knockback,
        r.landingLag,
        r.notes,
      ]),
    );
  }
  out.push('', '### Saisie et projections', '');
  out.push(
    line([
      '',
      'Démarrage',
      'Actives',
      'Durée',
      'Dégâts (%)',
      'Angle',
      'Éjection (base / croissance)',
    ]),
    '|---|---|---|---|---|---|---|',
  );
  const g = def.grab;
  out.push(
    line([
      'Saisie',
      g.start,
      `${g.start}–${g.end}`,
      g.totalFrames,
      `coup pendant la prise : ${units(g.pummelDamage)} toutes les ${g.pummelFrames} frames`,
      '—',
      '—',
    ]),
  );
  def.throws.forEach((t, k) => {
    out.push(
      line([
        THROW_LABELS[k]!,
        t.releaseFrame,
        '—',
        t.totalFrames,
        units(t.damage),
        String(t.angle),
        `${units(t.baseKnockback)} / ${units(t.knockbackGrowth)}`,
      ]),
    );
  });
  out.push('');
  return out;
}

/** Le tableau complet, en Markdown, pour une liste de personnages. */
export function frameDataMarkdown(roster: readonly Character[]): string {
  const out = [
    '# Frame data',
    '',
    '> Généré par `pnpm --filter @game/fighters framedata` à partir des données : ne pas modifier à la main.',
    '> Frames à 60 par seconde. Démarrage : première frame active. Distances et vitesses en unités de jeu (par frame).',
    '> Angles en degrés, 0 vers l’avant, 90 vers le haut. Dégâts chargés : à pleine charge.',
    '',
  ];
  for (const c of roster) out.push(...section(c));
  return out.join('\n');
}
