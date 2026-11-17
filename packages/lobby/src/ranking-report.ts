/**
 * Expéditeur des résultats de match vers le classement (`ranking`), branché sur
 * `LobbyOptions.onMatchResult` par `main.ts`.
 *
 * Seuls les matchs `agreed` partent. Chaque rapport est signé (HMAC, `signReport`) et envoyé par
 * `POST /api/ranking/v1/matches`. En cas d'échec passager (réseau, 5xx, pas de réponse en 5 s),
 * il est renvoyé avec le même `matchId` (clé d'idempotence) et une date d'envoi neuve, après
 * 1, 2, 4… s, jamais plus de 60 s d'écart, pendant 24 h au plus. Un refus du classement (4xx)
 * est une erreur de configuration ou de code : abandon journalisé.
 *
 * Horloge, minuteries et `fetch` sont injectés. Les journaux ne contiennent ni pseudo, ni
 * identifiant de compte : seulement le début du `matchId` et des nombres.
 */
import type { MatchResult } from '@game/match-rules';
import { reportFromResult, type MatchReport } from '@game/ranking/protocol';
import { signReport } from '@game/ranking/report';
import type { MatchRecord } from './results.ts';

export interface ReporterOptions {
  /** Adresse complète de la route, ex. `http://accounts:8787/api/ranking/v1/matches`. */
  readonly url: string;
  /** Première clé de `RANKING_REPORT_SECRETS`. */
  readonly secret: string;
  readonly now: () => number;
  readonly fetch: typeof fetch;
  /** Lance `fn` dans `ms` millisecondes ; renvoie de quoi l'annuler. */
  readonly setTimer: (fn: () => void, ms: number) => () => void;
  readonly log?: (message: string) => void;
  /** Rapports en attente au plus ; défaut 1 000. */
  readonly maxQueue?: number;
}

export interface RankingReporter {
  /** Met le match en file s'il est `agreed` ; ignore le reste. Ne lève jamais. */
  submit(record: MatchRecord): void;
  /** Rapports pas encore acceptés par le classement. */
  pending(): number;
  /** Dernier essai pour ce qui attend, puis journalise ce qui reste. Plus rien ne part ensuite. */
  close(): Promise<void>;
}

export const REPORT_TIMEOUT_MS = 5_000;
export const FIRST_RETRY_MS = 1_000;
export const MAX_RETRY_MS = 60_000;
export const GIVE_UP_AFTER_MS = 24 * 3_600_000;
const DEFAULT_MAX_QUEUE = 1_000;

/** Rapport `ranking` d'un match accepté. Lève si le match n'a pas de résultat accepté. */
export function reportFromRecord(record: MatchRecord, reportedAt: number): MatchReport {
  if (record.status !== 'agreed' || record.endFrame === null) {
    throw new Error(`reportFromRecord : match ${record.status}, sans résultat accepté.`);
  }
  const players = record.players.map((p) => {
    if (p.result === null) throw new Error('reportFromRecord : résultat de joueur manquant.');
    return p.result;
  });
  // `reportFromResult` ne lit que la configuration, la frame de fin et les résultats par place.
  const result: MatchResult = {
    config: record.config,
    endFrame: record.endFrame,
    reason: 'last-standing',
    winners: record.winners,
    winningTeam: null,
    players,
  };
  return reportFromResult(result, {
    matchId: record.matchId,
    ranked: record.ranked,
    endedAt: record.endedAt,
    reportedAt,
    players: record.players.map((p) => ({
      accountId: p.accountId,
      guest: p.guest,
      fighter: p.fighter,
      leftAtFrame: p.leftAtFrame,
    })),
  });
}

interface Job {
  readonly record: MatchRecord;
  readonly firstAt: number;
  attempts: number;
  cancelRetry: (() => void) | null;
  inFlight: Promise<void> | null;
}

type Outcome = 'done' | 'retry' | 'refused';

export function createRankingReporter(options: ReporterOptions): RankingReporter {
  const log = options.log ?? (() => {});
  const maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE;
  const jobs = new Set<Job>();
  let closed = false;

  const label = (job: Job): string => `rapport ${job.record.matchId.slice(0, 8)}`;

  async function send(job: Job): Promise<Outcome> {
    job.attempts++;
    let body: string;
    try {
      body = JSON.stringify(reportFromRecord(job.record, options.now()));
    } catch {
      log(`[classement] ${label(job)} : enregistrement inutilisable, abandon.`);
      return 'refused';
    }
    const controller = new AbortController();
    const cancelTimeout = options.setTimer(() => controller.abort(), REPORT_TIMEOUT_MS);
    try {
      const response = await options.fetch(options.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: signReport(body, options.secret),
        },
        body,
        signal: controller.signal,
      });
      if (response.status === 201 || response.status === 200) {
        log(`[classement] ${label(job)} : accepté (${response.status}).`);
        return 'done';
      }
      if (response.status >= 400 && response.status < 500) {
        log(`[classement] ${label(job)} : refusé (${response.status}), abandon.`);
        return 'refused';
      }
      log(`[classement] ${label(job)} : erreur ${response.status}, nouvel essai prévu.`);
      return 'retry';
    } catch {
      log(`[classement] ${label(job)} : classement injoignable, nouvel essai prévu.`);
      return 'retry';
    } finally {
      cancelTimeout();
    }
  }

  function finish(job: Job): void {
    job.cancelRetry?.();
    jobs.delete(job);
  }

  function attempt(job: Job): void {
    job.cancelRetry = null;
    job.inFlight = send(job).then((outcome) => {
      job.inFlight = null;
      if (outcome !== 'retry' || closed) {
        if (outcome !== 'retry') finish(job);
        return;
      }
      if (options.now() - job.firstAt >= GIVE_UP_AFTER_MS) {
        log(`[classement] ${label(job)} : abandon après ${job.attempts} essais.`);
        finish(job);
        return;
      }
      const delay = Math.min(FIRST_RETRY_MS * 2 ** (job.attempts - 1), MAX_RETRY_MS);
      job.cancelRetry = options.setTimer(() => attempt(job), delay);
    });
  }

  return {
    submit(record) {
      if (closed) return;
      if (record.status !== 'agreed') return;
      if (jobs.size >= maxQueue) {
        log(`[classement] file pleine (${jobs.size}) : rapport ${record.matchId.slice(0, 8)} perdu.`);
        return;
      }
      const job: Job = {
        record,
        firstAt: options.now(),
        attempts: 0,
        cancelRetry: null,
        inFlight: null,
      };
      jobs.add(job);
      attempt(job);
    },
    pending: () => jobs.size,
    async close() {
      if (closed) return;
      closed = true;
      await Promise.all([...jobs].map((j) => j.inFlight));
      const waiting = [...jobs];
      await Promise.all(
        waiting.map(async (job) => {
          job.cancelRetry?.();
          job.cancelRetry = null;
          if ((await send(job)) !== 'retry') jobs.delete(job);
        }),
      );
      for (const job of jobs) log(`[classement] arrêt : ${label(job)} perdu.`);
      jobs.clear();
    },
  };
}
