/**
 * Frontières entre fichiers : le protocole, chargé par le navigateur, n'importe rien de Node ; la
 * signature des rapports, utilisée par `lobby`, ne dépend que de `node:crypto` ; la formule est pure.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function importsOf(file: string): string[] {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  return [...source.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+'([^']+)'/gm)].map((m) => m[1]!);
}

describe('frontières', () => {
  it('le protocole n’importe que les types de match-rules', () => {
    expect(importsOf('protocol.ts')).toEqual(['@game/match-rules']);
    const source = readFileSync(new URL('../src/protocol.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/^import type \{ MatchResult \} from '@game\/match-rules';$/m);
  });

  it('la signature des rapports ne dépend que de node:crypto', () => {
    expect(importsOf('report.ts')).toEqual(['node:crypto']);
  });

  it('la formule ne dépend que du protocole', () => {
    expect(importsOf('rating.ts')).toEqual(['./protocol.ts']);
  });
});
