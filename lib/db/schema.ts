/**
 * Drizzle schema. Migration history in drizzle/, applied live on Neon
 * as of M4a. Each schema change goes through `db:generate` to emit a
 * new migration SQL file in drizzle/, then `db:migrate` to apply it.
 */
import {
  pgTable,
  serial,
  integer,
  varchar,
  boolean,
  date,
  timestamp,
  char,
  jsonb,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

export const puzzles = pgTable('puzzles', {
  id: serial('id').primaryKey(),
  dayNumber: integer('day_number').notNull().unique(),
  date: date('date').notNull().unique(),
  word: varchar('word', { length: 9 }).notNull(),
  grid: char('grid', { length: 9 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const solves = pgTable(
  'solves',
  {
    id: serial('id').primaryKey(),
    puzzleId: integer('puzzle_id').references(() => puzzles.id).notNull(),
    wallet: varchar('wallet', { length: 42 }),
    sessionId: varchar('session_id', { length: 64 }).notNull(),
    solved: boolean('solved').default(false).notNull(),
    bestWord: varchar('best_word', { length: 9 }),
    clientSolveMs: integer('client_solve_ms'),
    serverSolveMs: integer('server_solve_ms'),
    keystrokeIntervalsMs: jsonb('keystroke_intervals_ms').$type<number[]>(),
    keystrokeCount: integer('keystroke_count'),
    keystrokeStddevMs: integer('keystroke_stddev_ms'),
    keystrokeMinMs: integer('keystroke_min_ms'),
    unassisted: boolean('unassisted').default(false).notNull(),
    flag: varchar('flag', { length: 16 }), // null | 'ineligible' | 'suspicious'
    rewardClaimed: boolean('reward_claimed').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    // Supports the admin Pulse query, which time-bounds every aggregate
    // to a 7-day window. Without this index, PG does a sequential scan
    // of the entire table on every Pulse fetch; the query's WHERE
    // clause bounds the scan but can't use an index to find the window
    // boundary without one. Low-cardinality-safe since timestamps are
    // ~unique per row.
    createdAtIdx: index('solves_created_at_idx').on(t.createdAt),
  }),
);

export const premiumUsers = pgTable('premium_users', {
  wallet: varchar('wallet', { length: 42 }).primaryKey(),
  unlockedAt: timestamp('unlocked_at').defaultNow().notNull(),
  txHash: varchar('tx_hash', { length: 66 }).notNull(),
});

export const streaks = pgTable('streaks', {
  wallet: varchar('wallet', { length: 42 }).primaryKey(),
  currentStreak: integer('current_streak').default(0).notNull(),
  longestStreak: integer('longest_streak').default(0).notNull(),
  lastSolvedDayNumber: integer('last_solved_day_number'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const leaderboard = pgTable(
  'leaderboard',
  {
    puzzleId: integer('puzzle_id').references(() => puzzles.id).notNull(),
    wallet: varchar('wallet', { length: 42 }).notNull(),
    serverSolveMs: integer('server_solve_ms').notNull(),
    unassisted: boolean('unassisted').default(false).notNull(),
    rank: integer('rank'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.puzzleId, t.wallet] }),
  }),
);

/**
 * Tracks when a session first received the grid for a given puzzle.
 * This is the authoritative start time for `server_solve_ms` — we can’t
 * trust the client’s self-reported timer because a bot can lie about it.
 *
 * Populated by `/api/puzzle/today` on first load for a (session_id, puzzle_id)
 * pair. Read by `/api/solve` to compute `now - loaded_at` on submit.
 * Primary key is composite so a session loading the same puzzle twice is
 * a no-op — the earliest load wins.
 */
export const puzzleLoads = pgTable(
  'puzzle_loads',
  {
    sessionId: varchar('session_id', { length: 64 }).notNull(),
    puzzleId: integer('puzzle_id').references(() => puzzles.id).notNull(),
    loadedAt: timestamp('loaded_at').defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sessionId, t.puzzleId] }),
  }),
);
