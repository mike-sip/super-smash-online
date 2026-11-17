/**
 * Cohérence des fichiers de déploiement : le Caddyfile applique les routes et en-têtes de
 * deploy/routes.ts (ceux de la passerelle des tests) ; la composition Docker donne aux serveurs
 * la configuration qu'ils exigent ; scripts de clés, de sauvegarde et d'horodatage.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { backup } from '../../../deploy/backup.ts';
import { generateSecrets } from '../../../deploy/generate-secrets.ts';
import { CACHE_ASSETS, HSTS, ROUTES, SECURITY_HEADERS } from '../../../deploy/routes.ts';
import { CONTENT_IDS } from '../src/content-ids.ts';

const DEPLOY = fileURLToPath(new URL('../../../deploy/', import.meta.url));
const read = (f: string): string => readFileSync(join(DEPLOY, f), 'utf8');

describe('déploiement', () => {
  const caddy = read('Caddyfile');
  const compose = read('docker-compose.yml');

  it('le Caddyfile pose chaque en-tête de sécurité, avec la même valeur', () => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(caddy, name).toContain(`${name} "${value}"`);
    }
    expect(caddy).toContain(`Strict-Transport-Security "${HSTS}"`);
    expect(caddy).toContain(`Cache-Control "${CACHE_ASSETS}"`);
  });

  it('le Caddyfile suit les routes : bloquées, comptes, jeu', () => {
    const blocked = /@blocked \{\s*path ([^\n]+)\n/.exec(caddy)![1]!.split(/\s+/);
    for (const r of ROUTES) {
      if (r.to === 'block') {
        expect(blocked).toContain(r.path);
        // Préfixe : les sous-chemins aussi.
        if (r.exact !== true) expect(blocked).toContain(`${r.path}/*`);
      } else {
        const upstream = r.to === 'accounts' ? 'accounts:8787' : 'game:8788';
        const path = r.exact === true ? r.path : `${r.path}*`;
        expect(caddy, r.path).toMatch(
          new RegExp(`handle ${path.replace(/[*/]/g, '\\$&')} \\{\\s*reverse_proxy ${upstream}`),
        );
      }
    }
  });

  it('la composition donne aux serveurs leurs clés, leur contenu et l’envoi au classement', () => {
    for (const key of [
      'ACCOUNTS_TICKET_SECRETS',
      'RANKING_REPORT_SECRETS',
      'ACCOUNTS_ALLOWED_ORIGINS',
      'ACCOUNTS_SECURE_COOKIES',
      'RANKING_URL',
      'RELAY_MAX_GAMES',
    ]) {
      expect(compose, key).toContain(`${key}:`);
    }
    expect(compose).toContain(`LOBBY_FIGHTERS: ${CONTENT_IDS.fighters.join(',')}`);
    expect(compose).toContain(`LOBBY_STAGES: ${CONTENT_IDS.stages.join(',')}`);
    expect(compose).not.toMatch(/dev-uniquement/);
    // Seul le frontal est publié.
    expect(compose.match(/ports:/g)).toHaveLength(1);
    const env = read('.env.example');
    for (const key of [
      'DOMAIN',
      'ACCOUNTS_TICKET_SECRETS',
      'RANKING_REPORT_SECRETS',
      'RELAY_MAX_GAMES',
    ]) {
      expect(env).toMatch(new RegExp(`^${key}=`, 'm'));
    }
    expect(env).not.toMatch(/SECRETS=\S/);
  });

  it('clés : 43 caractères, distinctes, différentes à chaque appel', () => {
    const a = generateSecrets();
    const b = generateSecrets();
    expect(a.ticket).toHaveLength(43);
    expect(a.report).toHaveLength(43);
    expect(a.ticket).not.toBe(a.report);
    expect(a.ticket).not.toBe(b.ticket);
  });

  it('sauvegarde à chaud des deux bases, rotation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fracas-backup-'));
    try {
      for (const name of ['accounts.sqlite', 'ranking.sqlite']) {
        const db = new DatabaseSync(join(dir, name));
        db.exec('CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (42);');
        db.close();
      }
      const out = join(dir, 'sauvegardes');
      for (let i = 0; i < 3; i++) backup(dir, out, 2, new Date(Date.UTC(2026, 10, 17, 0, 0, i)));
      const written = backup(dir, out, 2, new Date(Date.UTC(2026, 10, 17, 0, 0, 9)));
      for (const f of written) {
        expect(existsSync(f)).toBe(true);
        const copy = new DatabaseSync(f, { readOnly: true });
        expect(copy.prepare('SELECT x FROM t').get()).toEqual({ x: 42 });
        copy.close();
      }
      const kept = execFileSync(process.execPath, [
        '-e',
        `console.log(require('fs').readdirSync(${JSON.stringify(out)}).length)`,
      ])
        .toString()
        .trim();
      expect(kept).toBe('4');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('journaux horodatés par le préchargement', () => {
    const out = execFileSync(process.execPath, [
      '--import',
      pathToFileURL(join(DEPLOY, 'log-time.ts')).href,
      '-e',
      "console.log('bonjour')",
    ]).toString();
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z bonjour/);
  });
});
