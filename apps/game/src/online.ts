/**
 * Le jeu en ligne côté application : session de compte (invité créé sans question), client du
 * lobby (créé à la première visite, reconnexion automatique), lancement des combats envoyés par
 * le lobby, résultats, et bandeau d'état de la connexion.
 */
import type { AccountView } from '@game/accounts/protocol';
import { createAccountsClient, type AccountsClient } from '@game/accounts-client';
import { createLobbyClient, type LobbyClient, type LobbyState } from '@game/lobby/client';
import type { MatchStartInfo } from '@game/lobby/protocol';
import type { MatchResult } from '@game/match-rules';
import { createRankingClient, type RankingClient } from '@game/ranking/client';
import type { App } from './app.ts';
import {
  accountsProblem,
  lobbyProblem,
  lobbyStatusBanner,
  matchEndNote,
  relayProblem,
  type Problem,
} from './errors.ts';
import { onlineMatch, type OnlineMatch } from './online-match.ts';
import { resultsScreen } from './ui/results.ts';

export class Online {
  readonly accounts: AccountsClient = createAccountsClient();
  readonly ranking: RankingClient = createRankingClient();
  me: AccountView | null = null;
  lobby: LobbyClient | null = null;
  /** Ouvre l'écran du profil (branché par l'écran de profil). */
  openProfile: (() => void) | null = null;
  private wasOnline = false;
  private lastError: unknown = null;
  private match: OnlineMatch | null = null;
  private readonly listeners = new Set<() => void>();

  private readonly app: App;

  constructor(app: App) {
    this.app = app;
  }

  /** Écoute les changements (compte, lobby) : les écrans en ligne se redessinent. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const l of this.listeners) l();
  }

  /** Session existante, sinon nouvel invité. Renvoie le problème rencontré, ou `null`. */
  async ensureSession(): Promise<Problem | null> {
    const session = await this.accounts.session();
    if (!session.ok) return accountsProblem(session.error);
    if (session.value !== null) {
      this.setMe(session.value);
      return null;
    }
    const guest = await this.accounts.guest();
    if (!guest.ok) return accountsProblem(guest.error);
    this.setMe(guest.value);
    return null;
  }

  setMe(me: AccountView | null): void {
    const changedIdentity = this.me?.id !== me?.id;
    this.me = me;
    // Nouveau compte (connexion, inscription) : le lobby doit reconnaître la nouvelle identité.
    if (changedIdentity && this.lobby !== null) {
      this.disconnect();
      this.connect();
    }
    this.changed();
  }

  private async ticket(audience: 'lobby' | 'relay'): Promise<string | null> {
    const t = await this.accounts.ticket(audience);
    if (t.ok) return t.value.ticket;
    // Session perdue (serveur redémarré, invité purgé) : nouvelle session puis nouvel essai.
    if (t.error.code === 'unauthenticated' && (await this.ensureSession()) === null) {
      const again = await this.accounts.ticket(audience);
      return again.ok ? again.value.ticket : null;
    }
    return null;
  }

  /** Client du lobby, créé à la première demande. */
  connect(): LobbyClient {
    if (this.lobby !== null) return this.lobby;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const lobby = createLobbyClient({
      url: `${scheme}://${location.host}/lobby`,
      getTicket: async () => ((await this.ensureSession()) === null ? this.ticket('lobby') : null),
      now: () => performance.now(),
    });
    this.lobby = lobby;
    lobby.onChange((state) => this.onLobby(state));
    lobby.onMatchStart((info) => void this.onMatchStart(info));
    this.app.test.lobby = () => lobby.state;
    return lobby;
  }

  disconnect(): void {
    this.lobby?.close();
    this.lobby = null;
    this.wasOnline = false;
    this.app.banner(null);
  }

  private onLobby(state: LobbyState): void {
    rememberRoom(state.room !== null);
    if (state.status === 'online') this.wasOnline = true;
    const banner = lobbyStatusBanner(state.status, this.wasOnline);
    this.app.banner(banner, { menu: () => this.app.popTo('main-menu') });
    if (state.error !== null && state.error !== this.lastError) {
      this.lastError = state.error;
      const p = lobbyProblem(state.error);
      if (state.error.code === 'replaced')
        this.app.banner(p, {
          reload: () => location.reload(),
          menu: () => this.app.popTo('main-menu'),
        });
      else if (state.error.code !== 'network') this.app.toast(p.message, 6000);
    }
    // Fin du match (ou salon quitté pendant la partie) : résultats, puis salon.
    if (
      this.match !== null &&
      (state.match === null || state.match.gameId !== this.match.info.gameId)
    ) {
      this.finishMatch(state);
    }
    this.changed();
  }

  private async onMatchStart(info: MatchStartInfo): Promise<void> {
    // Même partie déjà affichée (`matchStart` renvoyé après une reconnexion du lobby).
    if (
      this.match !== null &&
      this.match.info.gameId === info.gameId &&
      this.match.net.status !== 'closed'
    ) {
      return;
    }
    const ticket = await this.ticket('relay');
    if (ticket === null) {
      this.app.banner(relayProblem('impossible d’obtenir l’autorisation de rejoindre la partie.'), {
        menu: () => this.app.popTo('main-menu'),
      });
      return;
    }
    if (this.lobby?.state.match?.gameId !== info.gameId) return;
    const lobby = this.lobby;
    const match = onlineMatch(this.app, {
      info,
      ticket,
      lobby,
      onQuit: () => {
        // On quitte le salon : la partie continue sans nous (le relais l'annonce aux autres).
        this.match?.stop();
        this.match = null;
        lobby.leaveRoom();
        this.app.popTo('online-home');
      },
      onLost: (error) => {
        this.app.banner(relayProblem(error), { menu: () => this.app.popTo('main-menu') });
      },
    });
    this.match = match;
    this.app.push(match);
  }

  private finishMatch(state: LobbyState): void {
    const match = this.match!;
    this.match = null;
    const local = match.result();
    match.stop();
    const end = state.lastEnd ?? state.room?.lastEnd ?? null;
    const declared = end?.status === 'agreed' ? end.result : null;
    const result: MatchResult | null =
      declared !== null ? { config: match.info.config, ...declared } : local;
    const note =
      end === null
        ? null
        : end.status === 'agreed'
          ? null
          : (matchEndNote(end.status) ?? end.message);
    const backToRoom = (): void => {
      if (!this.app.popTo('online-room')) this.app.popTo('online-home');
    };
    if (this.app.top() !== match) {
      // L'écran du combat n'est plus au sommet (dialogue, autre écran) : on le retire.
      if (this.app.ids().includes('match-online')) this.app.popTo('match-online');
    }
    if (result === null) {
      this.app.toast(note ?? 'Partie terminée.', 6000);
      if (this.app.top().id === 'match-online') this.app.pop();
      backToRoom();
      return;
    }
    const screen = resultsScreen(this.app, {
      result,
      names: match.info.players.map((p) => p.name),
      fighters: match.info.players.map((p) => p.fighter),
      me: match.info.slot,
      note,
      back: backToRoom,
      actions: [
        { id: 'results-room', label: 'Retour au salon', action: backToRoom, primary: true },
        { id: 'results-profile', label: 'Mon profil', action: () => this.openProfile?.() },
      ],
    });
    if (this.app.top().id === 'match-online') this.app.replace(screen);
    else this.app.push(screen);
    this.app.test.lastResult = () => result;
  }
}

const RESUME_KEY = 'fracas.resume-online';

/** Vrai si la page a été rechargée pendant que le joueur était dans un salon (ou une partie). */
export function shouldResumeOnline(): boolean {
  try {
    return sessionStorage.getItem(RESUME_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberRoom(inRoom: boolean): void {
  try {
    if (inRoom) sessionStorage.setItem(RESUME_KEY, '1');
    else sessionStorage.removeItem(RESUME_KEY);
  } catch {
    // Sans stockage de session : pas de reprise automatique après un rechargement.
  }
}
