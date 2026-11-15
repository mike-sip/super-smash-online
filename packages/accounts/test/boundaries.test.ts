/**
 * Frontières entre fichiers : ce que le navigateur charge ne doit rien importer de Node, et la
 * vérification des tickets, utilisée par le relais, ne doit dépendre que de `node:crypto`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function importsOf(file: string): string[] {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  return [...source.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+'([^']+)'/gm)].map((m) => m[1]!);
}

describe('frontières', () => {
  it('le protocole et les validations ne dépendent que les uns des autres', () => {
    expect(importsOf('names.ts')).toEqual(['./protocol.ts', './wordlists.ts']);
    const allowed = ['./protocol.ts', './names.ts', './passwords.ts', './wordlists.ts'];
    for (const file of ['protocol.ts', 'names.ts', 'passwords.ts', 'wordlists.ts']) {
      for (const target of importsOf(file))
        expect(allowed, `${file} importe ${target}`).toContain(target);
    }
  });

  it('la vérification des tickets ne dépend que de node:crypto', () => {
    expect(importsOf('ticket.ts')).toEqual(['node:crypto']);
  });
});
