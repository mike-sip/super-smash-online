/**
 * Clés de production : `node deploy/generate-secrets.ts` écrit sur la sortie les deux lignes à
 * copier dans deploy/.env. Rien n'est écrit sur disque ni envoyé nulle part.
 */
import { randomBytes } from 'node:crypto';

/** Une clé de 256 bits en base64url (43 caractères). */
export function secret(): string {
  return randomBytes(32).toString('base64url');
}

export function generateSecrets(): { ticket: string; report: string } {
  const ticket = secret();
  let report = secret();
  while (report === ticket) report = secret();
  return { ticket, report };
}

if (import.meta.main) {
  const { ticket, report } = generateSecrets();
  console.log(`ACCOUNTS_TICKET_SECRETS=${ticket}`);
  console.log(`RANKING_REPORT_SECRETS=${report}`);
}
