/**
 * Écrans du jeu en ligne : accueil, connexion et inscription, rejoindre par code, salon (privé
 * ou rapide), partie rapide. Ils se redessinent à chaque changement du lobby ou du compte, en
 * gardant le focus sur le même élément.
 */
import type { MatchMode } from '@game/match-rules';
import type { RoomRules, RoomView } from '@game/lobby/protocol';
import type { ItemFrequency } from '@game/stages-items';
import type { App, Screen } from '../app.ts';
import { CONTENT_IDS } from '../content-ids.ts';
import { FIGHTER_INFO, RANDOM, fighterName, stageName } from '../content.ts';
import { accountsProblem } from '../errors.ts';
import type { Online } from '../online.ts';
import { STANDARD_HINTS, button, choice, hints, menu, toggle } from './components.ts';
import { el, replaceChildren } from './dom.ts';
import { TEAM_NAMES } from './results.ts';

const REGION = 'eu';

/** Code affiché `ABC-DEF`. */
export function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

/** Saisie tolérante : majuscules, sans espaces ni tirets. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

/** Écran qui se redessine à chaque changement en ligne, focus gardé (par identifiant). */
function liveScreen(
  app: App,
  online: Online,
  id: string,
  build: () => (Node | string | null | false)[],
  extra: Partial<Screen> = {},
): Screen & { refresh(): void } {
  const root = el('section', { className: 'screen', attrs: { 'aria-label': id } });
  let off: (() => void) | null = null;
  const refresh = (): void => {
    const active = document.activeElement as HTMLElement | null;
    const focusId = active !== null && root.contains(active) ? active.id : '';
    replaceChildren(root, build());
    if (focusId !== '') document.getElementById(focusId)?.focus();
    else if (root.isConnected && !root.contains(document.activeElement)) {
      (
        root.querySelector<HTMLElement>('[data-autofocus]') ??
        root.querySelector<HTMLElement>('button:not([disabled])')
      )?.focus();
    }
  };
  refresh();
  return {
    id,
    back: 'pop',
    root,
    ...extra,
    refresh,
    shown() {
      off = online.onChange(refresh);
      refresh();
      extra.shown?.();
    },
    hidden() {
      off?.();
      off = null;
      extra.hidden?.();
    },
  };
}

// --- Accueil -----------------------------------------------------------------------------

export function openOnline(app: App, online: Online, code?: string): void {
  const loading = el('section', { className: 'screen center', attrs: { 'aria-busy': 'true' } }, [
    el('p', { text: 'Connexion…' }),
  ]);
  app.push({ id: 'online-loading', back: 'pop', root: loading });
  void online.ensureSession().then((problem) => {
    if (app.top().id !== 'online-loading') return;
    if (problem !== null) {
      app.replace(
        errorPanel(app, 'online-error', problem.message, () => openOnlineAgain(app, online, code)),
      );
      return;
    }
    online.connect();
    app.replace(onlineHome(app, online));
    if (code !== undefined) {
      // Le lobby n'accepte les commandes qu'une fois la connexion établie.
      const lobby = online.lobby!;
      const join = (): boolean => {
        if (lobby.state.status !== 'online') return false;
        lobby.joinRoom(normalizeCode(code));
        return true;
      };
      if (!join()) {
        const off = lobby.onChange(() => {
          if (join()) off();
        });
      }
    }
  });
}

function openOnlineAgain(app: App, online: Online, code?: string): void {
  app.pop();
  openOnline(app, online, code);
}

function errorPanel(app: App, id: string, message: string, retry: () => void): Screen {
  const again = button('Réessayer', retry, { primary: true, id: `${id}-retry` });
  again.dataset.autofocus = '';
  const root = el('section', { className: 'screen center', attrs: { role: 'alert' } }, [
    el('p', { text: message }),
    menu('Actions', [
      again,
      button('Menu principal', () => app.popTo('main-menu'), { id: `${id}-menu` }),
    ]),
  ]);
  return { id, back: 'pop', root };
}

function onlineHome(app: App, online: Online): Screen {
  let pendingRoom = false;
  const screen = liveScreen(app, online, 'online-home', () => {
    const me = online.me;
    const state = online.lobby?.state;
    // Entré dans un salon (créé, rejoint, ou groupe de partie rapide formé) : on y va.
    if (state?.room != null && app.top().id === 'online-home' && !pendingRoom) {
      pendingRoom = true;
      queueMicrotask(() => {
        pendingRoom = false;
        if (app.top().id === 'online-home' && online.lobby?.state.room)
          app.push(roomScreen(app, online));
      });
    }
    const who = me === null ? '' : me.guest ? `${me.pseudo} (invité)` : me.pseudo;
    const create = button('Créer un salon privé', () => online.lobby?.createRoom(), {
      id: 'online-create',
      primary: true,
      detail: 'Jouez avec vos amis, par un code',
    });
    create.dataset.autofocus = '';
    return [
      el('header', {}, [
        el('h1', { text: 'En ligne' }),
        el('span', { className: 'muted', id: 'online-who', text: who }),
      ]),
      me?.guest === true
        ? el('div', { className: 'panel', attrs: { role: 'note' } }, [
            el('p', { text: 'Vous jouez en invité : votre cote n’est pas enregistrée.' }),
            el('div', { className: 'row' }, [
              button('Créer un compte', () => app.push(authScreen(app, online, 'convert')), {
                id: 'online-convert',
              }),
              button('Se connecter', () => app.push(authScreen(app, online, 'login')), {
                id: 'online-login',
              }),
            ]),
          ])
        : null,
      menu('En ligne', [
        create,
        button('Rejoindre un salon', () => app.push(joinScreen(app, online)), {
          id: 'online-join',
          detail: 'Avec un code à 6 caractères',
        }),
        button('Partie rapide', () => app.push(queueScreen(app, online)), {
          id: 'online-quick',
          detail: 'Contre d’autres joueurs, classée',
        }),
        button('Retour', () => app.back(), { id: 'online-back' }),
      ]),
      hints(STANDARD_HINTS),
    ];
  });
  return screen;
}

// --- Connexion, inscription, conversion d'un invité ------------------------------------------

type AuthMode = 'login' | 'register' | 'convert';

const AUTH_TITLES: Readonly<Record<AuthMode, string>> = {
  login: 'Se connecter',
  register: 'Créer un compte',
  convert: 'Créer un compte',
};

export function authScreen(app: App, online: Online, mode: AuthMode): Screen {
  const pseudo = el('input', {
    id: 'auth-pseudo',
    attrs: {
      type: 'text',
      autocomplete: 'username',
      maxlength: '32',
      spellcheck: 'false',
      'data-autofocus': '',
    },
  });
  const password = el('input', {
    id: 'auth-password',
    attrs: {
      type: 'password',
      autocomplete: mode === 'login' ? 'current-password' : 'new-password',
      maxlength: '256',
    },
  });
  if (mode === 'convert' && online.me?.guest === true) pseudo.value = online.me.pseudo;
  const message = el('p', {
    className: 'error-text',
    id: 'auth-message',
    attrs: { 'aria-live': 'assertive' },
  });
  const submit = button(AUTH_TITLES[mode], () => void send(), { primary: true, id: 'auth-submit' });
  let busy = false;

  async function send(): Promise<void> {
    if (busy) return;
    busy = true;
    submit.disabled = true;
    message.textContent = '';
    const p = pseudo.value.trim();
    const pw = password.value;
    const r =
      mode === 'login'
        ? await online.accounts.login(p, pw)
        : mode === 'convert'
          ? await online.accounts.convert(p, pw)
          : await online.accounts.register(p, pw);
    busy = false;
    submit.disabled = false;
    password.value = '';
    if (!r.ok) {
      message.textContent = accountsProblem(r.error).message;
      password.focus();
      return;
    }
    online.setMe(r.value);
    app.toast(
      mode === 'login' ? `Bienvenue, ${r.value.pseudo} !` : `Compte créé : ${r.value.pseudo}`,
    );
    app.pop();
  }

  const form = el('form', { className: 'panel', attrs: { 'aria-labelledby': 'auth-title' } }, [
    el('label', { className: 'field', attrs: { for: 'auth-pseudo' }, text: 'Pseudo' }),
    pseudo,
    el('label', { className: 'field', attrs: { for: 'auth-password' }, text: 'Mot de passe' }),
    password,
    el('p', {
      className: 'muted',
      text:
        mode === 'login'
          ? 'Pas d’e-mail : votre pseudo et votre mot de passe suffisent.'
          : 'Au moins 10 caractères. Pas d’e-mail : notez bien votre mot de passe, il ne peut pas être récupéré.',
    }),
    message,
    submit,
    mode === 'login'
      ? button(
          'Je n’ai pas de compte',
          () => app.replace(authScreen(app, online, online.me?.guest ? 'convert' : 'register')),
          { id: 'auth-switch' },
        )
      : button('J’ai déjà un compte', () => app.replace(authScreen(app, online, 'login')), {
          id: 'auth-switch',
        }),
    button('Annuler', () => app.back(), { id: 'auth-cancel' }),
  ]);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void send();
  });
  for (const input of [pseudo, password]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void send();
      }
    });
  }
  const root = el('section', { className: 'screen' }, [
    el('h1', { id: 'auth-title', text: AUTH_TITLES[mode] }),
    form,
  ]);
  return { id: 'online-auth', back: 'pop', root };
}

// --- Rejoindre par code --------------------------------------------------------------------

function joinScreen(app: App, online: Online): Screen {
  const input = el('input', {
    id: 'join-code',
    attrs: {
      type: 'text',
      autocomplete: 'off',
      spellcheck: 'false',
      maxlength: '9',
      placeholder: 'ABC-DEF',
      'data-autofocus': '',
      inputmode: 'text',
    },
  });
  const go = (): void => {
    const code = normalizeCode(input.value);
    if (code.length !== 6) {
      app.toast('Le code fait 6 caractères (par exemple ABC-DEF).');
      return;
    }
    app.pop();
    online.lobby?.joinRoom(code);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      go();
    }
  });
  const root = el('section', { className: 'screen' }, [
    el('h1', { text: 'Rejoindre un salon' }),
    el('div', { className: 'panel' }, [
      el('label', {
        className: 'field',
        attrs: { for: 'join-code' },
        text: 'Code du salon (donné par votre ami)',
      }),
      input,
      button('Rejoindre', go, { primary: true, id: 'join-submit' }),
      button('Annuler', () => app.back(), { id: 'join-cancel' }),
    ]),
  ]);
  return { id: 'online-join', back: 'pop', root };
}

// --- Salon ---------------------------------------------------------------------------------

const ITEM_CHOICES: readonly { value: ItemFrequency; label: string }[] = [
  { value: 'off', label: 'Aucun' },
  { value: 'low', label: 'Rares' },
  { value: 'normal', label: 'Normaux' },
  { value: 'high', label: 'Fréquents' },
];

/** Pourquoi l'hôte ne peut pas encore lancer, ou `null`. */
export function startBlocker(room: RoomView, me: string): string | null {
  if (room.members.length < 2) return 'Il faut au moins deux joueurs.';
  if (room.members.some((m) => !m.connected)) return 'Un joueur est déconnecté.';
  if (room.members.some((m) => m.fighter === null)) return 'Chacun doit choisir un personnage.';
  if (room.members.some((m) => m.id !== me && !m.ready)) return 'Tout le monde n’est pas prêt.';
  if (room.rules.teams && new Set(room.members.map((m) => m.team)).size < 2) {
    return 'En équipes, il faut au moins deux équipes.';
  }
  return null;
}

function roomScreen(app: App, online: Online): Screen {
  const lobby = online.lobby!;
  let left = false;
  let defaultSent = false;
  const leave = (): void => {
    left = true;
    lobby.leaveRoom();
    app.pop();
  };
  const screen = liveScreen(
    app,
    online,
    'online-room',
    () => {
      const state = lobby.state;
      const room = state.room;
      const me = state.you?.id ?? '';
      if (room === null) {
        if (!left && app.top().id === 'online-room') {
          queueMicrotask(() => {
            if (app.top().id === 'online-room') {
              app.toast('Vous n’êtes plus dans le salon.');
              app.pop();
            }
          });
        }
        return [el('p', { text: 'Salon fermé.' })];
      }
      const host = room.host === me;
      const mine = room.members.find((m) => m.id === me);
      // Personnage par défaut à l'arrivée (favori du profil, sinon le premier) : prêt tout de suite.
      if (mine !== undefined && mine.fighter === null && room.phase === 'lobby' && !defaultSent) {
        defaultSent = true;
        const fav = online.me?.favoriteFighter;
        lobby.setFighter(
          fav && (CONTENT_IDS.fighters as readonly string[]).includes(fav)
            ? fav
            : CONTENT_IDS.fighters[0],
        );
      }
      const quick = room.kind === 'quick';
      const lobbyPhase = room.phase === 'lobby';
      const r = room.rules;
      const setRules = (change: Partial<RoomRules>): void =>
        lobby.setRules({ rules: { ...r, ...change } });

      const fighter = choice(
        'Mon personnage',
        [...CONTENT_IDS.fighters, RANDOM].map((id) => ({ value: id, label: fighterName(id) })),
        mine?.fighter ?? CONTENT_IDS.fighters[0],
        (id) => lobby.setFighter(id),
        'room-fighter',
      );
      fighter.element.disabled = !lobbyPhase;
      const blocker = startBlocker(room, me);
      const controls: HTMLElement[] = [fighter.element];
      if (r.teams && !quick) {
        controls.push(
          choice(
            'Mon équipe',
            TEAM_NAMES.map((n, t) => ({ value: t, label: `${t + 1} — ${n}` })),
            mine?.team ?? 0,
            (t) => lobby.setTeam(t),
            'room-team',
          ).element,
        );
      }
      if (!host) {
        const ready = button(
          mine?.ready ? 'Je ne suis plus prêt' : 'Je suis prêt',
          () => lobby.setReady(!(mine?.ready ?? false)),
          {
            id: 'room-ready',
            primary: !(mine?.ready ?? false),
          },
        );
        ready.disabled = !lobbyPhase || mine?.fighter == null;
        controls.push(ready);
      } else {
        const start = button('Lancer la partie', () => lobby.start(), {
          id: 'room-start',
          primary: true,
          detail: blocker ?? 'Tout le monde est prêt',
        });
        start.disabled = blocker !== null || !lobbyPhase;
        controls.push(start);
      }
      controls.push(button('Quitter le salon', leave, { id: 'room-leave' }));
      if (controls[0] !== undefined) controls[0].dataset.autofocus = '';

      const hostControls: HTMLElement[] = [];
      if (host && !quick) {
        const modeC = choice<MatchMode>(
          'Mode',
          [
            { value: 'stock', label: 'Vies' },
            { value: 'time', label: 'Temps' },
            { value: 'stamina', label: 'Endurance' },
          ],
          r.mode,
          (m) =>
            setRules({ mode: m, timeLimit: m === 'time' && r.timeLimit === 0 ? 120 : r.timeLimit }),
          'room-mode',
        );
        const stocks = choice(
          'Vies',
          Array.from({ length: 10 }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
          r.stocks,
          (v) => setRules({ stocks: v }),
          'room-stocks',
        );
        stocks.element.disabled = r.mode !== 'stock';
        const time = choice(
          'Temps',
          [0, 30, 60, 120, 180, 300, 420, 600].map((s) => ({
            value: s,
            label: s === 0 ? 'Sans limite' : s < 60 ? `${s} s` : `${s / 60} min`,
          })),
          r.timeLimit,
          (v) => setRules({ timeLimit: v }),
          'room-time',
        );
        const stamina = choice(
          'Points de vie',
          [50, 100, 150, 200, 300].map((v) => ({ value: v, label: `${v} PV` })),
          r.stamina,
          (v) => setRules({ stamina: v }),
          'room-stamina',
        );
        stamina.element.disabled = r.mode !== 'stamina';
        hostControls.push(
          choice(
            'Stage',
            [...CONTENT_IDS.stages, RANDOM].map((id) => ({ value: id, label: stageName(id) })),
            room.stage,
            (s) => lobby.setRules({ stage: s }),
            'room-stage',
          ).element,
          modeC.element,
          stocks.element,
          time.element,
          stamina.element,
          toggle('Équipes', r.teams, (v) => setRules({ teams: v }), 'room-teams').element,
          toggle('Attaque ultime', r.ultimate, (v) => setRules({ ultimate: v }), 'room-ultimate')
            .element,
          choice(
            'Objets',
            ITEM_CHOICES,
            r.items.enabled ? r.items.frequency : 'off',
            (v) =>
              setRules({
                items:
                  v === 'off'
                    ? { enabled: false, frequency: 'normal' }
                    : { enabled: true, frequency: v },
              }),
            'room-items',
          ).element,
          toggle(
            'Salon verrouillé',
            room.locked,
            (v) => lobby.setRules({ locked: v }),
            'room-locked',
          ).element,
        );
        for (const c of hostControls) (c as HTMLButtonElement).disabled ||= !lobbyPhase;
      }

      const link = `${location.origin}${location.pathname}#rejoindre=${room.code ?? ''}`;
      const members = el('table', { id: 'room-members' }, [
        el('caption', { className: 'visually-hidden', text: 'Joueurs du salon' }),
        el('thead', {}, [
          el(
            'tr',
            {},
            [
              'Joueur',
              'Personnage',
              r.teams ? 'Équipe' : null,
              'État',
              'Ping',
              host && !quick ? 'Action' : null,
            ]
              .filter((x) => x !== null)
              .map((t) => el('th', { attrs: { scope: 'col' }, text: t! })),
          ),
        ]),
        el(
          'tbody',
          {},
          room.members.map((m) =>
            el('tr', { className: m.id === me ? 'me' : '' }, [
              el('th', {
                attrs: { scope: 'row' },
                text: `${m.name}${m.guest ? ' (invité)' : ''}${m.id === room.host ? ' ★ hôte' : ''}`,
              }),
              el('td', { text: fighterName(m.fighter) }),
              r.teams ? el('td', { text: TEAM_NAMES[m.team] ?? '—' }) : null,
              el('td', {
                text: !m.connected
                  ? 'Déconnecté'
                  : m.id === room.host
                    ? 'Hôte'
                    : m.ready
                      ? 'Prêt'
                      : 'Choisit…',
              }),
              el('td', { className: 'num', text: m.rttMs === null ? '—' : `${m.rttMs} ms` }),
              host && !quick
                ? el('td', {}, [
                    m.id === me
                      ? null
                      : button(
                          'Expulser',
                          () =>
                            app.confirm(`Expulser ${m.name} du salon ?`, [
                              { label: 'Expulser', action: () => lobby.kick(m.id) },
                              { label: 'Annuler', action: () => {}, primary: true },
                            ]),
                          { id: `room-kick-${m.id}`, danger: true },
                        ),
                  ])
                : null,
            ]),
          ),
        ),
      ]);
      const end = room.lastEnd;
      return [
        el('header', {}, [
          el('h1', { text: quick ? 'Partie rapide' : 'Salon privé' }),
          room.code === null
            ? null
            : el('span', {
                className: 'code',
                id: 'room-code',
                data: { code: room.code },
                attrs: { 'aria-label': `Code du salon : ${room.code.split('').join(' ')}` },
                text: formatCode(room.code),
              }),
          room.code === null
            ? null
            : button(
                'Copier le lien',
                () =>
                  void navigator.clipboard?.writeText(link).then(
                    () => app.toast('Lien copié.'),
                    () => app.toast(`Lien : ${link}`),
                  ),
                { id: 'room-copy' },
              ),
        ]),
        el('p', {
          className: 'muted',
          attrs: { 'aria-live': 'polite' },
          text:
            room.phase === 'countdown'
              ? `Lancement dans ${state.countdown ?? '…'} s`
              : room.phase === 'playing'
                ? 'Partie en cours…'
                : quick
                  ? 'La revanche part quand tout le monde est prêt.'
                  : `${stageName(room.stage)} · ${r.mode === 'stock' ? `${r.stocks} vies` : r.mode === 'time' ? 'Temps' : `${r.stamina} PV`} · ${room.members.length}/${room.capacity} joueurs${room.locked ? ' · verrouillé' : ''}`,
        }),
        end !== null && end.status !== 'agreed'
          ? el('p', { className: 'error-text', text: end.message })
          : null,
        members,
        el('div', { className: 'menu' }, controls),
        hostControls.length > 0
          ? el(
              'div',
              {
                className: 'panel',
                attrs: { role: 'group', 'aria-labelledby': 'room-rules-title' },
              },
              [
                el('h2', { id: 'room-rules-title', text: 'Règles du salon' }),
                el('div', { className: 'menu' }, hostControls),
              ],
            )
          : null,
        hints(STANDARD_HINTS),
      ];
    },
    {
      back: 'confirm',
      onBack: () =>
        app.confirm('Quitter le salon ?', [
          { label: 'Quitter', action: leave },
          { label: 'Rester', action: () => {}, primary: true },
        ]),
    },
  );
  return screen;
}

// --- Partie rapide ---------------------------------------------------------------------------

function queueScreen(app: App, online: Online): Screen {
  const lobby = online.lobby!;
  let fighter: string =
    online.me?.favoriteFighter && CONTENT_IDS.fighters.includes(online.me.favoriteFighter as never)
      ? online.me.favoriteFighter
      : CONTENT_IDS.fighters[0];
  let since = 0;
  let moved = false;
  const screen = liveScreen(
    app,
    online,
    'online-queue',
    () => {
      const state = lobby.state;
      if (state.room !== null && !moved) {
        moved = true;
        queueMicrotask(() => {
          if (app.top().id === 'online-queue') app.replace(roomScreen(app, online));
        });
      }
      const queued = state.queue !== null;
      if (queued && since === 0) since = performance.now();
      if (!queued) since = 0;
      const pick = choice(
        'Personnage',
        CONTENT_IDS.fighters.map((id) => ({ value: id, label: fighterName(id) })),
        fighter,
        (id) => (fighter = id),
        'queue-fighter',
      );
      pick.element.disabled = queued;
      const go = queued
        ? button('Annuler la recherche', () => lobby.leaveQueue(), {
            id: 'queue-cancel',
            primary: true,
          })
        : button('Chercher une partie', () => lobby.queue(REGION, fighter), {
            id: 'queue-go',
            primary: true,
            detail: 'Europe',
          });
      go.dataset.autofocus = '';
      const rules = state.quickRules;
      return [
        el('h1', { text: 'Partie rapide' }),
        el('p', {
          className: 'muted',
          text:
            rules === null
              ? ''
              : `Règles : ${rules.stocks} vies, ${Math.round(rules.timeLimit / 60)} min, chacun pour soi, objets et ultime. Stage au hasard. Partie classée.`,
        }),
        el('p', {
          id: 'queue-status',
          attrs: { 'aria-live': 'polite' },
          text: queued
            ? `Recherche d’adversaires… ${state.queue!.waiting} joueur(s) en attente.`
            : 'Choisissez votre personnage puis lancez la recherche.',
        }),
        FIGHTER_INFO[fighter]
          ? el('p', { className: 'muted', text: FIGHTER_INFO[fighter]!.summary })
          : null,
        menu('Partie rapide', [
          pick.element,
          go,
          button('Retour', () => app.back(), { id: 'queue-back' }),
        ]),
        hints(STANDARD_HINTS),
      ];
    },
    {
      hidden() {
        if (lobby.state.queue !== null && lobby.state.room === null) lobby.leaveQueue();
      },
    },
  );
  return screen;
}
