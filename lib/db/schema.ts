/**
 * Drizzle schema. No migrations run in M1 — this file is a contract that
 * lib/db/queries.ts (M4) will consume when the DB is wired up.
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
} from 'drizzle-orm/pg-core';

export const puzzles = pgTable('puzzles', {
  id: serial('id').primaryKey(),
  dayNumber: integer('day_number').notNull().unique(),
  date: date('date').notNull().unique(),
  word: varchar('word', { length: 9 }).notNull(),
  grid: char('grid', { length: 9 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const solves = pgTable('solves', {
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
});

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
