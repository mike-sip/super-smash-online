/**
 * Stockage SQLite du classement par `node:sqlite` : un fichier à part de celui des comptes, un
 * seul processus. Requêtes préparées uniquement. Le schéma évolue par migrations numérotées ;
 * `PRAGMA user_version` note la dernière appliquée.
 */
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import type { MatchMode } from './protocol.ts';
import {
  MatchExistsError,
  type FighterRecord,
  type LeaderboardRow,
  type MatchRecord,
  type ParticipantRecord,
  type PlayerRecord,
  type RankingStore,
  type UnsyncedParticipation,
} from './store.ts';

/** Chaque entrée fait passer le schéma de la version `index` à `index + 1`. Ne jamais modifier une entrée publiée : en ajouter une. */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE matches (
     match_id         TEXT PRIMARY KEY,
     fingerprint      TEXT NOT NULL,
     ranked           INTEGER NOT NULL CHECK (ranked IN (0, 1)),
     requested_ranked INTEGER NOT NULL CHECK (requested_ranked IN (0, 1)),
     mode             TEXT NOT NULL,
     teams            INTEGER NOT NULL CHECK (teams IN (0, 1)),
     end_frame        INTEGER NOT NULL,
     ended_at         INTEGER NOT NULL,
     recorded_at      INTEGER NOT NULL,
     units            INTEGER NOT NULL
   ) STRICT;
   CREATE TABLE participants (
     match_id            TEXT NOT NULL REFERENCES matches (match_id) ON DELETE CASCADE,
     slot                INTEGER NOT NULL,
     account_id          TEXT,
     guest               INTEGER NOT NULL CHECK (guest IN (0, 1)),
     fighter             TEXT NOT NULL,
     team                INTEGER NOT NULL,
     placement           INTEGER NOT NULL,
     effective_placement INTEGER NOT NULL,
     kos                 INTEGER NOT NULL,
     falls               INTEGER NOT NULL,
     left_at_frame       INTEGER,
     won                 INTEGER NOT NULL CHECK (won IN (0, 1)),
     rating_before       INTEGER,
     rating_after        INTEGER,
     delta               INTEGER,
     synced              INTEGER NOT NULL CHECK (synced IN (0, 1)),
     PRIMARY KEY (match_id, slot)
   ) STRICT;
   CREATE INDEX participants_account ON participants (account_id) WHERE account_id IS NOT NULL;
   CREATE INDEX participants_unsynced ON participants (match_id, slot) WHERE synced = 0;
   CREATE INDEX matches_history ON matches (ended_at DESC, match_id DESC);
   CREATE TABLE players (
     account_id     TEXT PRIMARY KEY,
     rating         INTEGER,
     peak_rating    INTEGER,
     ranked_matches INTEGER NOT NULL DEFAULT 0,
     matches_played INTEGER NOT NULL DEFAULT 0,
     wins           INTEGER NOT NULL DEFAULT 0,
     kos            INTEGER NOT NULL DEFAULT 0,
     falls          INTEGER NOT NULL DEFAULT 0
   ) STRICT;
   CREATE INDEX players_board ON players (rating DESC, ranked_matches DESC, account_id)
     WHERE rating IS NOT NULL;
   CREATE TABLE fighter_stats (
     account_id TEXT NOT NULL,
     fighter    TEXT NOT NULL,
     played     INTEGER NOT NULL,
     wins       INTEGER NOT NULL,
     PRIMARY KEY (account_id, fighter)
   ) STRICT;`,
];

export const RANKING_SCHEMA_VERSION = MIGRATIONS.length;

interface MatchRow {
  match_id: string;
  fingerprint: string;
  ranked: number;
  requested_ranked: number;
  mode: string;
  teams: number;
  end_frame: number;
  ended_at: number;
  recorded_at: number;
  units: number;
}

interface ParticipantRow {
  match_id: string;
  slot: number;
  account_id: string | null;
  guest: number;
  fighter: string;
  team: number;
  placement: number;
  effective_placement: number;
  kos: number;
  falls: number;
  left_at_frame: number | null;
  won: number;
  rating_before: number | null;
  rating_after: number | null;
  delta: number | null;
  synced: number;
}

interface PlayerRow {
  account_id: string;
  rating: number | null;
  peak_rating: number | null;
  ranked_matches: number;
  matches_played: number;
  wins: number;
  kos: number;
  falls: number;
}

function toParticipant(row: ParticipantRow): ParticipantRecord {
  return {
    slot: row.slot,
    accountId: row.account_id,
    guest: row.guest === 1,
    fighter: row.fighter,
    team: row.team,
    placement: row.placement,
    effectivePlacement: row.effective_placement,
    kos: row.kos,
    falls: row.falls,
    leftAtFrame: row.left_at_frame,
    won: row.won === 1,
    ratingBefore: row.rating_before,
    ratingAfter: row.rating_after,
    delta: row.delta,
    synced: row.synced === 1,
  };
}

function toMatch(row: MatchRow, participants: readonly ParticipantRow[]): MatchRecord {
  return {
    matchId: row.match_id,
    fingerprint: row.fingerprint,
    ranked: row.ranked === 1,
    requestedRanked: row.requested_ranked === 1,
    mode: row.mode as MatchMode,
    teams: row.teams === 1,
    endFrame: row.end_frame,
    endedAt: row.ended_at,
    recordedAt: row.recorded_at,
    units: row.units,
    participants: participants.map(toParticipant),
  };
}

function toPlayer(row: PlayerRow): PlayerRecord {
  return {
    accountId: row.account_id,
    rating: row.rating,
    peakRating: row.peak_rating,
    rankedMatches: row.ranked_matches,
    matchesPlayed: row.matches_played,
    wins: row.wins,
    kos: row.kos,
    falls: row.falls,
  };
}

const bit = (value: boolean): number => (value ? 1 : 0);

function migrate(db: DatabaseSync): void {
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  if (version > RANKING_SCHEMA_VERSION) {
    throw new Error(
      `Base du classement en version ${version}, plus récente que ce serveur (${RANKING_SCHEMA_VERSION}).`,
    );
  }
  for (let v = version; v < RANKING_SCHEMA_VERSION; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

/** Expression SQL du rang « olympique » d'un joueur coté `p`. */
const RANK_SQL = `1 + (SELECT COUNT(*) FROM players o
                       WHERE o.rating IS NOT NULL AND o.ranked_matches >= :min AND o.rating > p.rating)`;

/** Ouvre (ou crée) une base. `':memory:'` donne une base éphémère. */
export function openRankingSqliteStore(path: string): RankingStore {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    // Les données d'un compte supprimé sont effacées du fichier, pas seulement marquées libres.
    db.exec('PRAGMA secure_delete = ON');
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }

  const statements = new Map<string, StatementSync>();
  const sql = (text: string): StatementSync => {
    let statement = statements.get(text);
    if (statement === undefined) {
      statement = db.prepare(text);
      statements.set(text, statement);
    }
    return statement;
  };

  function transaction<T>(work: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function participantsOf(matchIds: readonly string[]): Map<string, ParticipantRow[]> {
    const result = new Map<string, ParticipantRow[]>();
    for (const id of matchIds) {
      result.set(
        id,
        sql('SELECT * FROM participants WHERE match_id = ? ORDER BY slot').all(
          id,
        ) as unknown as ParticipantRow[],
      );
    }
    return result;
  }

  function applyParticipant(p: ParticipantRecord): void {
    if (p.accountId === null) return;
    const ranked = p.ratingAfter !== null;
    sql(
      `INSERT INTO players (account_id, rating, peak_rating, ranked_matches, matches_played, wins, kos, falls)
       VALUES (:id, :rating, :rating, :ranked, 1, :won, :kos, :falls)
       ON CONFLICT (account_id) DO UPDATE SET
         rating = COALESCE(:rating, rating),
         peak_rating = CASE WHEN :rating IS NULL THEN peak_rating
                            ELSE MAX(COALESCE(peak_rating, :rating), :rating) END,
         ranked_matches = ranked_matches + :ranked,
         matches_played = matches_played + 1,
         wins = wins + :won,
         kos = kos + :kos,
         falls = falls + :falls`,
    ).run({
      id: p.accountId,
      rating: p.ratingAfter,
      ranked: bit(ranked),
      won: bit(p.won),
      kos: p.kos,
      falls: p.falls,
    });
    sql(
      `INSERT INTO fighter_stats (account_id, fighter, played, wins) VALUES (:id, :fighter, 1, :won)
       ON CONFLICT (account_id, fighter) DO UPDATE SET played = played + 1, wins = wins + :won`,
    ).run({ id: p.accountId, fighter: p.fighter, won: bit(p.won) });
  }

  return {
    async recordMatch(m) {
      transaction(() => {
        const exists = sql('SELECT 1 FROM matches WHERE match_id = ?').get(m.matchId);
        if (exists !== undefined) throw new MatchExistsError();
        sql(
          `INSERT INTO matches (match_id, fingerprint, ranked, requested_ranked, mode, teams,
             end_frame, ended_at, recorded_at, units)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          m.matchId,
          m.fingerprint,
          bit(m.ranked),
          bit(m.requestedRanked),
          m.mode,
          bit(m.teams),
          m.endFrame,
          m.endedAt,
          m.recordedAt,
          m.units,
        );
        for (const p of m.participants) {
          const values: SQLInputValue[] = [
            m.matchId,
            p.slot,
            p.accountId,
            bit(p.guest),
            p.fighter,
            p.team,
            p.placement,
            p.effectivePlacement,
            p.kos,
            p.falls,
            p.leftAtFrame,
            bit(p.won),
            p.ratingBefore,
            p.ratingAfter,
            p.delta,
            bit(p.synced),
          ];
          sql(
            `INSERT INTO participants (match_id, slot, account_id, guest, fighter, team, placement,
               effective_placement, kos, falls, left_at_frame, won, rating_before, rating_after,
               delta, synced)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(...values);
          applyParticipant(p);
        }
      });
    },

    async findMatch(matchId) {
      const row = sql('SELECT * FROM matches WHERE match_id = ?').get(matchId) as
        MatchRow | undefined;
      if (row === undefined) return null;
      return toMatch(row, participantsOf([matchId]).get(matchId)!);
    },

    async ratings(accountIds) {
      const result = new Map<string, number>();
      for (const id of accountIds) {
        const row = sql('SELECT rating FROM players WHERE account_id = ?').get(id) as
          { rating: number | null } | undefined;
        if (row !== undefined && row.rating !== null) result.set(id, row.rating);
      }
      return result;
    },

    async findPlayer(accountId) {
      const row = sql('SELECT * FROM players WHERE account_id = ?').get(accountId) as
        PlayerRow | undefined;
      return row === undefined ? null : toPlayer(row);
    },

    async fighterStats(accountId) {
      return sql(
        `SELECT fighter, played, wins FROM fighter_stats WHERE account_id = ?
         ORDER BY played DESC, fighter`,
      ).all(accountId) as unknown as FighterRecord[];
    },

    async leaderboard(offset, limit, minMatches) {
      const { total } = sql(
        'SELECT COUNT(*) AS total FROM players WHERE rating IS NOT NULL AND ranked_matches >= ?',
      ).get(minMatches) as { total: number };
      const rows = sql(
        `SELECT ${RANK_SQL} AS rank, p.account_id AS accountId, p.rating AS rating,
                p.ranked_matches AS rankedMatches, p.wins AS wins
         FROM players p
         WHERE p.rating IS NOT NULL AND p.ranked_matches >= :min
         ORDER BY p.rating DESC, p.ranked_matches DESC, p.account_id
         LIMIT :limit OFFSET :offset`,
      ).all({ min: minMatches, limit, offset }) as unknown as LeaderboardRow[];
      return { total, rows: rows.map((r) => ({ ...r })) };
    },

    async rankOf(accountId, minMatches) {
      const row = sql(
        `SELECT ${RANK_SQL} AS rank FROM players p
         WHERE p.account_id = :id AND p.rating IS NOT NULL AND p.ranked_matches >= :min`,
      ).get({ id: accountId, min: minMatches }) as { rank: number } | undefined;
      return row === undefined ? null : row.rank;
    },

    async history(accountId, before, limit) {
      const rows = (before === null
        ? sql(
            `SELECT m.* FROM matches m
               WHERE EXISTS (SELECT 1 FROM participants p WHERE p.match_id = m.match_id AND p.account_id = :id)
               ORDER BY m.ended_at DESC, m.match_id DESC LIMIT :limit`,
          ).all({ id: accountId, limit })
        : sql(
            `SELECT m.* FROM matches m
               WHERE EXISTS (SELECT 1 FROM participants p WHERE p.match_id = m.match_id AND p.account_id = :id)
                 AND (m.ended_at, m.match_id) < (:endedAt, :matchId)
               ORDER BY m.ended_at DESC, m.match_id DESC LIMIT :limit`,
          ).all({
            id: accountId,
            limit,
            endedAt: before.endedAt,
            matchId: before.matchId,
          })) as unknown as MatchRow[];
      const participants = participantsOf(rows.map((r) => r.match_id));
      return rows.map((r) => toMatch(r, participants.get(r.match_id)!));
    },

    async unsynced(limit) {
      const rows = sql(
        `SELECT p.match_id AS matchId, p.slot AS slot, p.account_id AS accountId, p.won AS won
         FROM participants p JOIN matches m ON m.match_id = p.match_id
         WHERE p.synced = 0 AND p.account_id IS NOT NULL
         ORDER BY m.recorded_at, m.match_id, p.slot LIMIT ?`,
      ).all(limit) as unknown as {
        matchId: string;
        slot: number;
        accountId: string;
        won: number;
      }[];
      return rows.map((r): UnsyncedParticipation => ({
        matchId: r.matchId,
        slot: r.slot,
        accountId: r.accountId,
        won: r.won === 1,
      }));
    },

    async markSynced(matchId, slot) {
      sql('UPDATE participants SET synced = 1 WHERE match_id = ? AND slot = ?').run(matchId, slot);
    },

    async deleteAccount(accountId) {
      return transaction(() => {
        const players = sql('DELETE FROM players WHERE account_id = ?').run(accountId).changes;
        sql('DELETE FROM fighter_stats WHERE account_id = ?').run(accountId);
        const parts = sql(
          'UPDATE participants SET account_id = NULL, synced = 1 WHERE account_id = ?',
        ).run(accountId).changes;
        return Number(players) + Number(parts) > 0;
      });
    },

    async knownAccounts() {
      const rows = sql(
        `SELECT account_id AS id FROM players
         UNION SELECT account_id FROM participants WHERE account_id IS NOT NULL`,
      ).all() as unknown as { id: string }[];
      return rows.map((r) => r.id);
    },

    async close() {
      if (db.isOpen) db.close();
    },
  };
}
