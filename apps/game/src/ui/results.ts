/** Écran de résultats, commun au combat local et en ligne. */
import type { MatchResult } from '@game/match-rules';
import type { App, Screen } from '../app.ts';
import { fighterName } from '../content.ts';
import { portraitUrl } from '../portraits.ts';
import { victoryJingle } from '../music.ts';
import { button, menu } from './components.ts';
import { el } from './dom.ts';

const REASONS: Readonly<Record<MatchResult['reason'], string>> = {
  'last-standing': 'Dernier en lice',
  time: 'Temps écoulé',
  'sudden-death': 'Mort subite',
};

export const TEAM_NAMES = ['Rouge', 'Bleue', 'Verte', 'Jaune'];

export interface ResultsOptions {
  readonly result: MatchResult;
  /** Nom de chaque joueur, dans l'ordre des places (« J1 », pseudo…). */
  readonly names: readonly string[];
  readonly fighters: readonly string[];
  /** Couleur alternative de chaque joueur, pour le portrait du vainqueur. */
  readonly palettes?: readonly number[];
  /** Place du joueur de ce navigateur (en ligne), mise en valeur. */
  readonly me?: number;
  readonly note?: string | null;
  readonly actions: readonly { id: string; label: string; action: () => void; primary?: boolean }[];
  readonly back: () => void;
}

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function resultsScreen(app: App, options: ResultsOptions): Screen {
  const { result } = options;
  const winners = result.winners.map((p) => options.names[p] ?? `J${p + 1}`);
  const title =
    result.config.teams && result.winningTeam !== null
      ? `Victoire de l’équipe ${TEAM_NAMES[result.winningTeam] ?? result.winningTeam + 1} !`
      : winners.length === 1
        ? `Victoire de ${winners[0]} !`
        : `Égalité : ${winners.join(', ')}`;
  const order = result.players
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.placement - b.p.placement || a.i - b.i);
  const stamina = result.config.mode === 'stamina';
  const rows = order.map(({ p, i }) =>
    el('tr', { className: i === options.me ? 'me' : '' }, [
      el('td', { className: 'num', text: `${p.placement}` }),
      el('th', { attrs: { scope: 'row' }, text: options.names[i] ?? `J${i + 1}` }),
      el('td', { text: fighterName(options.fighters[i] ?? null) }),
      result.config.teams ? el('td', { text: TEAM_NAMES[p.team] ?? '—' }) : null,
      el('td', { className: 'num', text: String(p.kos) }),
      el('td', { className: 'num', text: String(p.falls) }),
      el('td', { className: 'num', text: `${fmt(p.damageDealt)} ${stamina ? 'PV' : '%'}` }),
      el('td', { className: 'num', text: `${fmt(p.damageTaken)} ${stamina ? 'PV' : '%'}` }),
    ]),
  );
  const table = el('table', { id: 'results-table' }, [
    el('caption', { className: 'visually-hidden', text: 'Résultats du match' }),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { className: 'num', text: 'Place', attrs: { scope: 'col' } }),
        el('th', { text: 'Joueur', attrs: { scope: 'col' } }),
        el('th', { text: 'Personnage', attrs: { scope: 'col' } }),
        result.config.teams ? el('th', { text: 'Équipe', attrs: { scope: 'col' } }) : null,
        el('th', { className: 'num', text: 'KO', attrs: { scope: 'col' } }),
        el('th', { className: 'num', text: 'Chutes', attrs: { scope: 'col' } }),
        el('th', { className: 'num', text: 'Infligés', attrs: { scope: 'col' } }),
        el('th', { className: 'num', text: 'Reçus', attrs: { scope: 'col' } }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);
  // Le vainqueur en figurine, dans une pose de victoire tirée au hasard.
  const champion = result.winners[0];
  const art =
    champion === undefined
      ? undefined
      : portraitUrl(
          options.fighters[champion] ?? '',
          options.palettes?.[champion] ?? 0,
          'victory',
          420,
          Math.floor(Math.random() * 3),
        );
  const buttons = options.actions.map((a) =>
    button(a.label, a.action, { id: a.id, primary: a.primary === true }),
  );
  if (buttons[0] !== undefined) buttons[0].dataset.autofocus = '';
  const root = el(
    'section',
    { className: 'screen', attrs: { 'aria-labelledby': 'results-title' } },
    [
      art === undefined
        ? null
        : el('img', { className: 'victory-art', attrs: { src: art, alt: '' } }),
      el('header', {}, [
        el('h1', { id: 'results-title', text: title }),
        el('span', { className: 'muted', text: REASONS[result.reason] }),
      ]),
      options.note
        ? el('p', { className: 'error-text', attrs: { role: 'note' }, text: options.note })
        : null,
      table,
      menu('Suite', buttons),
    ],
  );
  return {
    id: 'results',
    // « Retour » : l'action de l'appelant (sélection des personnages, salon…).
    back: 'confirm',
    root,
    shown: () => {
      app.announce(title);
      // La musique du combat s'arrête ; le jingle du vainqueur (s'il y en a un seul) retentit.
      app.audio.setIntensity(0);
      app.audio.playMusic(null);
      const jingle =
        champion === undefined ? null : victoryJingle(options.fighters[champion] ?? '');
      if (jingle !== null && result.winners.length === 1) app.audio.playJingle(jingle);
    },
    onBack: options.back,
  };
}
