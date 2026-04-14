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
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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
 * Player profile — the identity carrier for the leaderboard. A profile
 * may be keyed on a `wallet`, a `handle`, or (eventually) both:
 *
 *   - Crypto premium path (M4f): the unlock tx binds the wallet, and
 *     the profile is created with `wallet` set, `handle` null,
 *     `premium_source='crypto'`. The wallet address is the identity.
 *
 *   - Fiat premium path (M4f): Apple Pay / card checkout collects a
 *     required unique handle up front. A profile is created with
 *     `handle` set, `wallet` null, `premium_source='fiat'`. The
 *     handle is the identity until the player later connects a
 *     wallet — at which point the two rows merge.
 *
 * Leaderboard rendering reads the profile by wallet and prefers
 * `handle` when set, falling back to a truncated wallet. This means
 * wallet-only players don't need to pick a handle, and fiat-only
 * players aren't locked out of the leaderboard for lacking a wallet.
 *
 * Constraint: at least one of `wallet` or `handle` must be non-null.
 * Enforced via a CHECK so an empty profile row can never exist.
 *
 * Handle uniqueness is case-insensitive — `Alice` and `alice` would
 * collide. Enforced with a `uniqueIndex` on `lower(handle)`.
 *
 * Wallet canonicalization: Ethereum addresses are case-insensitive
 * (EIP-55 mixed-case is a display checksum, not identity), so
 * storing `0xABC…` and `0xabc…` as separate rows would split a
 * single player's identity. The application lowercases on write,
 * but we also enforce it at the DB level with a CHECK so any
 * future write path — direct SQL, bulk import, manual fix — can't
 * bypass the invariant. Reads then compare against the canonical
 * lowercase form with no extra normalization needed at query time.
 */
export const profiles = pgTable(
  'profiles',
  {
    id: serial('id').primaryKey(),
    wallet: varchar('wallet', { length: 42 }),
    handle: varchar('handle', { length: 32 }),
    // 'crypto' | 'fiat' | 'admin_grant' | null
    premiumSource: varchar('premium_source', { length: 16 }),
    // For admin_grant rows, the admin wallet that performed the grant
    // and the operator's optional free-form note. Null on all other
    // rows. Paid unlocks (crypto / fiat) carry their audit in the
    // `premium_users` table instead, so there's no duplication.
    grantedBy: varchar('granted_by', { length: 42 }),
    reason: varchar('reason', { length: 200 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    walletIdx: uniqueIndex('profiles_wallet_idx')
      .on(t.wallet)
      .where(sql`${t.wallet} is not null`),
    handleLowerIdx: uniqueIndex('profiles_handle_lower_idx')
      .on(sql`lower(${t.handle})`)
      .where(sql`${t.handle} is not null`),
    walletOrHandleRequired: check(
      'profiles_wallet_or_handle_required',
      sql`${t.wallet} is not null or ${t.handle} is not null`,
    ),
    walletLowercase: check(
      'profiles_wallet_lowercase',
      sql`${t.wallet} is null or ${t.wallet} = lower(${t.wallet})`,
    ),
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
