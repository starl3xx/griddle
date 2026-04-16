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
// Note: `index` is now used for magic_links
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

/**
 * Premium unlock ledger, keyed on the wallet address that paid (or
 * was granted). `source` distinguishes:
 *   - 'crypto'      — EIP-2612 permit+burn via GriddlePremium.unlockWithPermit
 *   - 'fiat'        — Apple Pay / card via Stripe → swap → escrow-then-burn
 *   - 'admin_grant' — comped manually by an operator from /admin (no burn, no tx)
 *
 * `txHash` is nullable because admin grants have no onchain footprint
 * and the fiat path's burn happens asynchronously after the dispute
 * window, so the hash isn't known at unlock time. `grantedBy` + `reason`
 * carry the audit trail for admin grants; they're null for paid unlocks.
 */
export const premiumUsers = pgTable(
  'premium_users',
  {
    wallet: varchar('wallet', { length: 42 }).primaryKey(),
    unlockedAt: timestamp('unlocked_at').defaultNow().notNull(),
    txHash: varchar('tx_hash', { length: 66 }),
    source: varchar('source', { length: 16 }).default('crypto').notNull(),
    grantedBy: varchar('granted_by', { length: 42 }),
    reason: varchar('reason', { length: 200 }),
    /**
     * Stripe checkout session id for the fiat path. Used as an idempotency
     * key on the webhook — a replayed `checkout.session.completed` event
     * matches the existing row and no-ops instead of double-granting.
     * Null on crypto and admin_grant rows.
     */
    stripeSessionId: varchar('stripe_session_id', { length: 128 }),
  },
  (t) => ({
    stripeSessionIdx: uniqueIndex('premium_users_stripe_session_idx')
      .on(t.stripeSessionId)
      .where(sql`${t.stripeSessionId} is not null`),
  }),
);

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
    /**
     * Stripe checkout session id for handle-only fiat buyers. The
     * wallet-path fiat unlock stores its session id on `premium_users`
     * (keyed on wallet). A buyer with only a handle has no
     * `premium_users` row at all, so without this column there's no
     * DB record of which Stripe session paid for the profile — an
     * audit + idempotency gap on the handle-only path.
     *
     * Nullable because most profile rows don't originate from a
     * Stripe session (crypto unlocks, admin grants, handle-only
     * profiles created through a non-checkout account flow).
     */
    stripeSessionId: varchar('stripe_session_id', { length: 128 }),
    /** Email address — primary identity for email-auth (magic link) profiles. */
    email: varchar('email', { length: 254 }),
    /** Set when the user clicks the magic link. Null until then. */
    emailVerifiedAt: timestamp('email_verified_at'),
    /** Display name chosen by the user. Distinct from handle (slug). */
    displayName: varchar('display_name', { length: 50 }),
    /** URL to the user's avatar image (Farcaster pfp, uploaded, etc.). */
    avatarUrl: varchar('avatar_url', { length: 500 }),
    /**
     * Provenance tag for `avatar_url`. Lets the Farcaster refresh flow
     * auto-update a stale pfp without clobbering a user's uploaded photo.
     *
     * Values:
     *   - `'farcaster'` — came from `upsertProfileForFarcaster`. Safe to
     *     overwrite on future Farcaster sync calls.
     *   - `'custom'`    — user uploaded via POST /api/profile/avatar or
     *     supplied via PATCH /api/profile. DO NOT overwrite on Farcaster
     *     sync.
     *   - `null`        — unknown (pre-migration rows). Treated as
     *     `'farcaster'` for safety on FID-bearing rows that were
     *     backfilled at migration time, else `'custom'`-equivalent
     *     (don't auto-overwrite).
     */
    avatarSource: varchar('avatar_source', { length: 16 }),
    /**
     * Farcaster user id (numeric). Set when the user connects via the
     * Farcaster miniapp connector. Partial unique index so null rows
     * don't conflict (same pattern as wallet / email).
     */
    farcasterFid: integer('farcaster_fid'),
    /** Farcaster @username (without the @). */
    farcasterUsername: varchar('farcaster_username', { length: 50 }),
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
    stripeSessionIdx: uniqueIndex('profiles_stripe_session_idx')
      .on(t.stripeSessionId)
      .where(sql`${t.stripeSessionId} is not null`),
    emailLowerIdx: uniqueIndex('profiles_email_lower_idx')
      .on(sql`lower(${t.email})`)
      .where(sql`${t.email} is not null`),
    farcasterFidIdx: uniqueIndex('profiles_farcaster_fid_idx')
      .on(t.farcasterFid)
      .where(sql`${t.farcasterFid} is not null`),
    // At least one identity anchor required (wallet, email, handle, or FID).
    walletOrHandleOrEmailRequired: check(
      'profiles_identity_required',
      sql`${t.wallet} is not null or ${t.handle} is not null or ${t.email} is not null or ${t.farcasterFid} is not null`,
    ),
    walletLowercase: check(
      'profiles_wallet_lowercase',
      sql`${t.wallet} is null or ${t.wallet} = lower(${t.wallet})`,
    ),
  }),
);

/**
 * Magic link tokens for email-based authentication.
 *
 * Only the SHA-256 hash of the token is stored — never the raw token.
 * On verify: re-hash the query param, look up by hash, check expiry
 * and usedAt, then mark used immediately to prevent replay.
 */
export const magicLinks = pgTable(
  'magic_links',
  {
    id: serial('id').primaryKey(),
    email: varchar('email', { length: 254 }).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    tokenHashIdx: uniqueIndex('magic_links_token_hash_idx').on(t.tokenHash),
    emailIdx: index('magic_links_email_idx').on(t.email),
    expiresAtIdx: index('magic_links_expires_at_idx').on(t.expiresAt),
  }),
);

/**
 * Per-wallet user preferences. Keyed on wallet address (lowercase).
 * Created lazily on first save — users who never change settings have no row.
 *
 * Premium settings (streak_protection_*, unassisted_mode) are only surfaced
 * in the UI for premium users, but the constraint is enforced client-side;
 * the DB stores whatever is sent. Non-premium users who somehow POST a setting
 * just pay to store a preference they can't use yet.
 *
 * dark_mode is stored here for cross-device sync when the user has a wallet;
 * for anonymous users it lives only in localStorage.
 */
export const userSettings = pgTable('user_settings', {
  wallet: varchar('wallet', { length: 42 }).primaryKey(),
  /** Whether streak protection is armed for the next missed day. */
  streakProtectionEnabled: boolean('streak_protection_enabled').default(false).notNull(),
  /**
   * When the user last consumed a streak protection. Used to enforce the
   * 7-day cooldown before the protection becomes available again.
   * Null = never used (protection is available from the start).
   */
  streakProtectionUsedAt: timestamp('streak_protection_used_at'),
  /** Hide green/dim cell hints during play. Earns the Blameless Wordmark instead. */
  unassistedModeEnabled: boolean('unassisted_mode_enabled').default(false).notNull(),
  /** Prefer dark color scheme across all devices where the wallet is connected. */
  darkModeEnabled: boolean('dark_mode_enabled').default(false).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

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

/**
 * Funnel events — one row per instrumented step in the
 * anon → account → premium conversion funnel. Schema is intentionally
 * wide-and-dumb: `event_name` is a free-form varchar (not an enum) so
 * adding/renaming events never requires a migration, and `metadata`
 * jsonb carries any per-event variant fields.
 *
 * Identity is resolved server-side at insert time from the existing KV
 * helpers, so the client never needs to know its own identity state to
 * emit an event. `session_id` is always set; `wallet` and `profile_id`
 * are populated when known.
 *
 * `idempotency_key` lets server-side emitters (Stripe webhook, crypto
 * tx confirmation) guard against retries producing double-count events.
 * It's partial-unique so client-side events (which leave it null) can
 * coexist freely.
 */
export const funnelEvents = pgTable(
  'funnel_events',
  {
    id: serial('id').primaryKey(),
    eventName: varchar('event_name', { length: 64 }).notNull(),
    sessionId: varchar('session_id', { length: 64 }).notNull(),
    wallet: varchar('wallet', { length: 42 }),
    profileId: integer('profile_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 128 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    createdAtIdx: index('funnel_events_created_at_idx').on(sql`${t.createdAt} DESC`),
    eventNameIdx: index('funnel_events_name_created_at_idx').on(t.eventName, sql`${t.createdAt} DESC`),
    sessionIdx: index('funnel_events_session_idx').on(t.sessionId),
    idempotencyIdx: uniqueIndex('funnel_events_idempotency_idx')
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
  }),
);
