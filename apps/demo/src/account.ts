/**
 * Panneau « Compte » minimal : jouer en invité, se connecter, créer un compte, garder un profil
 * d'invité, choisir un personnage favori, se déconnecter, supprimer son compte. L'écran final
 * appartiendra à `app-shell` ; celui-ci sert à essayer le module `accounts`.
 *
 * Le serveur des comptes n'est contacté qu'à l'ouverture du panneau : sans lui, la démo reste
 * jouable et ne produit aucune erreur.
 */
import type { AccountView, AccountsClient, Result } from '@game/accounts-client';

export interface AccountPanelOptions {
  readonly panel: HTMLElement;
  readonly client: AccountsClient;
}

export interface AccountPanel {
  toggle(): void;
}

const NO_RECOVERY =
  'Sans email, un mot de passe oublié ne peut pas être récupéré : notez-le en lieu sûr.';

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'offline'; readonly message: string }
  | { readonly kind: 'ready'; readonly account: AccountView | null };

export function createAccountPanel(options: AccountPanelOptions): AccountPanel {
  const { panel, client } = options;
  const doc = panel.ownerDocument;
  let state: State = { kind: 'loading' };
  let loaded = false;
  let busy = false;
  let notice = '';
  let confirmingDelete = false;

  function element<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: string,
    name?: string,
  ): HTMLElementTagNameMap[K] {
    const node = doc.createElement(tag);
    // `textContent`, jamais `innerHTML` : un pseudo ne peut pas injecter de balise.
    if (text !== undefined) node.textContent = text;
    if (name !== undefined) node.dataset.account = name;
    return node;
  }

  function input(name: string, label: string, type: string, autocomplete: string) {
    const wrapper = element('label');
    const caption = element('span', label);
    const field = element('input', undefined, name);
    field.type = type;
    field.autocomplete = autocomplete as AutoFill;
    field.spellcheck = false;
    wrapper.append(caption, field);
    return { wrapper, field };
  }

  function button(
    label: string,
    name: string,
    run: () => void,
    type: 'button' | 'submit' = 'button',
  ) {
    const node = element('button', label, name);
    node.type = type;
    node.disabled = busy;
    if (type === 'button') node.addEventListener('click', run);
    return node;
  }

  /** Formulaire : les champs, puis un bouton d'envoi. Entrée envoie le formulaire. */
  function form(
    name: string,
    title: string,
    fields: ReturnType<typeof input>[],
    submit: string,
    run: (values: string[]) => Promise<void>,
    hint?: string,
  ): HTMLFormElement {
    const node = element('form', undefined, name);
    node.append(element('h3', title));
    for (const field of fields) node.append(field.wrapper);
    if (hint !== undefined) node.append(element('p', hint, `${name}-hint`));
    node.append(button(submit, `${name}-submit`, () => {}, 'submit'));
    node.addEventListener('submit', (event) => {
      event.preventDefault();
      void run(fields.map((field) => field.field.value));
    });
    return node;
  }

  /** Lance un appel, affiche son erreur éventuelle, puis redessine. */
  async function act<T>(
    call: Promise<Result<T>>,
    done: (value: T) => void,
    success = '',
  ): Promise<void> {
    busy = true;
    notice = '';
    render();
    const result = await call;
    busy = false;
    if (result.ok) {
      notice = success;
      done(result.value);
    } else if (result.error.code === 'network') {
      state = { kind: 'offline', message: result.error.message };
    } else {
      const wait = result.error.retryAfter;
      notice = wait === undefined ? result.error.message : `${result.error.message} (${wait} s)`;
    }
    render();
  }

  function setAccount(account: AccountView | null): void {
    state = { kind: 'ready', account };
    confirmingDelete = false;
  }

  function load(): void {
    state = { kind: 'loading' };
    render();
    void client.session().then((result) => {
      state = result.ok
        ? { kind: 'ready', account: result.value }
        : { kind: 'offline', message: result.error.message };
      render();
    });
  }

  function renderAnonymous(): HTMLElement[] {
    const guestPseudo = input('guest-pseudo', 'Pseudo (facultatif)', 'text', 'off');
    const guest = form(
      'guest',
      'Jouer tout de suite',
      [guestPseudo],
      'Jouer en invité',
      ([pseudo]) =>
        act(
          client.guest(pseudo === '' ? undefined : pseudo),
          setAccount,
          'Session invité ouverte.',
        ),
    );
    const login = form(
      'login',
      'Se connecter',
      [
        input('login-pseudo', 'Pseudo', 'text', 'username'),
        input('login-password', 'Mot de passe', 'password', 'current-password'),
      ],
      'Se connecter',
      ([pseudo, password]) => act(client.login(pseudo!, password!), setAccount, 'Connecté.'),
    );
    const register = form(
      'register',
      'Créer un compte',
      [
        input('register-pseudo', 'Pseudo', 'text', 'username'),
        input('register-password', 'Mot de passe', 'password', 'new-password'),
      ],
      'Créer le compte',
      ([pseudo, password]) => act(client.register(pseudo!, password!), setAccount, 'Compte créé.'),
      NO_RECOVERY,
    );
    return [guest, login, register];
  }

  function renderProfile(account: AccountView): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    const who = account.guest ? `Invité : ${account.pseudo}` : `Connecté : ${account.pseudo}`;
    nodes.push(element('p', who, 'status'));
    nodes.push(
      element(
        'p',
        `Matchs : ${account.stats.matchesPlayed} · victoires : ${account.stats.wins}`,
        'stats',
      ),
    );

    const fighter = input('fighter', 'Personnage favori', 'text', 'off');
    fighter.field.value = account.favoriteFighter ?? '';
    fighter.field.placeholder = 'ex. vanguard';
    nodes.push(
      form('profile', 'Profil', [fighter], 'Enregistrer', ([value]) =>
        act(
          client.updateProfile({ favoriteFighter: value === '' ? null : value! }),
          setAccount,
          'Profil enregistré.',
        ),
      ),
    );

    if (account.guest) {
      nodes.push(
        form(
          'convert',
          'Garder ce profil : créer un compte',
          [
            input('convert-pseudo', 'Pseudo', 'text', 'username'),
            input('convert-password', 'Mot de passe', 'password', 'new-password'),
          ],
          'Créer le compte',
          ([pseudo, password]) =>
            act(client.convert(pseudo!, password!), setAccount, 'Compte créé, profil gardé.'),
          NO_RECOVERY,
        ),
      );
    }

    const logoutLabel = account.guest ? 'Quitter la session invité' : 'Se déconnecter';
    nodes.push(
      button(logoutLabel, 'logout', () => {
        void act(client.logout(), () => setAccount(null), 'Déconnecté.');
      }),
    );

    if (!account.guest) {
      if (!confirmingDelete) {
        nodes.push(
          button('Supprimer mon compte…', 'delete', () => {
            confirmingDelete = true;
            render();
          }),
        );
      } else {
        nodes.push(
          form(
            'delete',
            'Supprimer définitivement le compte',
            [input('delete-password', 'Mot de passe', 'password', 'current-password')],
            'Supprimer définitivement',
            ([password]) =>
              act(client.deleteAccount(password!), () => setAccount(null), 'Compte supprimé.'),
            'Le compte, le profil et les statistiques sont effacés aussitôt, sans retour possible.',
          ),
          button('Annuler', 'delete-cancel', () => {
            confirmingDelete = false;
            render();
          }),
        );
      }
    }
    return nodes;
  }

  function render(): void {
    const nodes: HTMLElement[] = [element('h2', 'Compte')];
    if (state.kind === 'loading') {
      nodes.push(element('p', 'Connexion au serveur des comptes…', 'status'));
    } else if (state.kind === 'offline') {
      nodes.push(
        element('p', `${state.message} Le jeu reste jouable sans compte.`, 'status'),
        button('Réessayer', 'retry', load),
      );
    } else {
      nodes.push(element('p', notice, 'message'));
      nodes.push(...(state.account === null ? renderAnonymous() : renderProfile(state.account)));
    }
    panel.replaceChildren(...nodes);
  }

  return {
    toggle() {
      panel.hidden = !panel.hidden;
      if (panel.hidden) return;
      if (!loaded) {
        loaded = true;
        load();
      } else {
        render();
      }
    },
  };
}
