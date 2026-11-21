/**
 * Passerelle locale (et donc description des routes du frontal) : routes internes bloquées sous
 * toutes leurs formes, fichiers hors du client inaccessibles, adresse du client imposée au serveur
 * en aval (un `X-Forwarded-For` envoyé par le client ne passe pas).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGateway } from '../../../deploy/gateway.ts';

let upstream: Server;
let gateway: Server;
let base: string;
let root: string;
const seen: { url: string; xff: string | undefined }[] = [];

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'fracas-gw-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>Fracas</title>');
  writeFileSync(join(tmpdir(), 'fracas-secret.txt'), 'secret');
  upstream = createServer((req, res) => {
    seen.push({ url: req.url ?? '', xff: req.headers['x-forwarded-for'] as string | undefined });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"upstream":true}');
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  const up = new URL(`http://127.0.0.1:${(upstream.address() as { port: number }).port}`);
  gateway = createGateway({ root, port: 0, upstreams: { accounts: up, game: up } });
  await new Promise<void>((r) => gateway.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(gateway.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => gateway.close(() => r()));
  await new Promise<void>((r) => upstream.close(() => r()));
  rmSync(root, { recursive: true, force: true });
});

describe('passerelle', () => {
  it.each([
    '/api/ranking/v1/matches',
    '/api/ranking/v1/matches/',
    '/api/ranking/v1/matches/x',
    '/api/ranking/v1/matches?x=1',
    '/health',
    '/health/details',
  ])('%s : refusé depuis l’extérieur', async (path) => {
    const before = seen.length;
    const r = await fetch(base + path, { method: 'POST' });
    expect(r.status).toBe(404);
    expect(seen.length).toBe(before);
  });

  it('les routes publiques arrivent au serveur en aval', async () => {
    expect((await fetch(`${base}/api/ranking/v1/leaderboard`)).status).toBe(200);
    expect((await fetch(`${base}/api/accounts/v1/session`)).status).toBe(200);
  });

  it('un X-Forwarded-For du client est remplacé par sa vraie adresse', async () => {
    await fetch(`${base}/api/accounts/v1/session`, { headers: { 'x-forwarded-for': '6.6.6.6' } });
    const last = seen[seen.length - 1]!;
    expect(last.xff).not.toContain('6.6.6.6');
    expect(last.xff).toMatch(/127\.0\.0\.1/);
  });

  it('aucun fichier hors du client, même encodé', async () => {
    for (const path of [
      '/../fracas-secret.txt',
      '/..%2ffracas-secret.txt',
      '/%2e%2e/fracas-secret.txt',
    ]) {
      const text = await (await fetch(base + path)).text();
      expect(text, path).not.toContain('secret');
      expect(text, path).toContain('<title>Fracas</title>');
    }
  });

  it('en-têtes de sécurité et cache', async () => {
    const r = await fetch(`${base}/`);
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(r.headers.get('cache-control')).toBe('no-cache');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
  });
});
