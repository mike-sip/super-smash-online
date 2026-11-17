/**
 * Données de démonstration, tant que `lobby` n'envoie pas de vrais matchs :
 * `pnpm --filter @game/ranking seed [-- --with <identifiant de compte>] [--count <n>]`.
 *
 * Crée (ou reconnecte) quelques comptes inventés sur le serveur de développement, puis lui envoie
 * des rapports signés avec la clé de développement, exactement comme le fera `lobby`.
 */
import { randomUUID } from 'node:crypto';
import { DEV_REPORT_SECRET } from './dev-keys.ts';
import type { MatchReport, ReportedPlayer } from './protocol.ts';
import { signReport } from './report.ts';

export const SEED_PSEUDOS = [
  'Aurore',
  'Basile',
  'Capucine',
  'Dorian',
  'Elouan',
  'Faustine',
  'Gaspard',
  'Hortense',
] as const;
const SEED_PASSWORD = 'graine-de-demo-locale';
const FIGHTERS = ['vanguard', 'striker', 'bastion', 'arcanist'];

/** Petit générateur reproductible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Identifiant du compte de démonstration, créé s'il n'existe pas. */
async function seedAccount(baseUrl: string, pseudo: string): Promise<string> {
  // Connexion d'abord : à la seconde exécution, une seule tentative par compte.
  for (const path of ['login', 'register']) {
    const response = await fetch(`${baseUrl}/api/accounts/v1/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pseudo, password: SEED_PASSWORD }),
    });
    if (response.ok) return ((await response.json()) as { account: { id: string } }).account.id;
    if (response.status !== 401) {
      throw new Error(`Compte ${pseudo} : ${response.status} ${await response.text()}`);
    }
  }
  throw new Error(`Compte ${pseudo} : impossible de le créer ou de s'y connecter.`);
}

/** Places « olympiques » à partir d'un score par unité (plus grand = mieux). */
function placements(scores: readonly number[]): number[] {
  return scores.map((s) => 1 + scores.filter((o) => o > s).length);
}

/** Rapport inventé mais valide, entre les comptes donnés. */
export function randomReport(
  next: () => number,
  pool: readonly string[],
  must: string | null,
  endedAt: number,
  now: number,
): MatchReport {
  const size = Math.min(pool.length + (must === null ? 0 : 1), 2 + Math.floor(next() * 7));
  const others = [...pool].filter((id) => id !== must).sort(() => next() - 0.5);
  const ids = must === null ? others.slice(0, size) : [must, ...others.slice(0, size - 1)];
  const teams = ids.length >= 4 && next() < 0.3;
  const teamOf = ids.map((_, i) => (teams ? i % 2 : -1));
  const unitScore = new Map<number, number>();
  ids.forEach((_, i) => {
    const key = teams ? teamOf[i]! : i;
    if (!unitScore.has(key)) unitScore.set(key, next());
  });
  // Une place par unité (joueur ou équipe), comptée parmi les unités.
  const unitPlaces = placements([...unitScore.values()]);
  const unitKeys = [...unitScore.keys()];
  const places = ids.map((_, i) => unitPlaces[unitKeys.indexOf(teams ? teamOf[i]! : i)]!);
  const endFrame = 3600 + Math.floor(next() * 10_000);
  const players: ReportedPlayer[] = ids.map((accountId, i) => ({
    accountId,
    guest: false,
    fighter: FIGHTERS[Math.floor(next() * FIGHTERS.length)]!,
    team: teamOf[i]!,
    placement: places[i]!,
    kos: Math.floor(next() * 5),
    falls: Math.floor(next() * 4),
    leftAtFrame: next() < 0.05 ? Math.floor(next() * endFrame) : null,
  }));
  return {
    version: 1,
    matchId: randomUUID(),
    reportedAt: now,
    endedAt,
    ranked: next() < 0.8,
    mode: (['stock', 'time', 'stamina'] as const)[Math.floor(next() * 3)]!,
    teams,
    endFrame,
    players,
  };
}

export interface SeedOptions {
  readonly baseUrl: string;
  readonly secret: string;
  readonly count: number;
  /** Compte à inclure dans chaque match (pour remplir son historique). */
  readonly with?: string | null;
  readonly seed?: number;
}

/** Crée les comptes de démonstration et envoie `count` rapports. Renvoie leurs identifiants. */
export async function seedMatches(
  options: SeedOptions,
): Promise<{ accounts: string[]; sent: number }> {
  const accounts: string[] = [];
  for (const pseudo of SEED_PSEUDOS) accounts.push(await seedAccount(options.baseUrl, pseudo));
  const next = rng(options.seed ?? Date.now());
  const now = Date.now();
  let sent = 0;
  for (let i = 0; i < options.count; i++) {
    const endedAt = now - (options.count - i) * 37 * 60_000;
    const report = randomReport(next, accounts, options.with ?? null, endedAt, now);
    const body = JSON.stringify(report);
    const response = await fetch(`${options.baseUrl}/api/ranking/v1/matches`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: signReport(body, options.secret),
      },
      body,
    });
    if (!response.ok)
      throw new Error(`Rapport refusé : ${response.status} ${await response.text()}`);
    sent++;
  }
  return { accounts, sent };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (import.meta.main) {
  const baseUrl = process.env.RANKING_URL ?? 'http://127.0.0.1:8787';
  const count = Number(argument('count') ?? 40);
  try {
    const { sent } = await seedMatches({
      baseUrl,
      secret: process.env.RANKING_REPORT_SECRET ?? DEV_REPORT_SECRET,
      count,
      with: argument('with') ?? null,
    });
    console.log(`${sent} matchs envoyés à ${baseUrl} entre ${SEED_PSEUDOS.join(', ')}.`);
  } catch (error) {
    console.error(`Échec : ${(error as Error).message}`);
    console.error('Le serveur de développement tourne-t-il ? pnpm --filter @game/ranking dev');
    process.exit(1);
  }
}
