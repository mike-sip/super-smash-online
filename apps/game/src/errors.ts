/**
 * Erreurs visibles pour le joueur : chaque état d'erreur des clients (comptes, lobby, relais,
 * classement) devient un message en français et des actions proposées. Jamais de texte technique
 * brut, jamais d'écran sans issue.
 */
import type { ErrorCode as AccountsErrorCode } from '@game/accounts/protocol';
import type { LobbyError, LobbyStatus } from '@game/lobby/client';
import type { LobbyErrorCode } from '@game/lobby/protocol';

export type ErrorAction = 'retry' | 'menu' | 'login' | 'dismiss' | 'reload';

export interface Problem {
  readonly message: string;
  readonly actions: readonly ErrorAction[];
  readonly severity: 'info' | 'error';
}

const problem = (
  message: string,
  actions: readonly ErrorAction[] = ['dismiss'],
  severity: Problem['severity'] = 'error',
): Problem => ({ message, actions, severity });

const NETWORK = 'Serveur injoignable. Vérifiez votre connexion, puis réessayez.';

/** Codes dont le message du serveur est déjà précis et destiné au joueur (validation). */
const SERVER_WORDED_ACCOUNTS = new Set<string>([
  'invalid_pseudo',
  'invalid_password',
  'pseudo_taken',
]);

const ACCOUNTS: Readonly<Record<AccountsErrorCode | 'network', Problem>> = {
  network: problem(NETWORK, ['retry', 'menu']),
  bad_request: problem('La demande n’a pas pu être traitée. Réessayez.', ['retry', 'menu']),
  unsupported_media_type: problem('La demande n’a pas pu être traitée. Réessayez.', [
    'retry',
    'menu',
  ]),
  payload_too_large: problem('Texte trop long.'),
  forbidden_origin: problem('Cette page ne peut pas contacter le serveur des comptes.', ['reload']),
  not_found: problem('Service des comptes introuvable.', ['retry', 'menu']),
  method_not_allowed: problem('Service des comptes indisponible.', ['retry', 'menu']),
  unauthenticated: problem('Votre session a expiré. Reconnectez-vous ou rejouez en invité.', [
    'login',
    'menu',
  ]),
  not_a_guest: problem('Ce compte n’est pas un compte invité.'),
  guest_not_allowed: problem('Créez un compte pour utiliser cette fonction.', ['login', 'dismiss']),
  invalid_pseudo: problem('Pseudo refusé.'),
  pseudo_taken: problem('Ce pseudo est déjà pris.'),
  invalid_password: problem('Mot de passe refusé.'),
  invalid_credentials: problem('Pseudo ou mot de passe incorrect.'),
  invalid_fighter: problem('Personnage inconnu.'),
  invalid_audience: problem('Connexion au jeu refusée. Réessayez.', ['retry', 'menu']),
  rate_limited: problem('Trop d’essais. Patientez une minute avant de réessayer.'),
  server_busy: problem('Le serveur est très demandé. Réessayez dans un instant.', [
    'retry',
    'menu',
  ]),
  internal: problem('Le serveur a rencontré un problème. Réessayez plus tard.', ['retry', 'menu']),
};

export function accountsProblem(error: { code: string; message: string }): Problem {
  const known = ACCOUNTS[error.code as AccountsErrorCode | 'network'];
  if (known === undefined)
    return problem('Erreur du serveur des comptes. Réessayez.', ['retry', 'menu']);
  if (SERVER_WORDED_ACCOUNTS.has(error.code) && error.message.trim() !== '') {
    return { ...known, message: error.message };
  }
  return known;
}

const LOBBY: Readonly<Record<LobbyErrorCode | 'network' | 'replaced', Problem>> = {
  network: problem('Serveur de jeu injoignable. Nouvel essai automatique…', ['menu'], 'info'),
  replaced: problem('Le jeu est ouvert dans un autre onglet ou une autre fenêtre.', [
    'reload',
    'menu',
  ]),
  bad_request: problem('Action refusée par le serveur de jeu.'),
  version: problem('Une nouvelle version du jeu est disponible : rechargez la page.', ['reload']),
  unauthenticated: problem('Connexion au serveur de jeu refusée. Reconnectez-vous.', [
    'login',
    'menu',
  ]),
  ticket: problem('Connexion au serveur de jeu refusée. Réessayez.', ['retry', 'menu']),
  rate_limited: problem('Trop d’actions en peu de temps. Patientez un instant.'),
  server_full: problem('Le serveur de jeu est complet. Réessayez dans quelques minutes.', [
    'retry',
    'menu',
  ]),
  not_found: problem('Aucun salon avec ce code. Vérifiez-le auprès de votre ami.'),
  full: problem('Ce salon est complet.'),
  locked: problem('Ce salon est verrouillé par son hôte.'),
  banned: problem('Vous ne pouvez plus rejoindre ce salon.'),
  already_in_room: problem('Vous êtes déjà dans un salon.'),
  not_in_room: problem('Vous n’êtes plus dans ce salon.', ['menu']),
  not_host: problem('Seul l’hôte du salon peut faire cela.'),
  wrong_phase: problem('Impossible pour le moment : une partie est en cours ou va commencer.'),
  not_ready: problem('Tout le monde n’est pas prêt.'),
  invalid_rules: problem('Règles refusées.'),
  invalid_fighter: problem('Personnage refusé.'),
  invalid_stage: problem('Stage refusé.'),
  invalid_region: problem('Cette région n’est pas disponible.'),
  high_latency: problem(
    'Votre connexion est trop lente pour la partie rapide (aller-retour au-delà de 250 ms). Essayez un salon privé avec des amis proches.',
  ),
  not_in_match: problem('Cette partie est terminée.', ['menu']),
};

/** Codes dont le message du serveur détaille la cause (règles refusées, joueur absent…). */
const SERVER_WORDED_LOBBY = new Set<string>(['invalid_rules', 'not_ready', 'bad_request']);

export function lobbyProblem(error: LobbyError): Problem {
  const known = LOBBY[error.code];
  if (known === undefined) return problem('Erreur du serveur de jeu.', ['dismiss', 'menu']);
  if (SERVER_WORDED_LOBBY.has(error.code) && error.message.trim() !== '') {
    return { ...known, message: error.message };
  }
  return known;
}

/**
 * Bandeau d'état de la connexion au lobby, ou `null` s'il n'y a rien à dire. `wasOnline` : la
 * connexion a déjà été établie une fois (on parle alors de reconnexion).
 */
export function lobbyStatusBanner(status: LobbyStatus, wasOnline: boolean): Problem | null {
  switch (status) {
    case 'online':
    case 'closed':
      return null;
    case 'connecting':
      return wasOnline
        ? problem('Connexion au serveur de jeu perdue. Reconnexion…', [], 'info')
        : problem('Connexion au serveur de jeu…', [], 'info');
    case 'offline':
      return problem('Serveur de jeu injoignable. Nouvel essai automatique…', ['menu'], 'error');
  }
}

/** Erreur du relais pendant une partie (texte du relais, déjà en français), ou perte du relais. */
export function relayProblem(error: string | null): Problem {
  if (error !== null && error.trim() !== '') {
    return problem(`La partie a été interrompue : ${error}`, ['menu']);
  }
  return problem('La connexion à la partie a été perdue.', ['menu']);
}

export type MatchEndStatus = 'agreed' | 'contested' | 'abandoned' | 'cancelled';

/** Explication d'une fin de match en ligne, ou `null` quand le résultat est normal. */
export function matchEndNote(status: MatchEndStatus): string | null {
  switch (status) {
    case 'agreed':
      return null;
    case 'contested':
      return 'Les résultats des joueurs ne concordent pas : ce match n’est pas compté.';
    case 'abandoned':
      return 'Tout le monde a quitté la partie : match abandonné, non compté.';
    case 'cancelled':
      return 'Un joueur n’a pas pu rejoindre la partie : lancement annulé.';
  }
}

export function rankingProblem(error: { code: string }): Problem {
  return error.code === 'network'
    ? problem('Classement injoignable pour le moment.', ['retry', 'menu'])
    : error.code === 'unauthenticated'
      ? problem('Connectez-vous pour voir votre profil.', ['login', 'menu'])
      : problem('Le classement n’a pas pu être chargé.', ['retry', 'menu']);
}

/** Erreur imprévue du code : un message simple, sans détail technique à l'écran. */
export const UNEXPECTED: Problem = problem(
  'Une erreur est survenue. Rechargez la page pour continuer.',
  ['reload'],
);
