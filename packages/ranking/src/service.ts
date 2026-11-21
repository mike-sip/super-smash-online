/**
 * Règles métier du classement : soumission idempotente des rapports, calcul des cotes,
 * synchronisation des compteurs d'`accounts`, lectures, suppression. Sans HTTP : horloge,
 * stockage et comptes injectés.
 */
import { createHash } from 'node:crypto';
import {
  canonicalReport,
  isUuid,
  validateReport,
  type HistoryEntry,
  type HistoryPlayer,
  type HistoryResponse,
  type LeaderboardResponse,
  type MatchReport,
  type RankingProfile,
  type RatingChange,
  type SubmitResponse,
} from './protocol.ts';
import { INITIAL_RATING, computeRatingChanges, standings } from './rating.ts';
import {
  MatchExistsError,
  type HistoryCursor,
  type MatchRecord,
  type ParticipantRecord,
  type RankingStore,
} from './store.ts';

/** Nombre de matchs classés pour figurer au classement. */
export const LEADERBOARD_MIN_MATCHES = 5;
export const LEADERBOARD_MAX_LIMIT = 100;
export const HISTORY_DEFAULT_LIMIT = 20;
export const HISTORY_MAX_LIMIT = 50;
/** Taille des lots de la synchronisation et du balayage. */
const BATCH = 200;

export const DELETED_NAME = 'Joueur supprimé';

/**
 * Ce que le classement utilise d'`accounts`. `AccountService` le satisfait ; les tests du service
 * utilisent un faux.
 */
export interface AccountsPort {
  /** Pseudos actuels des comptes existants ; les identifiants inconnus sont absents. */
  publicNames(ids: readonly string[]): Promise<Map<string, { pseudo: string; guest: boolean }>>;
  /** Ajoute un match aux compteurs du profil ; faux si le compte n'existe plus. */
  recordMatch(accountId: string, won: boolean): Promise<boolean>;
  onAccountDeleted(listener: (accountId: string) => void | Promise<void>): () => void;
}

export type SubmitOutcome =
  | { readonly ok: true; readonly created: boolean; readonly value: SubmitResponse }
  | {
      readonly ok: false;
      readonly error: 'invalid_report' | 'conflict';
      readonly problems?: readonly string[];
    };

export type HistoryOutcome =
  | { readonly ok: true; readonly value: HistoryResponse }
  | { readonly ok: false; readonly error: 'bad_request' };

function fingerprintOf(report: MatchReport): string {
  return createHash('sha256').update(canonicalReport(report)).digest('hex');
}

function changesOf(match: MatchRecord): RatingChange[] {
  const changes: RatingChange[] = [];
  for (const p of match.participants) {
    if (p.delta === null || p.ratingBefore === null || p.ratingAfter === null) continue;
    // Après une suppression, l'identifiant a disparu : la variation reste, anonyme.
    changes.push({
      accountId: p.accountId ?? '',
      before: p.ratingBefore,
      after: p.ratingAfter,
      delta: p.delta,
    });
  }
  return changes;
}

const CURSOR = /^(0|[1-9][0-9]{0,15})\.([0-9a-f-]{36})$/;

function parseCursor(value: string): HistoryCursor | null {
  const match = CURSOR.exec(value);
  if (match === null || !isUuid(match[2])) return null;
  const endedAt = Number(match[1]);
  if (!Number.isSafeInteger(endedAt)) return null;
  return { endedAt, matchId: match[2]! };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export interface RankingServiceOptions {
  readonly store: RankingStore;
  readonly accounts: AccountsPort;
  readonly now?: () => number;
}

export class RankingService {
  readonly #store: RankingStore;
  readonly #accounts: AccountsPort;
  readonly #now: () => number;
  /** File : les écritures passent une à une (un seul processus). */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: RankingServiceOptions) {
    this.#store = options.store;
    this.#accounts = options.accounts;
    this.#now = options.now ?? Date.now;
  }

  #serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(work, work);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  /** Écoute les suppressions de compte. Renvoie de quoi arrêter d'écouter. */
  attach(): () => void {
    return this.#accounts.onAccountDeleted((id) => this.forget(id));
  }

  /** Efface les données d'un compte supprimé. */
  async forget(accountId: string): Promise<void> {
    await this.#serial(() => this.#store.deleteAccount(accountId));
  }

  // --- Soumission ------------------------------------------------------------------------------

  /** Valide et enregistre un rapport, une seule fois par `matchId`. */
  async submit(value: unknown): Promise<SubmitOutcome> {
    const validation = validateReport(value);
    if (!validation.ok) {
      return { ok: false, error: 'invalid_report', problems: validation.problems };
    }
    const report = validation.report;
    const fingerprint = fingerprintOf(report);
    const outcome = await this.#serial(() => this.#record(report, fingerprint));
    if (outcome.ok && outcome.created) await this.syncPending();
    return outcome;
  }

  async #existing(matchId: string, fingerprint: string): Promise<SubmitOutcome | null> {
    const match = await this.#store.findMatch(matchId);
    if (match === null) return null;
    if (match.fingerprint !== fingerprint) return { ok: false, error: 'conflict' };
    return {
      ok: true,
      created: false,
      value: { status: 'duplicate', ranked: match.ranked, changes: changesOf(match) },
    };
  }

  async #record(report: MatchReport, fingerprint: string): Promise<SubmitOutcome> {
    const known = await this.#existing(report.matchId, fingerprint);
    if (known !== null) return known;

    const ids = report.players.map((p) => p.accountId);
    const names = await this.#accounts.publicNames(ids);
    // Invité selon le rapport ou selon les comptes ; un compte inconnu est traité en invité, et
    // rien n'est gardé à son nom.
    const exists = report.players.map((p) => names.has(p.accountId));
    const guest = report.players.map((p) => p.guest || names.get(p.accountId)?.guest !== false);
    const rated = report.players.map((_, i) => report.ranked && !guest[i]);
    const ratings = await this.#store.ratings(ids.filter((_, i) => rated[i]));

    const input = {
      teams: report.teams,
      players: report.players.map((p, i) => ({
        accountId: p.accountId,
        rating: rated[i] ? (ratings.get(p.accountId) ?? INITIAL_RATING) : null,
        team: p.team,
        placement: p.placement,
        leftAtFrame: p.leftAtFrame,
      })),
    };
    const { units, placements } = standings(input);
    const { ranked, changes } = computeRatingChanges(input);
    const byAccount = new Map(changes.map((c) => [c.accountId, c]));

    const participants: ParticipantRecord[] = report.players.map((p, i) => {
      const change = byAccount.get(p.accountId);
      return {
        slot: i,
        accountId: exists[i] ? p.accountId : null,
        guest: guest[i]!,
        fighter: p.fighter,
        team: p.team,
        placement: p.placement,
        effectivePlacement: placements[i]!,
        kos: p.kos,
        falls: p.falls,
        leftAtFrame: p.leftAtFrame,
        won: placements[i] === 1 && p.leftAtFrame === null,
        ratingBefore: change?.before ?? null,
        ratingAfter: change?.after ?? null,
        delta: change?.delta ?? null,
        synced: !exists[i],
      };
    });
    const match: MatchRecord = {
      matchId: report.matchId,
      fingerprint,
      ranked,
      requestedRanked: report.ranked,
      mode: report.mode,
      teams: report.teams,
      endFrame: report.endFrame,
      endedAt: report.endedAt,
      recordedAt: this.#now(),
      units,
      participants,
    };
    try {
      await this.#store.recordMatch(match);
    } catch (error) {
      // Une autre instance l'a enregistré entre-temps : même réponse qu'un doublon.
      if (error instanceof MatchExistsError) {
        const raced = await this.#existing(report.matchId, fingerprint);
        if (raced !== null) return raced;
      }
      throw error;
    }
    return { ok: true, created: true, value: { status: 'recorded', ranked, changes } };
  }

  /**
   * Reporte dans `accounts` les participations pas encore comptées. Une panne laisse la
   * participation en attente, pour le prochain passage. Renvoie le nombre traité.
   */
  async syncPending(): Promise<number> {
    return this.#serial(async () => {
      let done = 0;
      for (const item of await this.#store.unsynced(BATCH)) {
        try {
          await this.#accounts.recordMatch(item.accountId, item.won);
        } catch {
          // Rien de personnel dans le journal ; on réessaiera.
          console.error('ranking : mise à jour des compteurs du profil en échec, reportée.');
          continue;
        }
        await this.#store.markSynced(item.matchId, item.slot);
        done++;
      }
      return done;
    });
  }

  /** Efface les données des comptes qui n'existent plus (invités purgés sans écouteur). */
  async sweep(): Promise<number> {
    return this.#serial(async () => {
      const known = await this.#store.knownAccounts();
      let removed = 0;
      for (let i = 0; i < known.length; i += BATCH) {
        const batch = known.slice(i, i + BATCH);
        const names = await this.#accounts.publicNames(batch);
        for (const id of batch) {
          if (!names.has(id) && (await this.#store.deleteAccount(id))) removed++;
        }
      }
      return removed;
    });
  }

  // --- Lectures --------------------------------------------------------------------------------

  async getRating(accountId: string): Promise<number | null> {
    return (await this.#store.ratings([accountId])).get(accountId) ?? null;
  }

  async leaderboard(offset: number, limit: number): Promise<LeaderboardResponse> {
    const start = clamp(offset, 0, Number.MAX_SAFE_INTEGER);
    const size = clamp(limit, 1, LEADERBOARD_MAX_LIMIT);
    const { total, rows } = await this.#store.leaderboard(start, size, LEADERBOARD_MIN_MATCHES);
    const names = await this.#accounts.publicNames(rows.map((r) => r.accountId));
    return {
      total,
      entries: rows.map((r) => ({ ...r, pseudo: names.get(r.accountId)?.pseudo ?? DELETED_NAME })),
    };
  }

  async profile(accountId: string): Promise<RankingProfile> {
    const [player, fighters, rank] = await Promise.all([
      this.#store.findPlayer(accountId),
      this.#store.fighterStats(accountId),
      this.#store.rankOf(accountId, LEADERBOARD_MIN_MATCHES),
    ]);
    return {
      rating: player?.rating ?? null,
      provisional: (player?.rankedMatches ?? 0) < LEADERBOARD_MIN_MATCHES,
      rank,
      peakRating: player?.peakRating ?? null,
      rankedMatches: player?.rankedMatches ?? 0,
      matchesPlayed: player?.matchesPlayed ?? 0,
      wins: player?.wins ?? 0,
      kos: player?.kos ?? 0,
      falls: player?.falls ?? 0,
      fighters: fighters.map((f) => ({ fighter: f.fighter, played: f.played, wins: f.wins })),
    };
  }

  /** Historique du joueur, du plus récent au plus ancien. `cursor` : `next` de la page précédente. */
  async history(
    accountId: string,
    cursor?: string,
    limit = HISTORY_DEFAULT_LIMIT,
  ): Promise<HistoryOutcome> {
    let before: HistoryCursor | null = null;
    if (cursor !== undefined) {
      before = parseCursor(cursor);
      if (before === null) return { ok: false, error: 'bad_request' };
    }
    const size = clamp(limit, 1, HISTORY_MAX_LIMIT);
    const rows = await this.#store.history(accountId, before, size + 1);
    const page = rows.slice(0, size);
    const ids = new Set<string>();
    for (const m of page) for (const p of m.participants) if (p.accountId) ids.add(p.accountId);
    const names = await this.#accounts.publicNames([...ids]);

    const matches: HistoryEntry[] = page.map((m) => {
      const me = m.participants.find((p) => p.accountId === accountId)!;
      const players: HistoryPlayer[] = m.participants.map((p) => {
        const name = p.accountId === null ? undefined : names.get(p.accountId);
        return {
          name: name?.pseudo ?? DELETED_NAME,
          kind: name === undefined ? 'deleted' : p.guest ? 'guest' : 'account',
          fighter: p.fighter,
          placement: p.effectivePlacement,
          team: p.team,
          left: p.leftAtFrame !== null,
        };
      });
      return {
        matchId: m.matchId,
        endedAt: new Date(m.endedAt).toISOString(),
        mode: m.mode,
        teams: m.teams,
        ranked: m.ranked,
        placement: me.effectivePlacement,
        units: m.units,
        fighter: me.fighter,
        left: me.leftAtFrame !== null,
        delta: me.delta,
        ratingAfter: me.ratingAfter,
        players,
      };
    });
    const last = page.at(-1);
    const next =
      rows.length > size && last !== undefined ? `${last.endedAt}.${last.matchId}` : null;
    return { ok: true, value: { matches, next } };
  }
}
