/** Écran de résultats de la démo : classement, gagnants et statistiques de fin de match. */
import type { MatchResult } from '@game/match-rules';
import { TEAM_COLORS } from '@game/render';
import { TEAM_NAMES } from './match-setup.ts';

export interface ResultsOptions {
  readonly panel: HTMLElement;
  onReplay(): void;
  onRules(): void;
}

export interface Results {
  readonly visible: boolean;
  show(result: MatchResult): void;
  hide(): void;
}

const REASONS: Record<MatchResult['reason'], string> = {
  'last-standing': 'Dernier en lice',
  time: 'Fin du temps',
  'sudden-death': 'Mort subite',
};

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;
const percent = (value: number): string => `${Math.round(value)} %`;

/** Titre de l'écran : le ou les gagnants. */
export function headline(result: MatchResult): string {
  if (result.winningTeam !== null) return `Victoire de l’équipe ${TEAM_NAMES[result.winningTeam]}`;
  if (result.winners.length === 1) return `Victoire de J${result.winners[0]! + 1}`;
  return `Égalité : ${result.winners.map((p) => `J${p + 1}`).join(', ')}`;
}

export function createResults(options: ResultsOptions): Results {
  const { panel } = options;
  const doc = panel.ownerDocument;

  function cell(row: HTMLTableRowElement, text: string, tag: 'td' | 'th' = 'td'): HTMLElement {
    const c = doc.createElement(tag);
    c.textContent = text;
    row.append(c);
    return c;
  }

  return {
    get visible() {
      return !panel.hidden;
    },
    show(result) {
      panel.replaceChildren();
      const title = doc.createElement('h2');
      title.dataset.results = 'headline';
      title.textContent = headline(result);
      const reason = doc.createElement('p');
      const seconds = Math.round(result.endFrame / 60);
      reason.textContent = `${REASONS[result.reason]} · ${Math.floor(seconds / 60)} min ${seconds % 60} s`;

      const table = doc.createElement('table');
      const head = table.createTHead().insertRow();
      const stocks = result.config.mode !== 'time' || result.players.some((p) => p.stocksLeft >= 0);
      for (const label of ['Place', 'Joueur', 'KO', 'Chutes', 'Autodestr.', 'Infligés', 'Subis']) {
        cell(head, label, 'th');
      }
      if (result.config.mode === 'time') cell(head, 'Score', 'th');
      if (stocks) cell(head, 'Vies', 'th');
      const body = table.createTBody();
      const order = result.players
        .map((p, i) => ({ p, i }))
        .sort((a, b) => a.p.placement - b.p.placement || a.i - b.i);
      for (const { p, i } of order) {
        const row = body.insertRow();
        row.dataset.results = `player-${i}`;
        cell(row, String(p.placement));
        const who = cell(row, `J${i + 1}${p.team >= 0 ? ` (${TEAM_NAMES[p.team]})` : ''}`);
        if (p.team >= 0) who.style.color = css(TEAM_COLORS[p.team]!);
        cell(row, String(p.kos));
        cell(row, String(p.falls));
        cell(row, String(p.selfDestructs));
        cell(row, percent(p.damageDealt));
        cell(row, percent(p.damageTaken));
        if (result.config.mode === 'time') cell(row, `${p.score > 0 ? '+' : ''}${p.score}`);
        if (stocks) cell(row, p.stocksLeft < 0 ? '—' : String(p.stocksLeft));
        if (p.placement === 1) row.className = 'winner';
      }

      const buttons = doc.createElement('div');
      buttons.className = 'buttons';
      for (const [label, name, run] of [
        ['Rejouer', 'replay', options.onReplay],
        ['Changer les règles', 'rules', options.onRules],
      ] as const) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.dataset.results = name;
        b.addEventListener('click', () => {
          b.blur();
          run();
        });
        buttons.append(b);
      }
      panel.append(title, reason, table, buttons);
      panel.hidden = false;
    },
    hide() {
      panel.hidden = true;
    },
  };
}
