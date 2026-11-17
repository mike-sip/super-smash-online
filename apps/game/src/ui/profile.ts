/** Profil, historique, classement et gestion du compte. */
import type { HistoryEntry, LeaderboardEntry, RankingProfile } from '@game/ranking/protocol';
import type { App, Screen } from '../app.ts';
import { fighterName } from '../content.ts';
import { accountsProblem, rankingProblem } from '../errors.ts';
import type { Online } from '../online.ts';
import { STANDARD_HINTS, button, hints, menu } from './components.ts';
import { el, replaceChildren } from './dom.ts';
import { authScreen } from './online.ts';

const MODES: Readonly<Record<string, string>> = {
  stock: 'Vies',
  time: 'Temps',
  stamina: 'Endurance',
};
const PAGE = 20;

function date(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

export function openProfile(app: App, online: Online): void {
  const body = el(
    'div',
    { className: 'menu', attrs: { 'aria-live': 'polite', 'aria-busy': 'true' } },
    [el('p', { text: 'Chargement…' })],
  );
  const history: HistoryEntry[] = [];
  let next: string | null = null;
  const actions = el('div', {});
  const root = el(
    'section',
    { className: 'screen', attrs: { 'aria-labelledby': 'profile-title' } },
    [el('h1', { id: 'profile-title', text: 'Profil' }), body, actions, hints(STANDARD_HINTS)],
  );

  async function load(): Promise<void> {
    body.setAttribute('aria-busy', 'true');
    const session = await online.ensureSession();
    if (session !== null) return fail(session.message);
    const [me, matches] = await Promise.all([online.ranking.me(), online.ranking.myMatches()]);
    if (!me.ok) return fail(rankingProblem(me.error).message);
    history.length = 0;
    if (matches.ok) {
      history.push(...matches.value.matches);
      next = matches.value.next;
    }
    render(me.value.profile, me.value.guest);
  }

  function fail(message: string): void {
    body.removeAttribute('aria-busy');
    replaceChildren(body, [
      el('p', { className: 'error-text', attrs: { role: 'alert' }, text: message }),
    ]);
    replaceChildren(actions, [
      menu('Actions', [
        button('Réessayer', () => void load(), { primary: true, id: 'profile-retry' }),
        button('Retour', () => app.back(), { id: 'profile-back' }),
      ]),
    ]);
    document.getElementById('profile-retry')?.focus();
  }

  function render(p: RankingProfile | null, guest: boolean): void {
    body.removeAttribute('aria-busy');
    const me = online.me;
    const ratingText =
      guest || p === null || p.rating === null
        ? 'Invité : non classé'
        : `${p.rating}${p.provisional ? ' (provisoire : moins de 5 matchs classés)' : ''}`;
    const stats =
      p === null
        ? null
        : el('table', { id: 'profile-stats' }, [
            el('caption', { className: 'visually-hidden', text: 'Statistiques' }),
            el(
              'tbody',
              {},
              (
                [
                  ['Cote', ratingText],
                  ['Rang', p.rank === null ? '—' : `${p.rank}e`],
                  ['Meilleure cote', p.peakRating === null ? '—' : String(p.peakRating)],
                  ['Matchs (dont classés)', `${p.matchesPlayed} (${p.rankedMatches})`],
                  ['Victoires', String(p.wins)],
                  ['KO / chutes', `${p.kos} / ${p.falls}`],
                ] as const
              ).map(([k, v]) =>
                el('tr', {}, [
                  el('th', { attrs: { scope: 'row' }, text: k }),
                  el('td', {
                    text: v,
                    data: k === 'Cote' ? { rating: String(p.rating ?? '') } : {},
                  }),
                ]),
              ),
            ),
          ]);
    const fighters =
      p === null || p.fighters.length === 0
        ? null
        : el('table', {}, [
            el('caption', { text: 'Par personnage' }),
            el('thead', {}, [
              el(
                'tr',
                {},
                ['Personnage', 'Matchs', 'Victoires'].map((t) =>
                  el('th', { attrs: { scope: 'col' }, text: t }),
                ),
              ),
            ]),
            el(
              'tbody',
              {},
              p.fighters.map((f) =>
                el('tr', {}, [
                  el('td', { text: fighterName(f.fighter) }),
                  el('td', { className: 'num', text: String(f.played) }),
                  el('td', { className: 'num', text: String(f.wins) }),
                ]),
              ),
            ),
          ]);
    const list = el('table', { id: 'profile-history' }, [
      el('caption', { text: 'Mes derniers matchs' }),
      el('thead', {}, [
        el(
          'tr',
          {},
          ['Date', 'Mode', 'Place', 'Personnage', 'Cote'].map((t) =>
            el('th', { attrs: { scope: 'col' }, text: t }),
          ),
        ),
      ]),
      el(
        'tbody',
        {},
        history.length === 0
          ? [
              el('tr', {}, [
                el('td', { attrs: { colspan: '5' }, text: 'Aucun match pour l’instant.' }),
              ]),
            ]
          : history.map((h) =>
              el('tr', {}, [
                el('td', { text: date(h.endedAt) }),
                el('td', {
                  text: `${MODES[h.mode] ?? h.mode}${h.teams ? ', équipes' : ''}${h.ranked ? ', classé' : ''}`,
                }),
                el('td', {
                  className: 'num',
                  text: `${h.placement}/${h.units}${h.left ? ' (parti)' : ''}`,
                }),
                el('td', { text: fighterName(h.fighter) }),
                el('td', {
                  className: 'num',
                  text: h.delta === null ? '—' : `${signed(h.delta)} → ${h.ratingAfter}`,
                }),
              ]),
            ),
      ),
    ]);
    replaceChildren(body, [
      el('p', {
        id: 'profile-name',
        text: me === null ? '' : `${me.pseudo}${me.guest ? ' (invité)' : ''}`,
      }),
      stats,
      fighters,
      list,
    ]);
    const items = [
      button('Classement', () => app.push(leaderboardScreen(app, online, p?.rank ?? null)), {
        id: 'profile-leaderboard',
        primary: true,
      }),
      next === null
        ? null
        : button('Matchs plus anciens', () => void more(), { id: 'profile-more' }),
      me?.guest === true
        ? button('Créer un compte', () => app.push(authScreen(app, online, 'convert')), {
            id: 'profile-convert',
          })
        : button('Gérer le compte', () => app.push(accountScreen(app, online)), {
            id: 'profile-account',
          }),
      me?.guest === true
        ? button('Se connecter', () => app.push(authScreen(app, online, 'login')), {
            id: 'profile-login',
          })
        : null,
      button('Retour', () => app.back(), { id: 'profile-back' }),
    ].filter((b): b is HTMLButtonElement => b !== null);
    const focusId =
      document.activeElement instanceof HTMLElement && root.contains(document.activeElement)
        ? document.activeElement.id
        : '';
    replaceChildren(actions, [menu('Actions', items)]);
    (document.getElementById(focusId) ?? items[0])?.focus();
  }

  async function more(): Promise<void> {
    if (next === null) return;
    const r = await online.ranking.myMatches(next);
    if (!r.ok) return app.toast(rankingProblem(r.error).message);
    history.push(...r.value.matches);
    next = r.value.next;
    void load();
  }

  let off: (() => void) | null = null;
  app.push({
    id: 'profile',
    back: 'pop',
    root,
    shown() {
      void load();
      off = online.onChange(() => void load());
    },
    hidden() {
      off?.();
      off = null;
    },
  });
}

function leaderboardScreen(app: App, online: Online, myRank: number | null): Screen {
  let offset = 0;
  const body = el('div', { attrs: { 'aria-live': 'polite' } });
  const nav = el('div', { className: 'row' });
  const root = el('section', { className: 'screen', attrs: { 'aria-labelledby': 'lb-title' } }, [
    el('header', {}, [
      el('h1', { id: 'lb-title', text: 'Classement' }),
      el('span', {
        className: 'muted',
        text:
          myRank === null
            ? 'Vous n’êtes pas encore classé (5 matchs classés).'
            : `Votre rang : ${myRank}e`,
      }),
    ]),
    body,
    nav,
    hints(STANDARD_HINTS),
  ]);

  async function load(): Promise<void> {
    const r = await online.ranking.leaderboard(offset, PAGE);
    if (!r.ok) {
      replaceChildren(body, [
        el('p', {
          className: 'error-text',
          attrs: { role: 'alert' },
          text: rankingProblem(r.error).message,
        }),
      ]);
      replaceChildren(nav, [
        button('Réessayer', () => void load(), { id: 'lb-retry', primary: true }),
        button('Retour', () => app.back(), { id: 'lb-back' }),
      ]);
      document.getElementById('lb-retry')?.focus();
      return;
    }
    const { total, entries } = r.value;
    const meId = online.me?.id;
    replaceChildren(body, [
      el('table', { id: 'lb-table' }, [
        el('caption', { className: 'visually-hidden', text: `Classement, ${total} joueurs` }),
        el('thead', {}, [
          el(
            'tr',
            {},
            ['Rang', 'Joueur', 'Cote', 'Matchs classés', 'Victoires'].map((t) =>
              el('th', { attrs: { scope: 'col' }, text: t }),
            ),
          ),
        ]),
        el(
          'tbody',
          {},
          entries.length === 0
            ? [
                el('tr', {}, [
                  el('td', {
                    attrs: { colspan: '5' },
                    text: 'Personne n’est encore classé : jouez 5 parties rapides pour apparaître ici.',
                  }),
                ]),
              ]
            : entries.map((e: LeaderboardEntry) =>
                el('tr', { className: e.accountId === meId ? 'me' : '' }, [
                  el('td', { className: 'num', text: String(e.rank) }),
                  el('th', { attrs: { scope: 'row' }, text: e.pseudo }),
                  el('td', { className: 'num', text: String(e.rating) }),
                  el('td', { className: 'num', text: String(e.rankedMatches) }),
                  el('td', { className: 'num', text: String(e.wins) }),
                ]),
              ),
        ),
      ]),
      el('p', {
        className: 'muted',
        text: total === 0 ? '' : `${offset + 1} à ${Math.min(total, offset + PAGE)} sur ${total}`,
      }),
    ]);
    const prev = button(
      'Précédents',
      () => {
        offset = Math.max(0, offset - PAGE);
        void load();
      },
      { id: 'lb-prev', disabled: offset === 0 },
    );
    const nextB = button(
      'Suivants',
      () => {
        offset += PAGE;
        void load();
      },
      { id: 'lb-next', disabled: offset + PAGE >= total },
    );
    const mine = button(
      'Ma position',
      () => {
        offset = Math.floor(((myRank ?? 1) - 1) / PAGE) * PAGE;
        void load();
      },
      { id: 'lb-mine', disabled: myRank === null },
    );
    const focusId =
      document.activeElement instanceof HTMLElement && root.contains(document.activeElement)
        ? document.activeElement.id
        : '';
    replaceChildren(nav, [
      prev,
      nextB,
      mine,
      button('Retour', () => app.back(), { id: 'lb-back' }),
    ]);
    const target = document.getElementById(focusId) as HTMLButtonElement | null;
    (target && !target.disabled ? target : document.getElementById('lb-back'))?.focus();
  }

  return { id: 'leaderboard', back: 'pop', root, shown: () => void load() };
}

function accountScreen(app: App, online: Online): Screen {
  const message = el('p', { id: 'account-message', attrs: { 'aria-live': 'assertive' } });
  const say = (text: string, ok: boolean): void => {
    message.textContent = text;
    message.className = ok ? 'ok-text' : 'error-text';
  };
  const pseudo = el('input', {
    id: 'account-pseudo',
    attrs: { type: 'text', autocomplete: 'username', maxlength: '32', spellcheck: 'false' },
  });
  pseudo.value = online.me?.pseudo ?? '';
  const current = el('input', {
    id: 'account-current',
    attrs: { type: 'password', autocomplete: 'current-password' },
  });
  const nextPw = el('input', {
    id: 'account-new',
    attrs: { type: 'password', autocomplete: 'new-password' },
  });
  const remove = el('input', {
    id: 'account-delete-password',
    attrs: { type: 'password', autocomplete: 'current-password' },
  });

  const root = el(
    'section',
    { className: 'screen', attrs: { 'aria-labelledby': 'account-title' } },
    [
      el('h1', { id: 'account-title', text: 'Mon compte' }),
      message,
      el('div', { className: 'panel' }, [
        el('label', { className: 'field', attrs: { for: 'account-pseudo' }, text: 'Pseudo' }),
        pseudo,
        button(
          'Changer de pseudo',
          async () => {
            const r = await online.accounts.updateProfile({ pseudo: pseudo.value.trim() });
            if (!r.ok) return say(accountsProblem(r.error).message, false);
            online.setMe(r.value);
            say('Pseudo changé.', true);
          },
          { id: 'account-rename' },
        ),
      ]),
      el('div', { className: 'panel' }, [
        el('label', {
          className: 'field',
          attrs: { for: 'account-current' },
          text: 'Mot de passe actuel',
        }),
        current,
        el('label', {
          className: 'field',
          attrs: { for: 'account-new' },
          text: 'Nouveau mot de passe',
        }),
        nextPw,
        button(
          'Changer de mot de passe',
          async () => {
            const r = await online.accounts.changePassword(current.value, nextPw.value);
            current.value = '';
            nextPw.value = '';
            if (!r.ok) return say(accountsProblem(r.error).message, false);
            say('Mot de passe changé.', true);
          },
          { id: 'account-password' },
        ),
      ]),
      menu('Compte', [
        button(
          'Se déconnecter',
          () =>
            app.confirm('Se déconnecter ? Vous pourrez rejouer en invité.', [
              {
                label: 'Se déconnecter',
                action: async () => {
                  await online.accounts.logout();
                  online.setMe(null);
                  app.popTo('main-menu');
                  app.toast('Déconnecté.');
                },
              },
              { label: 'Annuler', action: () => {}, primary: true },
            ]),
          { id: 'account-logout' },
        ),
        button('Retour', () => app.back(), { id: 'account-back' }),
      ]),
      el('div', { className: 'panel' }, [
        el('h2', { text: 'Supprimer le compte' }),
        el('p', {
          className: 'muted',
          text: 'Votre cote, vos statistiques et votre historique seront effacés. Les autres joueurs verront « Joueur supprimé ». C’est définitif.',
        }),
        el('label', {
          className: 'field',
          attrs: { for: 'account-delete-password' },
          text: 'Mot de passe',
        }),
        remove,
        button(
          'Supprimer mon compte',
          () =>
            app.confirm('Supprimer définitivement votre compte ?', [
              {
                label: 'Supprimer',
                action: async () => {
                  const r = await online.accounts.deleteAccount(remove.value);
                  remove.value = '';
                  if (!r.ok) return say(accountsProblem(r.error).message, false);
                  online.setMe(null);
                  app.popTo('main-menu');
                  app.toast('Compte supprimé.');
                },
              },
              { label: 'Annuler', action: () => {}, primary: true },
            ]),
          { id: 'account-delete', danger: true },
        ),
      ]),
    ],
  );
  return { id: 'account', back: 'pop', root };
}
