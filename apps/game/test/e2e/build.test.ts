/**
 * Contenu du build de production (`dist/`, construit par `test:e2e`) : ni prise de test, ni clé
 * de développement, ni carte des sources, ni script ou style en ligne (la politique de sécurité
 * du contenu les refuserait).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}

describe('build de production', () => {
  it('existe', () => {
    expect(existsSync(join(DIST, 'index.html'))).toBe(true);
  });

  it('sans prise de test, sans clé de développement, sans carte des sources', () => {
    const all = files(DIST);
    expect(all.filter((f) => f.endsWith('.map'))).toEqual([]);
    for (const f of all.filter((x) => /\.(js|html|css)$/.test(x))) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toContain('__game');
      expect(text, f).not.toContain('dev-uniquement');
      expect(text, f).not.toContain('VITE_TEST_HOOK');
    }
  });

  it('index.html : scripts externes seulement, aucun style en ligne, titre du jeu', () => {
    const html = readFileSync(join(DIST, 'index.html'), 'utf8');
    for (const tag of html.match(/<script\b[^>]*>/g) ?? []) expect(tag).toMatch(/\bsrc=/);
    expect(html).not.toMatch(/<style\b/);
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).toContain('<title>Fracas</title>');
  });
});
