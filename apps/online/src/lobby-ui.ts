/**
 * Écrans minimaux du lobby pour la démo (les écrans définitifs appartiendront à `app-shell`) :
 * menu (salon privé, rejoindre par code, partie rapide), salon, derniers résultats. Tout le texte
 * qui vient d'autres joueurs (pseudos) passe par `textContent`, jamais par `innerHTML`.
 */
import type { LobbyClient, LobbyState } from '@game/lobby/client';
import type { MemberView, RoomRules } from '@game/lobby/protocol';
import { fighterName, stageName } from './content.ts';

type Child = Node | string;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

function button(
  label: string,
  onClick: () => void,
  props: Record<string, string> = {},
): HTMLButtonElement {
  const b = el('button', { type: 'button', ...props, text: label });
  b.addEventListener('click', onClick);
  return b;
}

function select(
  options: readonly { value: string; label: string }[],
  value: string,
  onChange: (value: string) => void,
  props: Record<string, string> = {},
): HTMLSelectElement {
  const s = el('select', props);
  for (const o of options) {
    const opt = el('option', { value: o.value, text: o.label });
    if (o.value === value) opt.selected = true;
    s.append(opt);
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function formatCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

const MODES = [
  { value: 'stock', label: 'Stock' },
  { value: 'time', label: 'Temps' },
  { value: 'stamina', label: 'Endurance' },
];

export interface LobbyUi {
  render(state: LobbyState): void;
  show(visible: boolean): void;
  /** Pseudos des places du dernier match lancé, pour l'affichage des résultats. */
  setMatchPlayers(names: readonly string[]): void;
}

export function createLobbyUi(root: HTMLElement, lobby: LobbyClient): LobbyUi {
  /** Personnage choisi dans le menu (pour la partie rapide), gardé d'un rendu à l'autre. */
  let menuFighter = 'random';
  let codeDraft = '';
  let matchPlayers: readonly string[] = [];
  let last: LobbyState | null = null;
  let lastKey = '';
  // Pas de rendu pendant la frappe : il est rattrapé quand le champ perd le focus.
  root.addEventListener('focusout', () =>
    queueMicrotask(() => {
      if (last !== null) api.render(last);
    }),
  );

  function fighterOptions(state: LobbyState) {
    return [
      { value: 'random', label: 'Au hasard' },
      ...state.content.fighters.map((id) => ({ value: id, label: fighterName(id) })),
    ];
  }

  function header(state: LobbyState): HTMLElement {
    const you = state.you;
    const who = you === null ? 'Connexion…' : `${you.name}${you.guest ? ' (invité)' : ''}`;
    const net =
      state.status === 'online'
        ? state.rttMs === null
          ? 'en ligne'
          : `en ligne, ${state.rttMs} ms`
        : state.status === 'connecting'
          ? 'connexion…'
          : state.status === 'offline'
            ? 'hors ligne, reconnexion…'
            : 'fermé';
    return el('div', { class: 'who' }, el('strong', { text: who }), ` · ${net}`);
  }

  function menu(state: LobbyState): HTMLElement[] {
    const code = el('input', {
      name: 'code',
      placeholder: 'Code (ABC-DEF)',
      maxlength: '9',
      autocomplete: 'off',
    });
    code.value = codeDraft;
    code.addEventListener('input', () => {
      codeDraft = code.value;
    });
    const join = el(
      'form',
      { class: 'row', id: 'join-room' },
      code,
      el('button', { type: 'submit', text: 'Rejoindre' }),
    );
    join.addEventListener('submit', (e) => {
      e.preventDefault();
      lobby.joinRoom(code.value);
    });
    const quick =
      state.queue === null
        ? button('Partie rapide', () => lobby.queue(state.regions[0] ?? 'eu', menuFighter), {
            id: 'quick',
          })
        : button('Quitter la file', () => lobby.leaveQueue(), { id: 'leave-queue' });
    const parts: HTMLElement[] = [
      el('h1', { text: 'Combat en ligne' }),
      button('Créer un salon privé', () => lobby.createRoom(), { id: 'create-room' }),
      join,
      el(
        'div',
        { class: 'row' },
        select(fighterOptions(state), menuFighter, (v) => (menuFighter = v), {
          name: 'quick-fighter',
        }),
        quick,
      ),
    ];
    if (state.queue !== null) {
      parts.push(
        el('p', {
          id: 'queue-status',
          text: `En file d'attente (${state.queue.region}) : ${state.queue.waiting} joueur(s)…`,
        }),
      );
    }
    return parts;
  }

  function memberRow(state: LobbyState, m: MemberView, isHost: boolean): HTMLElement {
    const room = state.room!;
    const tags: string[] = [];
    if (m.id === room.host) tags.push('hôte');
    if (m.guest) tags.push('invité');
    if (!m.connected) tags.push('déconnecté');
    if (m.id === state.you?.id) tags.push('vous');
    const row = el(
      'li',
      { 'data-member': m.id },
      el('span', { class: 'name', text: m.name }),
      el('span', { class: 'tags', text: tags.length > 0 ? `(${tags.join(', ')})` : '' }),
      el('span', { text: fighterName(m.fighter) }),
      el('span', { text: room.rules.teams ? `équipe ${m.team + 1}` : '' }),
      el('span', { class: 'ready', text: m.ready ? 'prêt' : '' }),
      el('span', { text: m.rttMs === null ? '' : `${m.rttMs} ms` }),
    );
    if (isHost && m.id !== state.you?.id && room.phase === 'lobby') {
      row.append(button('Expulser', () => lobby.kick(m.id), { class: 'kick' }));
    }
    return row;
  }

  function rulesForm(state: LobbyState): HTMLElement {
    const room = state.room!;
    const rules = room.rules;
    const change = (patch: Partial<RoomRules>): void =>
      lobby.setRules({ rules: { ...rules, ...patch } });
    const number = (name: string, value: number, apply: (n: number) => void): HTMLInputElement => {
      const input = el('input', { type: 'number', name, value: String(value), min: '0' });
      input.addEventListener('change', () => apply(Number.parseInt(input.value, 10) || 0));
      return input;
    };
    const check = (name: string, value: boolean, apply: (v: boolean) => void): HTMLLabelElement => {
      const box = el('input', { type: 'checkbox', name });
      box.checked = value;
      box.addEventListener('change', () => apply(box.checked));
      return el(
        'label',
        {},
        box,
        ` ${name === 'teams' ? 'Équipes' : name === 'locked' ? 'Verrouillé' : 'Objets'}`,
      );
    };
    return el(
      'fieldset',
      { id: 'host-rules' },
      el('legend', { text: 'Réglages (hôte)' }),
      el(
        'div',
        { class: 'row' },
        select(MODES, rules.mode, (v) => change({ mode: v as RoomRules['mode'] }), {
          name: 'mode',
        }),
        el(
          'label',
          {},
          'Temps (s) ',
          number('timeLimit', rules.timeLimit, (n) => change({ timeLimit: n })),
        ),
        el(
          'label',
          {},
          'Vies ',
          number('stocks', rules.stocks, (n) => change({ stocks: n })),
        ),
      ),
      el(
        'div',
        { class: 'row' },
        select(
          [
            { value: 'random', label: 'Stage au hasard' },
            ...state.content.stages.map((id) => ({ value: id, label: stageName(id) })),
          ],
          room.stage,
          (v) => lobby.setRules({ stage: v }),
          { name: 'stage' },
        ),
        check('teams', rules.teams, (v) => change({ teams: v })),
        check('items', rules.items.enabled, (v) =>
          change({ items: { ...rules.items, enabled: v } }),
        ),
        check('locked', room.locked, (v) => lobby.setRules({ locked: v })),
      ),
    );
  }

  function results(state: LobbyState): HTMLElement | null {
    const end = state.room?.lastEnd ?? null;
    if (end === null) return null;
    const box = el('div', { id: 'results' }, el('h2', { text: 'Dernier match' }));
    box.append(el('p', { class: 'end-status', 'data-status': end.status, text: end.message }));
    if (end.result !== null) {
      const list = el('ol');
      const order = end.result.players
        .map((p, slot) => ({ p, slot }))
        .sort((a, b) => a.p.placement - b.p.placement);
      for (const { p, slot } of order) {
        const name = matchPlayers[slot] ?? `Joueur ${slot + 1}`;
        list.append(
          el('li', { text: `${p.placement}. ${name} : ${p.kos} KO, ${p.falls} chute(s)` }),
        );
      }
      box.append(list);
    }
    return box;
  }

  function roomView(state: LobbyState): HTMLElement[] {
    const room = state.room!;
    const me = room.members.find((m) => m.id === state.you?.id);
    const isHost = room.host !== null && room.host === state.you?.id;
    const title =
      room.code === null
        ? el('h1', { text: 'Partie rapide' })
        : el(
            'h1',
            {},
            'Salon ',
            el('span', { id: 'room-code', 'data-code': room.code, text: formatCode(room.code) }),
          );
    const list = el('ul', { id: 'members' });
    for (const m of room.members) list.append(memberRow(state, m, isHost));
    const mine = el(
      'div',
      { class: 'row' },
      select(
        me?.fighter == null
          ? [{ value: '', label: 'Choisir un personnage…' }, ...fighterOptions(state)]
          : fighterOptions(state),
        me?.fighter ?? '',
        (v) => {
          if (v !== '') lobby.setFighter(v);
        },
        { name: 'fighter' },
      ),
    );
    if (room.rules.teams) {
      mine.append(
        select(
          [0, 1, 2, 3].map((t) => ({ value: String(t), label: `Équipe ${t + 1}` })),
          String(me?.team ?? 0),
          (v) => lobby.setTeam(Number(v)),
          { name: 'team' },
        ),
      );
    }
    if (!isHost) {
      const ready = el('input', { type: 'checkbox', name: 'ready' });
      ready.checked = me?.ready ?? false;
      ready.addEventListener('change', () => lobby.setReady(ready.checked));
      mine.append(el('label', {}, ready, ' Prêt'));
    }
    const info = el('p', {
      class: 'rules',
      text:
        `${MODES.find((m) => m.value === room.rules.mode)?.label}` +
        `${room.rules.timeLimit > 0 ? `, ${room.rules.timeLimit} s` : ''}` +
        `${room.rules.mode !== 'time' ? `, ${room.rules.stocks} vie(s)` : ''}` +
        ` · ${stageName(room.stage)} · ${room.members.length}/${room.capacity}` +
        `${room.locked ? ' · verrouillé' : ''}`,
    });
    const parts: HTMLElement[] = [title, info, list, mine];
    if (isHost) parts.push(rulesForm(state));
    const actions = el('div', { class: 'row' });
    if (isHost) actions.append(button('Lancer la partie', () => lobby.start(), { id: 'start' }));
    actions.append(button('Quitter le salon', () => lobby.leaveRoom(), { id: 'leave-room' }));
    parts.push(actions);
    if (room.phase === 'countdown') {
      parts.push(el('p', { id: 'countdown', text: `Lancement dans ${state.countdown ?? '…'} s` }));
    }
    const res = results(state);
    if (res !== null) parts.push(res);
    return parts;
  }

  const api: LobbyUi = {
    render(state) {
      last = state;
      // On ne reconstruit le panneau que si ce qu'il montre a changé (hors aller-retour, qui
      // change à chaque ping) : un rendu entre l'appui et le relâchement d'un bouton le remplacerait
      // et ferait perdre le clic.
      const key = JSON.stringify([
        state.status,
        state.you,
        state.room,
        state.queue,
        state.error,
        state.countdown,
        state.content,
        matchPlayers,
      ]);
      const headerNode = root.querySelector('.who');
      if (key === lastKey && headerNode !== null) {
        headerNode.replaceWith(header(state));
        return;
      }
      const parts: HTMLElement[] = [header(state)];
      parts.push(...(state.room === null ? menu(state) : roomView(state)));
      if (state.error !== null) {
        parts.push(
          el('p', {
            class: 'error',
            role: 'alert',
            'data-code': state.error.code,
            text: state.error.message,
          }),
        );
      }
      // Garder la saisie en cours d'un champ actif : on ne reconstruit pas pendant la frappe.
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && root.contains(active) && active.type !== 'checkbox')
        return;
      lastKey = key;
      root.replaceChildren(...parts);
    },
    show(visible) {
      root.hidden = !visible;
    },
    setMatchPlayers(names) {
      matchPlayers = names;
    },
  };
  return api;
}
