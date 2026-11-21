/**
 * Panneau « Classement » minimal : tableau des meilleurs joueurs, ma cote et mes statistiques, mon
 * historique. L'écran final appartiendra à `app-shell` ; celui-ci sert à essayer `ranking`.
 *
 * Le serveur n'est contacté qu'à l'ouverture du panneau, et à chaque réouverture (les cotes ont pu
 * bouger) : sans lui, la démo reste jouable et ne produit aucune erreur. Les parties locales de la
 * démo ne sont jamais envoyées : seul un serveur de parties peut soumettre un résultat.
 */
import type {
  HistoryEntry,
  HistoryResponse,
  LeaderboardResponse,
  ProfileResponse,
  RankingClient,
} from '@game/ranking/client';

export interface LeaderboardPanelOptions {
  readonly panel: HTMLElement;
  readonly client: RankingClient;
}

export interface LeaderboardPanel {
  toggle(): void;
}

const MODES: Readonly<Record<HistoryEntry['mode'], string>> = {
  stock: 'Vies',
  time: 'Temps',
  stamina: 'Endurance',
};

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'offline'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly board: LeaderboardResponse;
      readonly me: ProfileResponse;
      readonly history: HistoryResponse | null;
    };

function signed(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}

export function createLeaderboardPanel(options: LeaderboardPanelOptions): LeaderboardPanel {
  const { panel, client } = options;
  const doc = panel.ownerDocument;
  let state: State = { kind: 'loading' };
  let loading = false;

  function element<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: string,
    name?: string,
  ): HTMLElementTagNameMap[K] {
    const node = doc.createElement(tag);
    // `textContent`, jamais `innerHTML` : un pseudo ne peut pas injecter de balise.
    if (text !== undefined) node.textContent = text;
    if (name !== undefined) node.dataset.ranking = name;
    return node;
  }

  function table(name: string, headers: string[], rows: string[][]): HTMLTableElement {
    const node = element('table', undefined, name);
    const head = element('tr');
    for (const h of headers) head.append(element('th', h));
    node.append(head);
    for (const row of rows) {
      const tr = element('tr');
      for (const cell of row) tr.append(element('td', cell));
      node.append(tr);
    }
    return node;
  }

  async function load(): Promise<void> {
    if (loading) return;
    loading = true;
    state = { kind: 'loading' };
    render();
    const [board, me] = await Promise.all([client.leaderboard(0, 20), client.me()]);
    if (!board.ok || !me.ok) {
      const error = !board.ok ? board.error : !me.ok ? me.error : null;
      state = { kind: 'offline', message: error?.message ?? 'Serveur du classement injoignable.' };
    } else {
      let history: HistoryResponse | null = null;
      if (me.value.profile !== null) {
        const result = await client.myMatches(undefined, 10);
        history = result.ok ? result.value : null;
      }
      state = { kind: 'ready', board: board.value, me: me.value, history };
    }
    loading = false;
    render();
  }

  function renderMe(me: ProfileResponse): HTMLElement[] {
    const nodes: HTMLElement[] = [element('h3', 'Moi')];
    const profile = me.profile;
    if (profile === null) {
      nodes.push(
        element('p', 'Ouvrez une session (panneau Compte, touche U) pour voir votre cote.', 'me'),
      );
      return nodes;
    }
    let rating: string;
    if (me.guest) rating = 'Invité : non classé. Créez un compte pour avoir une cote.';
    else if (profile.rating === null)
      rating = 'Pas encore de match classé (cote de départ : 1000).';
    else if (profile.provisional) {
      rating = `Cote ${profile.rating} (provisoire : ${profile.rankedMatches} match(s) classé(s) sur 5).`;
    } else
      rating = `Cote ${profile.rating}, ${profile.rank}ᵉ au classement (meilleure : ${profile.peakRating}).`;
    nodes.push(element('p', rating, 'me'));
    nodes.push(
      element(
        'p',
        `${profile.matchesPlayed} match(s), ${profile.wins} victoire(s), ${profile.kos} KO, ${profile.falls} chute(s).`,
        'stats',
      ),
    );
    if (profile.fighters.length > 0) {
      nodes.push(
        table(
          'fighters',
          ['Personnage', 'Joués', 'Victoires'],
          profile.fighters.map((f) => [f.fighter, String(f.played), String(f.wins)]),
        ),
      );
    }
    return nodes;
  }

  function renderHistory(history: HistoryResponse | null): HTMLElement[] {
    if (history === null) return [];
    const nodes: HTMLElement[] = [element('h3', 'Mes derniers matchs')];
    if (history.matches.length === 0) {
      nodes.push(element('p', 'Aucun match pour l’instant.', 'history'));
      return nodes;
    }
    nodes.push(
      table(
        'history',
        ['Date', 'Mode', 'Place', 'Personnage', 'Cote'],
        history.matches.map((m) => [
          new Date(m.endedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }),
          `${MODES[m.mode]}${m.teams ? ' (équipes)' : ''}`,
          `${m.placement}/${m.units}${m.left ? ' (abandon)' : ''}`,
          m.fighter,
          m.delta === null ? 'non classé' : `${signed(m.delta)} → ${m.ratingAfter}`,
        ]),
      ),
    );
    return nodes;
  }

  function render(): void {
    const nodes: HTMLElement[] = [element('h2', 'Classement')];
    if (state.kind === 'loading') {
      nodes.push(element('p', 'Chargement du classement…', 'status'));
    } else if (state.kind === 'offline') {
      const retry = element('button', 'Réessayer', 'retry');
      retry.type = 'button';
      retry.addEventListener('click', () => void load());
      nodes.push(element('p', `${state.message} Le jeu reste jouable.`, 'status'), retry);
    } else {
      const { board, me, history } = state;
      if (board.entries.length === 0) {
        nodes.push(element('p', 'Personne n’a encore 5 matchs classés.', 'board-empty'));
      } else {
        nodes.push(
          table(
            'board',
            ['Rang', 'Joueur', 'Cote', 'Matchs'],
            board.entries.map((e) => [
              String(e.rank),
              e.pseudo,
              String(e.rating),
              String(e.rankedMatches),
            ]),
          ),
        );
      }
      nodes.push(...renderMe(me), ...renderHistory(history));
      nodes.push(
        element(
          'p',
          'Les parties locales de cette démo ne comptent pas : seuls les matchs en ligne, envoyés par le serveur, sont classés.',
          'hint',
        ),
      );
    }
    panel.replaceChildren(...nodes);
  }

  return {
    toggle() {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) void load();
    },
  };
}
