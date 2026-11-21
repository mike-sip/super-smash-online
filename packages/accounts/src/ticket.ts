/**
 * Tickets : jetons courts et signés qui prouvent à un autre serveur (le relais de `netcode`,
 * plus tard `lobby` et `ranking`) qui se connecte, sans qu'il ait à lire la base des comptes.
 *
 * Format : `v1.<charge>.<signature>`, en base64url. La charge est le JSON des `TicketClaims` ;
 * la signature, un HMAC-SHA256 de `v1.<charge>` avec une clé partagée.
 *
 * Usage côté relais (voir SPEC-accounts.md, « Vérification d'un ticket ») :
 *
 *   import { verifyTicket } from '@game/accounts/ticket';
 *   const result = verifyTicket(ticket, { secrets: [process.env.ACCOUNTS_TICKET_SECRET!], audience: 'relay' });
 *   if (!result.ok) refuser(result.error);
 *   else accueillir(result.claims.sub, result.claims.name, result.claims.guest);
 *
 * Ce fichier n'importe que `node:crypto` : le relais peut l'utiliser seul.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Durée de vie d'un ticket : le temps d'ouvrir une connexion. */
export const TICKET_TTL_SECONDS = 60;
/** Écart d'horloge toléré entre le serveur des comptes et celui qui vérifie. */
export const CLOCK_SKEW_SECONDS = 5;

const VERSION = 'v1';
/** Bien au-delà d'un ticket réel (300 caractères environ) : refuse vite les textes géants. */
const MAX_LENGTH = 2048;
const PART = /^[A-Za-z0-9_-]+$/;

export interface TicketClaims {
  /** Identifiant du compte (UUID). */
  readonly sub: string;
  /** Pseudo à afficher. */
  readonly name: string;
  /** Vrai pour une session invité : à signaler à l'écran à côté du pseudo. */
  readonly guest: boolean;
  /** Serveur destinataire : `relay`, `lobby`, `ranking`. */
  readonly aud: string;
  /** Émis à, en secondes Unix. */
  readonly iat: number;
  /** Expire à, en secondes Unix. */
  readonly exp: number;
  /** Identifiant unique du ticket : permet de refuser un ticket déjà présenté. */
  readonly jti: string;
}

export type TicketError = 'malformed' | 'bad_signature' | 'expired' | 'wrong_audience';

export type TicketVerification =
  | { readonly ok: true; readonly claims: TicketClaims }
  | { readonly ok: false; readonly error: TicketError };

export interface VerifyOptions {
  /** Clés acceptées. Pendant un changement de clé, l'ancienne et la nouvelle. */
  readonly secrets: readonly string[];
  /** Ce serveur : un ticket destiné à un autre est refusé. */
  readonly audience: string;
  /** Heure de vérification en millisecondes Unix ; par défaut `Date.now()`. */
  readonly now?: number;
}

function signature(body: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`${VERSION}.${body}`).digest();
}

/** Émet un ticket. Utilisé par le serveur des comptes seulement. */
export function signTicket(
  identity: Pick<TicketClaims, 'sub' | 'name' | 'guest' | 'aud'>,
  options: { readonly secret: string; readonly now?: number; readonly ttl?: number },
): { ticket: string; claims: TicketClaims } {
  const iat = Math.floor((options.now ?? Date.now()) / 1000);
  const claims: TicketClaims = {
    sub: identity.sub,
    name: identity.name,
    guest: identity.guest,
    aud: identity.aud,
    iat,
    exp: iat + (options.ttl ?? TICKET_TTL_SECONDS),
    jti: randomBytes(16).toString('base64url'),
  };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = signature(body, options.secret).toString('base64url');
  return { ticket: `${VERSION}.${body}.${sig}`, claims };
}

function isClaims(value: unknown): value is TicketClaims {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.sub === 'string' &&
    typeof c.name === 'string' &&
    typeof c.guest === 'boolean' &&
    typeof c.aud === 'string' &&
    typeof c.jti === 'string' &&
    Number.isInteger(c.iat) &&
    Number.isInteger(c.exp)
  );
}

/**
 * Vérifie un ticket émis par le serveur des comptes. Ne lève jamais d'erreur : un texte
 * quelconque, même d'un autre type, donne `{ ok: false }`.
 */
export function verifyTicket(ticket: string, options: VerifyOptions): TicketVerification {
  if (typeof ticket !== 'string' || ticket.length > MAX_LENGTH) {
    return { ok: false, error: 'malformed' };
  }
  const parts = ticket.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return { ok: false, error: 'malformed' };
  const [, body, sig] = parts as [string, string, string];
  if (!PART.test(body) || !PART.test(sig)) return { ok: false, error: 'malformed' };

  // La signature d'abord : rien de ce que contient la charge n'est lu avant qu'elle soit prouvée.
  const given = Buffer.from(sig, 'base64url');
  const signed = options.secrets.some((secret) => {
    const expected = signature(body, secret);
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
  if (!signed) return { ok: false, error: 'bad_signature' };

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, error: 'malformed' };
  }
  if (!isClaims(claims)) return { ok: false, error: 'malformed' };

  const now = (options.now ?? Date.now()) / 1000;
  if (claims.iat > now + CLOCK_SKEW_SECONDS) return { ok: false, error: 'malformed' };
  if (now > claims.exp + CLOCK_SKEW_SECONDS) return { ok: false, error: 'expired' };
  if (claims.aud !== options.audience) return { ok: false, error: 'wrong_audience' };
  return { ok: true, claims };
}
