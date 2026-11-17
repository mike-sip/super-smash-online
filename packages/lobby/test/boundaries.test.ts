/**
 * Frontières : ce que le navigateur charge (protocole, codes, client) n'importe rien de Node, et
 * de `match-rules` seulement des types.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function importsOf(file: string): { from: string; typeOnly: boolean }[] {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  return [...source.matchAll(/^\s*(import|export)(\s+type)?\b[^'"]*?from\s+'([^']+)'/gm)].map(
    (m) => ({ from: m[3]!, typeOnly: m[2] !== undefined }),
  );
}

describe('frontières', () => {
  it('le protocole et les codes n’importent que des types de match-rules', () => {
    expect(importsOf('codes.ts')).toEqual([]);
    for (const i of importsOf('protocol.ts')) {
      expect(i).toEqual({ from: '@game/match-rules', typeOnly: true });
    }
  });

  it('le client ne dépend que du protocole et des codes', () => {
    if (!existsSync(new URL('../src/client.ts', import.meta.url))) return;
    for (const i of importsOf('client.ts')) {
      expect(['./protocol.ts', './codes.ts', '@game/match-rules']).toContain(i.from);
      if (i.from === '@game/match-rules') expect(i.typeOnly).toBe(true);
    }
  });
});
