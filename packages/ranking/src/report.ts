/**
 * Signature des rapports de match : HMAC-SHA256 du corps brut avec une clé partagée entre les
 * serveurs (`RANKING_REPORT_SECRETS`), que les navigateurs n'ont jamais. N'importe que
 * `node:crypto` : `lobby` peut l'utiliser sans rien d'autre (`@game/ranking/report`).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Nom du schéma dans l'en-tête `Authorization`. */
export const REPORT_SCHEME = 'Report';
/** Longueur minimale d'une clé. */
export const MIN_SECRET_LENGTH = 32;

const VERSION = 'v1';
/** HMAC-SHA256 en base64url sans remplissage : 43 caractères. */
const SIGNATURE = /^Report v1\.([A-Za-z0-9_-]{43})$/;

function mac(body: string | Uint8Array, secret: string): Buffer {
  return createHmac('sha256', secret).update(body).digest();
}

/** Valeur de l'en-tête `Authorization` pour ce corps exact (octet pour octet). */
export function signReport(body: string, secret: string): string {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`Clé de rapport trop courte (${MIN_SECRET_LENGTH} caractères au moins).`);
  }
  return `${REPORT_SCHEME} ${VERSION}.${mac(body, secret).toString('base64url')}`;
}

/**
 * Vrai si `header` signe `body` avec l'une des clés. Comparaison en temps constant. Ne lève
 * jamais, quelle que soit l'entrée.
 */
export function verifyReportSignature(
  header: unknown,
  body: string | Uint8Array,
  secrets: readonly string[],
): boolean {
  if (typeof header !== 'string' || header.length > 64) return false;
  if (typeof body !== 'string' && !(body instanceof Uint8Array)) return false;
  const match = SIGNATURE.exec(header);
  if (match === null) return false;
  const given = Buffer.from(match[1]!, 'base64url');
  // Une seule écriture acceptée par signature (les bits de remplissage du dernier caractère comptent).
  if (given.toString('base64url') !== match[1]) return false;
  let valid = false;
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    const expected = mac(body, secret);
    // Toutes les clés sont essayées : le temps ne dit pas laquelle a servi.
    if (expected.length === given.length && timingSafeEqual(expected, given)) valid = true;
  }
  return valid;
}
