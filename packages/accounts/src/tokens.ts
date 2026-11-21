/**
 * Jetons de session. Le jeton lui-même ne vit que dans le cookie du joueur ; la base n'en garde
 * que l'empreinte SHA-256, pour qu'une base copiée ne permette pas d'ouvrir une session.
 */
import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;
/** 32 octets en base64url, sans remplissage : 43 caractères. */
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

export function newSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** Vrai si le texte a la forme d'un jeton : évite de chercher en base n'importe quoi. */
export function isWellFormedToken(token: string): boolean {
  return TOKEN_FORMAT.test(token);
}

/**
 * Empreinte d'un jeton, telle que stockée. Un SHA-256 simple suffit : le jeton est aléatoire et
 * long, il n'y a rien à deviner par force brute.
 */
export function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
