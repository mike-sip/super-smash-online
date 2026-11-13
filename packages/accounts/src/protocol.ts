/**
 * Protocole de l'API des comptes : types des requêtes et réponses, codes d'erreur, messages,
 * validations. Sans import Node : partagé avec le client navigateur (`@game/accounts/protocol`).
 */

/** Préfixe de toutes les routes. */
export const API_PREFIX = '/api/accounts/v1';

/** Serveurs auxquels un ticket peut être destiné. */
export const AUDIENCES = ['relay', 'lobby', 'ranking'] as const;
export type Audience = (typeof AUDIENCES)[number];

export interface AccountStats {
  readonly matchesPlayed: number;
  readonly wins: number;
}

/** Ce que le client voit d'un compte. Jamais d'empreinte ni de jeton. */
export interface AccountView {
  /** UUID, stable : les autres modules désignent un joueur par cet identifiant. */
  readonly id: string;
  /** Pseudo tel qu'affiché. */
  readonly pseudo: string;
  readonly guest: boolean;
  /** Identifiant de personnage, par exemple « vanguard ». */
  readonly favoriteFighter: string | null;
  readonly stats: AccountStats;
  /** Date de création, ISO 8601. */
  readonly createdAt: string;
}

export type ErrorCode =
  | 'bad_request'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'forbidden_origin'
  | 'not_found'
  | 'method_not_allowed'
  | 'unauthenticated'
  | 'not_a_guest'
  | 'guest_not_allowed'
  | 'invalid_pseudo'
  | 'pseudo_taken'
  | 'invalid_password'
  | 'invalid_credentials'
  | 'invalid_fighter'
  | 'invalid_audience'
  | 'rate_limited'
  | 'server_busy'
  | 'internal';

export type PseudoProblem = 'length' | 'characters' | 'start' | 'separators' | 'forbidden';
export type PasswordProblem = 'length' | 'same_as_pseudo' | 'too_common';

/** Corps d'une réponse en erreur. */
export interface ErrorBody {
  readonly error: { readonly code: ErrorCode; readonly message: string };
}

// Corps des requêtes.
export interface GuestRequest {
  readonly pseudo?: string;
}
export interface CredentialsRequest {
  readonly pseudo: string;
  readonly password: string;
}
export interface ProfileRequest {
  readonly pseudo?: string;
  readonly favoriteFighter?: string | null;
}
export interface PasswordRequest {
  readonly current: string;
  readonly next: string;
}
export interface DeleteRequest {
  readonly password?: string;
}
export interface TicketRequest {
  readonly audience: Audience;
}

// Corps des réponses.
export interface SessionResponse {
  readonly account: AccountView | null;
}
export interface AccountResponse {
  readonly account: AccountView;
}
export interface TicketResponse {
  readonly ticket: string;
  /** Expiration, en secondes Unix. */
  readonly expiresAt: number;
}

/** Messages affichables, en français, pour chaque code d'erreur. */
export const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  bad_request: 'Requête invalide.',
  unsupported_media_type: 'Le corps de la requête doit être en JSON.',
  payload_too_large: 'Requête trop volumineuse.',
  forbidden_origin: 'Origine non autorisée.',
  not_found: 'Adresse inconnue.',
  method_not_allowed: 'Méthode non autorisée.',
  unauthenticated: 'Vous n’êtes pas connecté.',
  not_a_guest: 'Seule une session invité peut être convertie en compte.',
  guest_not_allowed: 'Cette action demande un compte, pas une session invité.',
  invalid_pseudo: 'Pseudo invalide.',
  pseudo_taken: 'Ce pseudo est déjà pris.',
  invalid_password: 'Mot de passe invalide.',
  invalid_credentials: 'Pseudo ou mot de passe incorrect.',
  invalid_fighter: 'Personnage inconnu.',
  invalid_audience: 'Destinataire du ticket inconnu.',
  rate_limited: 'Trop de tentatives. Réessayez dans un moment.',
  server_busy: 'Serveur occupé. Réessayez dans un moment.',
  internal: 'Erreur interne du serveur.',
};

export const PSEUDO_PROBLEM_MESSAGES: Readonly<Record<PseudoProblem, string>> = {
  length: 'Le pseudo doit faire de 3 à 16 caractères.',
  characters: 'Le pseudo ne peut contenir que des lettres, des chiffres, « _ » et « - ».',
  start: 'Le pseudo doit commencer par une lettre.',
  separators: 'Le pseudo ne peut pas contenir deux « _ » ou « - » de suite.',
  forbidden: 'Ce pseudo n’est pas autorisé.',
};

export const PASSWORD_PROBLEM_MESSAGES: Readonly<Record<PasswordProblem, string>> = {
  length: 'Le mot de passe doit faire de 8 à 128 caractères.',
  same_as_pseudo: 'Le mot de passe ne doit pas être votre pseudo.',
  too_common: 'Ce mot de passe est trop courant : choisissez-en un autre.',
};

/**
 * Format d'un identifiant de personnage. Non vérifié contre la liste des personnages, que le
 * module `fighters` construit (voir SPEC-accounts.md, « Décisions prises à la validation »).
 */
const FIGHTER_ID = /^[a-z0-9-]{1,32}$/;

export function isFighterId(value: string): boolean {
  return FIGHTER_ID.test(value);
}

export function isAudience(value: unknown): value is Audience {
  return typeof value === 'string' && (AUDIENCES as readonly string[]).includes(value);
}

export { validatePseudo, pseudoKey, PSEUDO_MIN, PSEUDO_MAX } from './names.ts';
export type { PseudoValidation } from './names.ts';
export { validatePassword, PASSWORD_MIN, PASSWORD_MAX } from './passwords.ts';
export type { PasswordValidation } from './passwords.ts';
