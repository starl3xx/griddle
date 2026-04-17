import { and, asc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from './client';
import {
  puzzles,
  puzzleLoads,
  solves,
  streaks,
  premiumUsers,
  profiles,
  userSettings,
  magicLinks,
  funnelEvents,
  wordmarks,
  puzzleCrumbs,
} from './schema';
import { getCurrentDayNumber } from '@/lib/scheduler';
import { secondsUntilUtcMidnight, formatUsdc6 } from '@/lib/format';
import { kv } from '@/lib/kv';
import { slugifyUsername, validateUsername } from '@/lib/username';
import { getLeaderboardWordmarks } from '@/lib/wordmarks/leaderboard';

/**
 * Server-side puzzle/solve queries shared between the server component
 * (`app/page.tsx`) and the API route (`app/api/puzzle/today/route.ts`).
 *
 * Read-through cache layer in front of Neon: every per-day puzzle row
 * is the same for every user, so we cache it in Upstash with a TTL that
 * rolls over at the next UTC midnight (when the daily puzzle changes).
 *
 * **Cache key separation is a security boundary, not just an optimization.**
 * The public payload (no word) and the answer word live under DIFFERENT
 * cache keys so a future contributor literally cannot accidentally serve
 * the answer to a public surface  -  `getTodayPuzzle()` only ever reads
 * from the public key. Same type-level guarantee that the original
 * non-cached version had.
 */

/** Public puzzle payload  -  sent to the client. NEVER includes the word. */
export interface TodayPuzzlePayload {
  /** Internal DB id (not sent to client). */
  id: number;
  /** Day number (1-indexed, matches scheduler.getCurrentDayNumber). */
  dayNumber: number;
  /** ISO date (YYYY-MM-DD) this puzzle is scheduled for. */
  date: string;
  /** 9-letter grid string, to be shown to the player. */
  grid: string;
}

/** Server-only payload  -  used by /api/solve to verify the claim. */
interface PuzzleAnswer {
  id: number;
  word: string;
}

const PUBLIC_KEY = (dayNumber: number) => `griddle:puzzle:public:${dayNumber}`;
const ANSWER_KEY = (dayNumber: number) => `griddle:puzzle:answer:${dayNumber}`;

/**
 * Cache-safe wrappers around Upstash. Every kv.get / kv.set call goes
 * through these so a transient Upstash failure (network blip, rate
 * limit, brief outage) never breaks the request  -  we just log and fall
 * through to the DB. The cache is a performance optimization, NOT an
 * availability dependency. The non-cached version of these queries
 * worked fine; the cached version must never be *less* resilient.
 */
async function safeKvGet<T>(key: string): Promise<T | null> {
  try {
    return await kv.get<T>(key);
  } catch (err) {
    console.warn(`[kv] get failed for ${key}:`, err);
    return null;
  }
}

async function safeKvSet<T>(key: string, value: T, ttl: number): Promise<void> {
  try {
    await kv.set(key, value, { ex: ttl });
  } catch (err) {
    console.warn(`[kv] set failed for ${key}:`, err);
  }
}

/**
 * Read today's puzzle row. Returns null if no puzzle is seeded for the
 * current day. Reads from Upstash first; on miss (or kv error), queries
 * Neon and populates BOTH the public and answer caches in a single
 * roundtrip so the next /api/solve hit also gets a cache hit.
 */
export async function getTodayPuzzle(): Promise<TodayPuzzlePayload | null> {
  return getPuzzleByDay(getCurrentDayNumber());
}

/**
 * Fetch a puzzle by day number (any day, not just today). Used by the
 * archive puzzle loader. Returns the public payload — never the word.
 */
export async function getPuzzleByDay(dayNumber: number): Promise<TodayPuzzlePayload | null> {
  const cached = await safeKvGet<TodayPuzzlePayload>(PUBLIC_KEY(dayNumber));
  if (cached) return cached;

  const row = await refreshCacheForDay(dayNumber);
  return row ? toPublicPayload(row) : null;
}

/**
 * Fetch the puzzle answer word by dayNumber. Only used from solve
 * verification  -  never call this from any code path that touches the
 * client response.
 */
export async function getPuzzleWordByDayNumber(
  dayNumber: number,
): Promise<PuzzleAnswer | null> {
  const cached = await safeKvGet<PuzzleAnswer>(ANSWER_KEY(dayNumber));
  if (cached) return cached;

  const row = await refreshCacheForDay(dayNumber);
  return row ? { id: row.id, word: row.word } : null;
}

/**
 * Cold-cache path: query Neon once for the full row and populate both
 * cache keys in parallel. Called from `getTodayPuzzle` and
 * `getPuzzleWordByDayNumber` on a miss  -  whichever fires first warms
 * the cache for the other.
 *
 * TTL is `secondsUntilUtcMidnight()` so the cached row expires exactly
 * when the daily puzzle rolls over. Avoids serving yesterday's puzzle
 * after midnight.
 */
async function refreshCacheForDay(dayNumber: number): Promise<{
  id: number;
  dayNumber: number;
  date: string;
  grid: string;
  word: string;
} | null> {
  const rows = await db
    .select({
      id: puzzles.id,
      dayNumber: puzzles.dayNumber,
      date: puzzles.date,
      grid: puzzles.grid,
      word: puzzles.word,
    })
    .from(puzzles)
    .where(eq(puzzles.dayNumber, dayNumber))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];

  // TTL must be ≥ 1  -  Upstash rejects 0. If we're within the same
  // second as midnight, fall back to a 60-second TTL.
  const ttl = Math.max(60, secondsUntilUtcMidnight());

  // Two cache keys, populated in parallel via safeKvSet so a transient
  // Upstash failure can never block returning the freshly-fetched row.
  // Public key intentionally omits the word  -  type-level word stripping
  // carried over from the non-cached version.
  await Promise.all([
    safeKvSet(PUBLIC_KEY(dayNumber), toPublicPayload(row), ttl),
    safeKvSet(ANSWER_KEY(dayNumber), { id: row.id, word: row.word }, ttl),
  ]);

  return row;
}

function toPublicPayload(row: {
  id: number;
  dayNumber: number;
  date: string;
  grid: string;
}): TodayPuzzlePayload {
  return {
    id: row.id,
    dayNumber: row.dayNumber,
    date: row.date,
    grid: row.grid,
  };
}

/**
 * Record that `sessionId` first saw `puzzleId` at now(). Idempotent via
 * `ON CONFLICT DO NOTHING`  -  later loads of the same puzzle by the same
 * session keep the earliest `loaded_at`, which is the correct start
 * time for `server_solve_ms`.
 *
 * NOT cached: this is a write-only path and each row is per-session,
 * so there's no shared row to cache.
 */
export async function recordPuzzleLoad(sessionId: string, puzzleId: number): Promise<void> {
  await db
    .insert(puzzleLoads)
    .values({ sessionId, puzzleId })
    .onConflictDoNothing({ target: [puzzleLoads.sessionId, puzzleLoads.puzzleId] });
}

/**
 * Daily leaderboard row  -  one wallet, their fastest legitimate solve.
 */
export interface LeaderboardEntry {
  rank: number;
  /**
   * Synthetic player key — `p:<profile_id>` when the solve carries a
   * profile_id, otherwise the lowercased wallet. Used as the React
   * list key and as the stable identity across a user's solve history.
   */
  playerKey: string;
  /** Display handle (username) when the owning profile has one. */
  handle: string | null;
  /** Lowercased wallet address when known. Used as display fallback. */
  wallet: string | null;
  /** Profile avatar URL when set. */
  avatarUrl: string | null;
  serverSolveMs: number;
  unassisted: boolean;
  /**
   * Top wordmarks (ids) to render as overlapping circular badges next
   * to the player's name. At most 3, filtered through
   * `getLeaderboardWordmarks` so speed/streak groups don't dominate
   * the row. Empty array when the player has earned none (or is
   * anonymous / has no wordmarks rows yet).
   */
  topWordmarks: string[];
}

/**
 * Top N solvers for a given day. Filters:
 *   - solved = true (no failed attempts)
 *   - flag is NULL or 'suspicious' (only 'ineligible' is excluded)
 *   - (wallet IS NOT NULL OR profile_id IS NOT NULL) — anonymous
 *     session-only solves are still excluded, but handle-only and
 *     email-auth users (who may never bind a wallet) now qualify so
 *     they can appear on the board under their handle.
 *   - same-day only: solve created_at matches the puzzle date
 *     (archive solves don't qualify for leaderboard placement).
 *
 * Each player appears once with their fastest serverSolveMs. Grouping
 * uses the same synthetic player_key as getPremiumStats — profile_id
 * preferred, wallet fallback — so a user whose pre-wallet and post-
 * wallet solves collapse to a single board entry. A LEFT JOIN back to
 * profiles carries the handle / avatarUrl / canonical wallet to the
 * client.
 */
export async function getDailyLeaderboard(
  dayNumber: number,
  limit = 100,
): Promise<LeaderboardEntry[]> {
  const puzzleRows = await db
    .select({ id: puzzles.id, date: puzzles.date })
    .from(puzzles)
    .where(eq(puzzles.dayNumber, dayNumber))
    .limit(1);
  if (puzzleRows.length === 0) return [];
  const puzzleId = puzzleRows[0].id;
  const puzzleDate = puzzleRows[0].date;

  const rows = await db.execute<{
    player_key: string;
    profile_id: number | null;
    row_wallet: string | null;
    server_solve_ms: number;
    unassisted: boolean;
    handle: string | null;
    profile_wallet: string | null;
    avatar_url: string | null;
  }>(sql`
    WITH eligible AS (
      SELECT
        COALESCE('p:' || solves.profile_id::text, solves.wallet) AS player_key,
        solves.profile_id,
        solves.wallet AS row_wallet,
        solves.server_solve_ms,
        solves.unassisted,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE('p:' || solves.profile_id::text, solves.wallet)
          ORDER BY solves.server_solve_ms ASC
        ) AS rn
      FROM solves
      WHERE solves.puzzle_id = ${puzzleId}
        AND solves.solved = true
        AND (solves.flag IS NULL OR solves.flag = 'suspicious')
        AND (solves.wallet IS NOT NULL OR solves.profile_id IS NOT NULL)
        AND solves.server_solve_ms IS NOT NULL
        AND solves.created_at::date = ${puzzleDate}::date
    )
    SELECT
      e.player_key,
      e.profile_id,
      e.row_wallet,
      e.server_solve_ms,
      e.unassisted,
      p.handle,
      p.wallet AS profile_wallet,
      p.avatar_url
    FROM eligible e
    LEFT JOIN profiles p ON p.id = e.profile_id
    WHERE e.rn = 1
    ORDER BY e.server_solve_ms ASC
    LIMIT ${limit}
  `);

  const resolved = Array.isArray(rows) ? rows : (rows.rows ?? []);
  if (resolved.length === 0) return [];

  // Batch-fetch every wordmark row for the current leaderboard's
  // player_keys, then group them into a lookup. Single round-trip for
  // up to `limit` players, beats N+1 per-row fetches. The generated
  // `wordmarks.player_key` column matches the leaderboard's computed
  // player_key exactly so we can filter on it directly without any
  // profile-id ↔ wallet translation.
  const playerKeys = resolved.map((r) => String(r.player_key));
  const wordmarkRows = await db.execute<{
    player_key: string;
    wordmark_id: string;
  }>(sql`
    SELECT player_key, wordmark_id
    FROM wordmarks
    WHERE player_key = ANY(${playerKeys}::varchar[])
  `);
  const wordmarksByPlayer = new Map<string, string[]>();
  const wordmarkResolved = Array.isArray(wordmarkRows) ? wordmarkRows : (wordmarkRows.rows ?? []);
  for (const row of wordmarkResolved) {
    const key = String(row.player_key);
    const arr = wordmarksByPlayer.get(key) ?? [];
    arr.push(String(row.wordmark_id));
    wordmarksByPlayer.set(key, arr);
  }

  return resolved.map((r, i) => {
    const playerKey = String(r.player_key);
    const allWordmarks = wordmarksByPlayer.get(playerKey) ?? [];
    return {
      rank: i + 1,
      playerKey,
      handle: r.handle ?? null,
      // Prefer the canonical profile.wallet when set — it's the
      // lowercased / normalized version; fall back to the solve row's
      // wallet (handles pre-backfill rows where the profile join missed).
      wallet: (r.profile_wallet ?? r.row_wallet)?.toLowerCase() ?? null,
      avatarUrl: r.avatar_url ?? null,
      serverSolveMs: Number(r.server_solve_ms),
      unassisted: Boolean(r.unassisted),
      topWordmarks: getLeaderboardWordmarks(allWordmarks),
    };
  });
}

/**
 * Recent flagged solves for the admin anomaly dashboard. Returns the
 * latest N rows where flag IS NOT NULL, ordered by created_at DESC.
 * The flag is set by /api/solve based on the env-tunable thresholds
 * (ineligible / suspicious). Admin can review these to spot bots.
 */
export interface AnomalyRow {
  id: number;
  puzzleId: number;
  wallet: string | null;
  sessionId: string;
  serverSolveMs: number | null;
  clientSolveMs: number | null;
  keystrokeStddevMs: number | null;
  keystrokeMinMs: number | null;
  keystrokeCount: number | null;
  flag: 'ineligible' | 'suspicious';
  createdAt: Date;
  /** Profile handle joined via wallet — null when anonymous or no profile. */
  handle: string | null;
  /** Profile avatar URL joined via wallet. */
  avatarUrl: string | null;
}

export async function getRecentAnomalies(limit = 200): Promise<AnomalyRow[]> {
  const rows = await db
    .select({
      id: solves.id,
      puzzleId: solves.puzzleId,
      wallet: solves.wallet,
      sessionId: solves.sessionId,
      serverSolveMs: solves.serverSolveMs,
      clientSolveMs: solves.clientSolveMs,
      keystrokeStddevMs: solves.keystrokeStddevMs,
      keystrokeMinMs: solves.keystrokeMinMs,
      keystrokeCount: solves.keystrokeCount,
      flag: solves.flag,
      createdAt: solves.createdAt,
      handle: profiles.handle,
      avatarUrl: profiles.avatarUrl,
    })
    .from(solves)
    .leftJoin(profiles, eq(solves.wallet, profiles.wallet))
    .where(isNotNull(solves.flag))
    .orderBy(sql`${solves.createdAt} DESC`)
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    flag: r.flag as 'ineligible' | 'suspicious',
  }));
}

/**
 * Admin moderation: update or clear the flag on a solve.
 * Passing null clears the flag (marks the solve as legitimate).
 */
export async function updateSolveFlag(
  solveId: number,
  flag: 'ineligible' | 'suspicious' | null,
): Promise<void> {
  await db
    .update(solves)
    .set({ flag })
    .where(eq(solves.id, solveId));
}

/**
 * Aggregate stats for the Stats modal. All derived from `solves` +
 * `streaks`, filtered to eligible rows (solved=true, no
 * ineligible/suspicious flag). A player with zero qualifying rows
 * returns zero-valued fields rather than null so the UI can render
 * without branching on undefined.
 */
export interface WalletStats {
  totalSolves: number;
  unassistedSolves: number;
  fastestMs: number | null;
  averageMs: number | null;
  currentStreak: number;
  longestStreak: number;
}

/**
 * Canonical identity used by stats queries. A single player can be
 * identified by any combination of these — the match logic is OR, so
 * a solve row attributed by any of them contributes to the caller's
 * stats:
 *
 *   - `profileId` — canonical identity going forward. Written at
 *     insert time by `/api/solve` from the session→profile KV binding.
 *   - `wallet`    — preserved for crypto/fiat-wallet users whose
 *     solves have always carried a wallet. Also lights up the streaks
 *     table (which is wallet-keyed; handle-only users get zeroes).
 *   - `sessionId` — fallback for rows that have neither profile_id
 *     nor wallet. Catches a handle-only user's pre-backfill solves
 *     (and pre-migration rows in general) so their stats aren't
 *     blank while waiting for a fresh solve to write profile_id.
 *
 * Pass whichever subset the caller knows; missing fields are ignored.
 */
export interface StatsIdentity {
  profileId?: number | null;
  wallet?: string | null;
  sessionId?: string | null;
}

/**
 * Synthetic `player_key` for an identity. Profile wins; wallet is the
 * fallback; session-only has no key (anonymous). Matches the generated
 * column on wordmarks + streaks so app code can hit the unique indexes
 * on those tables directly.
 */
export function playerKeyFor(identity: {
  profileId?: number | null;
  wallet?: string | null;
}): string | null {
  if (identity.profileId != null) return `p:${identity.profileId}`;
  if (identity.wallet) return identity.wallet.toLowerCase();
  return null;
}

/**
 * SQL fragment matching a solve row to the caller's identity. See
 * StatsIdentity docs for the resolution order; this is the shared
 * predicate used by getWalletStats, getPremiumStats, and any future
 * profile-keyed query that needs the same matching semantics.
 */
export function solveBelongsTo(identity: StatsIdentity) {
  const clauses = [] as ReturnType<typeof sql>[];
  if (identity.profileId != null) {
    clauses.push(sql`${solves.profileId} = ${identity.profileId}`);
  }
  if (identity.wallet) {
    clauses.push(sql`${solves.wallet} = ${identity.wallet.toLowerCase()}`);
  }
  if (identity.sessionId) {
    clauses.push(
      sql`(${solves.sessionId} = ${identity.sessionId} AND ${solves.profileId} IS NULL AND ${solves.wallet} IS NULL)`,
    );
  }
  if (clauses.length === 0) return sql`false`;
  return sql`(${sql.join(clauses, sql` OR `)})`;
}

export async function getWalletStats(identity: StatsIdentity): Promise<WalletStats> {
  const normalizedWallet = identity.wallet?.toLowerCase() ?? null;

  const [agg] = await db
    .select({
      totalSolves: sql<number>`count(*)::int`,
      unassistedSolves: sql<number>`count(*) filter (where ${solves.unassisted} = true)::int`,
      fastestMs: sql<number | null>`min(${solves.serverSolveMs})::int`,
      averageMs: sql<number | null>`avg(${solves.serverSolveMs})::int`,
    })
    .from(solves)
    .where(
      and(
        solveBelongsTo(identity),
        eq(solves.solved, true),
        // Match leaderboard policy: only 'ineligible' is excluded.
        sql`(${solves.flag} IS NULL OR ${solves.flag} = 'suspicious')`,
        isNotNull(solves.serverSolveMs),
      ),
    );

  // Streaks key on the player_key (profile_id preferred, wallet
  // fallback) so handle-only users see their streak here too.
  let currentStreak = 0;
  let longestStreak = 0;
  const playerKey = playerKeyFor(identity);
  if (playerKey) {
    const streakRow = await selectStreakRow(playerKey);
    currentStreak = streakRow?.currentStreak ?? 0;
    longestStreak = streakRow?.longestStreak ?? 0;
  }

  return {
    totalSolves: agg?.totalSolves ?? 0,
    unassistedSolves: agg?.unassistedSolves ?? 0,
    fastestMs: agg?.fastestMs ?? null,
    averageMs: agg?.averageMs ?? null,
    currentStreak,
    longestStreak,
  };
}

/**
 * Admin Pulse aggregate  -  one-shot snapshot feeding the Pulse tab on
 * the admin dashboard. Five headline numbers, each with enough context
 * for a one-glance health read. Kept cheap: every query is indexed on
 * `created_at` or `puzzle_id` + `wallet`, and the 24h/7d windows are
 * small constant-bound scans on recent rows.
 *
 * NOT cached  -  the admin page is low-traffic by definition, staleness
 * hurts more than latency.
 */
export interface AdminPulse {
  /** Successful solves in the last 24h (no flag filter  -  includes flagged). */
  solves24h: number;
  /** Successful solves in the last 7d. */
  solves7d: number;
  /** Distinct wallets with any solve in the last 7d. */
  activeWallets7d: number;
  /** Flagged solves in the last 24h (ineligible + suspicious). */
  flaggedSolves24h: number;
  /** Percentage of last-24h solves that were flagged, 0-100. */
  flaggedRatePct: number;
  /** Premium wallets all-time. */
  premiumUsersTotal: number;
}

export async function getAdminPulse(): Promise<AdminPulse> {
  // Bound the scan to the widest window this query needs (7 days).
  // `FILTER` clauses narrow what gets counted but don't bound the scan,
  // so without this WHERE every call would sequentially scan the full
  // `solves` table. As the table grows an index on `created_at` would
  // let PG range-scan this even tighter; that migration is a follow-up.
  const windowStart = sql<Date>`now() - interval '7 days'`;

  const [row] = await db
    .select({
      // Successful solves in the last 24h  -  includes flagged rows. This
      // is the denominator for `flaggedRatePct`, so the numerator below
      // MUST also filter on `solved = true` or the ratio skews.
      solves24h: sql<number>`count(*) filter (where ${solves.createdAt} >= now() - interval '1 day' and ${solves.solved} = true)::int`,
      solves7d: sql<number>`count(*) filter (where ${solves.solved} = true)::int`,
      activeWallets7d: sql<number>`count(distinct ${solves.wallet}) filter (where ${solves.wallet} is not null)::int`,
      // Intersection: flagged AND solved=true  -  matches the denominator.
      flaggedSolves24h: sql<number>`count(*) filter (where ${solves.createdAt} >= now() - interval '1 day' and ${solves.solved} = true and ${solves.flag} is not null)::int`,
    })
    .from(solves)
    .where(gte(solves.createdAt, windowStart));

  const [premiumRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(premiumUsers);

  const solves24h = row?.solves24h ?? 0;
  const flagged = row?.flaggedSolves24h ?? 0;
  // Avoid NaN on a zero-solve day.
  const flaggedRatePct =
    solves24h === 0 ? 0 : Math.round((flagged / solves24h) * 1000) / 10;

  return {
    solves24h,
    solves7d: row?.solves7d ?? 0,
    activeWallets7d: row?.activeWallets7d ?? 0,
    flaggedSolves24h: flagged,
    flaggedRatePct,
    premiumUsersTotal: premiumRow?.total ?? 0,
  };
}

/**
 * Archive listing  -  past puzzle days (excluding today), newest first.
 * Used by the /archive page. Caller is responsible for premium gating.
 */
export interface ArchiveEntry {
  dayNumber: number;
  date: string;
}

export async function getArchiveList(limit = 60): Promise<ArchiveEntry[]> {
  const today = getCurrentDayNumber();
  const rows = await db
    .select({ dayNumber: puzzles.dayNumber, date: puzzles.date })
    .from(puzzles)
    .where(sql`${puzzles.dayNumber} < ${today}`)
    .orderBy(sql`${puzzles.dayNumber} DESC`)
    .limit(limit);
  return rows.map((r) => ({ dayNumber: r.dayNumber, date: r.date }));
}

/**
 * Day numbers the given identity has solved (eligible only). Used by
 * the archive calendar to mark "solved" cells. Resolution order
 * matches the other identity-keyed reads — profile → wallet → session.
 *
 * Excludes `ineligible` flags; `suspicious` still counts (same rule as
 * the leaderboard) so a borderline flag doesn't silently hide a solve
 * from the solver's own archive view.
 *
 * Returns an empty array for fully-anonymous callers (no identity
 * fields) so callers never have to branch on null before rendering.
 */
export async function getMySolvedDayNumbers(identity: StatsIdentity): Promise<number[]> {
  if (identity.profileId == null && !identity.wallet && !identity.sessionId) {
    return [];
  }
  const rows = await db
    .select({ dayNumber: puzzles.dayNumber })
    .from(solves)
    .innerJoin(puzzles, eq(solves.puzzleId, puzzles.id))
    .where(
      and(
        eq(solves.solved, true),
        solveBelongsTo(identity),
        sql`(${solves.flag} IS NULL OR ${solves.flag} = 'suspicious')`,
      ),
    )
    .groupBy(puzzles.dayNumber);
  return rows.map((r) => r.dayNumber);
}

/**
 * Player profile queries  -  scaffolding for the inclusive leaderboard in
 * M5-premium-checkout. A profile is identified by a wallet, a handle, or both; the UI
 * renders `handle` when set and falls back to a truncated wallet.
 *
 * These helpers are safe to call before M5-premium-checkout's UI ships  -  nothing in the
 * game currently reads from `profiles`, so an empty table is a no-op
 * for existing flows. The leaderboard render path will start consuming
 * these once the profile-collection UI lands.
 */
export interface ProfileRow {
  id: number;
  wallet: string | null;
  handle: string | null;
  premiumSource: 'crypto' | 'fiat' | 'admin_grant' | null;
  /** Admin wallet that granted premium (only set for `premiumSource='admin_grant'`). */
  grantedBy: string | null;
  /** Optional operator note (only set for `premiumSource='admin_grant'`). */
  reason: string | null;
  /**
   * Stripe checkout session id for handle-only fiat unlocks. Null for
   * every other origin (crypto unlocks, admin grants, wallet-path fiat
   * unlocks, which record their session id on `premium_users` instead).
   */
  stripeSessionId: string | null;
  /** Email address  -  primary identity for magic link auth profiles. */
  email: string | null;
  /** Set when the user clicks the magic link. Null until verified. */
  emailVerifiedAt: Date | null;
  /** URL to the user's avatar image. */
  avatarUrl: string | null;
  /**
   * Provenance of `avatarUrl`. `'farcaster'` = came from Farcaster
   * sync (safe to auto-refresh); `'custom'` = user-uploaded or
   * user-supplied (do NOT overwrite); `null` = unknown.
   */
  avatarSource: 'farcaster' | 'custom' | null;
  /** Farcaster user id. Set when connected via Farcaster miniapp. */
  farcasterFid: number | null;
  /** Farcaster @username. */
  farcasterUsername: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Map a `profiles` table row (as returned by drizzle's `select()`) to
 * the public `ProfileRow` shape. Collapses ten near-identical hand-
 * written blocks across the query helpers into one place — adding a
 * new identity column now means updating this function, not hunting
 * for every return site.
 */
type RawProfileRow = typeof profiles.$inferSelect;
function toProfileRow(r: RawProfileRow): ProfileRow {
  return {
    id: r.id,
    wallet: r.wallet,
    handle: r.handle,
    premiumSource: r.premiumSource as ProfileRow['premiumSource'],
    grantedBy: r.grantedBy,
    reason: r.reason,
    stripeSessionId: r.stripeSessionId,
    email: r.email ?? null,
    emailVerifiedAt: r.emailVerifiedAt ?? null,
    avatarUrl: r.avatarUrl ?? null,
    avatarSource: (r.avatarSource ?? null) as ProfileRow['avatarSource'],
    farcasterFid: r.farcasterFid ?? null,
    farcasterUsername: r.farcasterUsername ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Internal — raw SQL SELECT of a full profiles row by (lowercased)
 * wallet, returning the drizzle-shaped row (same keys as
 * `profiles.$inferSelect`) so every caller that previously consumed
 * the drizzle `select()` output works unchanged.
 *
 * Uses raw SQL per the "Drizzle wallet-eq drift" note in README
 * Code Style — centralizing here so getProfileByWallet and the two
 * byWallet lookups inside `upsertProfileForFarcaster` share one
 * drift-proof implementation instead of duplicating the aliased
 * SELECT three times.
 */
async function selectRawProfileByWallet(
  normalizedWallet: string,
): Promise<typeof profiles.$inferSelect | null> {
  const result = await db.execute<{
    id: number;
    wallet: string | null;
    handle: string | null;
    premiumSource: string | null;
    grantedBy: string | null;
    reason: string | null;
    stripeSessionId: string | null;
    email: string | null;
    emailVerifiedAt: Date | string | null;
    avatarUrl: string | null;
    avatarSource: string | null;
    farcasterFid: number | null;
    farcasterUsername: string | null;
    createdAt: Date | string;
    updatedAt: Date | string;
  }>(sql`
    SELECT
      id,
      wallet,
      handle,
      premium_source     AS "premiumSource",
      granted_by         AS "grantedBy",
      reason,
      stripe_session_id  AS "stripeSessionId",
      email,
      email_verified_at  AS "emailVerifiedAt",
      avatar_url         AS "avatarUrl",
      avatar_source      AS "avatarSource",
      farcaster_fid      AS "farcasterFid",
      farcaster_username AS "farcasterUsername",
      created_at         AS "createdAt",
      updated_at         AS "updatedAt"
    FROM profiles
    WHERE wallet = ${normalizedWallet}
    LIMIT 1
  `);
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  if (rows.length === 0) return null;
  const r = rows[0];
  // Coerce timestamps — neon-http may return ISO strings depending on
  // driver version. Wrap in Date so the shape matches what the drizzle
  // builder would have returned and callers can call `.toISOString()`
  // or compare with Date math without special-casing.
  return {
    ...r,
    emailVerifiedAt: r.emailVerifiedAt == null
      ? null
      : r.emailVerifiedAt instanceof Date ? r.emailVerifiedAt : new Date(r.emailVerifiedAt),
    createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt : new Date(r.updatedAt),
  } as typeof profiles.$inferSelect;
}

/**
 * Lookup by wallet address. Normalized to lowercase before the query so
 * mixed-case input (e.g. the checksummed form from wagmi) hits the same
 * row as the lowercased form stored on write.
 */
export async function getProfileByWallet(wallet: string): Promise<ProfileRow | null> {
  const raw = await selectRawProfileByWallet(wallet.toLowerCase());
  return raw == null ? null : toProfileRow(raw);
}

/**
 * Lookup by handle, case-insensitive. Uses `lower(handle)` to hit the
 * `profiles_handle_lower_idx` unique index rather than scanning.
 */
export async function getProfileByHandle(handle: string): Promise<ProfileRow | null> {
  const rows = await db
    .select()
    .from(profiles)
    .where(sql`lower(${profiles.handle}) = lower(${handle})`)
    .limit(1);
  return rows.length === 0 ? null : toProfileRow(rows[0]);
}

/**
 * Upsert a profile. Used by both premium unlock paths:
 *
 *   - **Crypto**: `upsertProfile({ wallet, premiumSource: 'crypto' })`  - 
 *     creates or updates the wallet-keyed profile on unlock.
 *   - **Fiat**: `upsertProfile({ handle, premiumSource: 'fiat' })`  - 
 *     creates the handle-keyed profile during Stripe checkout, before
 *     the player has connected a wallet.
 *
 * If both `wallet` and `handle` are provided, attempts to match an
 * existing row on wallet first (updating handle in place) so that a
 * previously handle-only profile can pick up a wallet on first connect
 * without creating a duplicate row. Callers performing that "merge"
 * path should look up by handle first via `getProfileByHandle`, then
 * call `upsertProfile` with both.
 *
 * Constraint enforcement (wallet OR handle required) lives in the DB
 * `profiles_wallet_or_handle_required` CHECK. Passing both as null will
 * throw; callers should never do this.
 */
/**
 * `wallet` and `handle` accept `null` so callers can pass through
 * normalized input that may have been emptied out  -  `normalizeIdentity`
 * treats `null`, `undefined`, and empty-string the same.
 *
 * The other three fields are `T | undefined` only (not `| null`): the
 * implementation below collapses undefined into "keep existing", and
 * there's no current need for a caller to explicitly clear a
 * `premiumSource` / `grantedBy` / `reason`. Admin grant audit fields
 * in particular are append-only  -  once recorded, they're part of the
 * audit trail forever. If a future caller ever needs to clear them,
 * the type contract will flag it and we can add the distinction then.
 */
export interface UpsertProfileInput {
  wallet?: string | null;
  handle?: string | null;
  premiumSource?: 'crypto' | 'fiat' | 'admin_grant';
  /** Admin wallet, only for `premiumSource='admin_grant'`. Audit trail. */
  grantedBy?: string;
  /** Operator note, only for `premiumSource='admin_grant'`. */
  reason?: string;
  /**
   * Stripe checkout session id  -  three states:
   *   - `undefined` (omitted)  -  keep existing value on update
   *   - `null`                 -  explicitly clear (crypto re-unlock wipes stale fiat id)
   *   - `string`               -  set to new value (fiat unlock)
   * (where the unlock doesn't produce a `premium_users` row to carry
   * the session id). Persisting it here gives us the same two
   * guarantees the wallet-path fiat unlock already has:
   *   - Audit trail from a DB row back to the exact Stripe session
   *   - Idempotency via the partial unique index on this column,
   *     so a replayed webhook can't double-insert the same session
   */
  stripeSessionId?: string | null;
}

/**
 * Thrown by `upsertProfile` when the wallet and handle passed in
 * already identify two different existing profile rows. See the note
 * on that function for why the merge itself is deferred to M5-premium-checkout.
 */
export class MergeConflictError extends Error {
  constructor(
    public readonly walletProfileId: number,
    public readonly handleProfileId: number,
  ) {
    super(
      `upsertProfile: wallet and handle point at different rows (${walletProfileId}, ${handleProfileId}); merge deferred`,
    );
    this.name = 'MergeConflictError';
  }
}

/**
 * Normalize a possibly-empty / whitespace-only string to null. Used so
 * `upsertProfile({ handle: '' })` is treated the same as omitting
 * `handle` entirely  -  an empty string is never a valid identity, so
 * accepting it would both bypass the "wallet OR handle required" guard
 * AND fail the lookup paths (since `''` is falsy in the `if (handle)`
 * branches below).
 */
function normalizeIdentity(s: string | null | undefined): string | null {
  if (s == null) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function upsertProfile(input: UpsertProfileInput): Promise<ProfileRow> {
  const walletNorm = normalizeIdentity(input.wallet);
  const wallet = walletNorm ? walletNorm.toLowerCase() : null;
  const handle = normalizeIdentity(input.handle);
  const premiumSource = input.premiumSource ?? null;
  const grantedBy = input.grantedBy ? input.grantedBy.toLowerCase() : null;
  const reason = input.reason ?? null;
  // stripeSessionId distinguishes three states:
  //   undefined (omitted) → keep the existing value on update
  //   null                → explicitly clear (crypto re-unlock wipes a stale fiat session id)
  //   string              → set to new value (fiat unlock)
  // We preserve the raw undefined vs null distinction throughout.
  const stripeSessionId = input.stripeSessionId;

  if (wallet === null && handle === null) {
    throw new Error('upsertProfile requires at least one of wallet or handle');
  }

  // Look up BOTH identities before deciding what to do. The two unique
  // partial indexes on `profiles` mean we can't catch duplicates via
  // `onConflictDoUpdate` against both columns at once, and we also need
  // to detect the "merge" case  -  where wallet and handle each already
  // own a different row  -  before we try to write to either.
  const [byWallet, byHandle] = await Promise.all([
    wallet ? getProfileByWallet(wallet) : Promise.resolve(null),
    handle ? getProfileByHandle(handle) : Promise.resolve(null),
  ]);

  // Merge case: wallet and handle each point at DIFFERENT existing rows.
  // This is the "handle-only fiat profile later connects a wallet that
  // already has a crypto profile" scenario. The cross-row merge needs
  // to atomically DELETE the handle-only row and UPDATE the wallet row
  // to pick up the handle  -  but the runtime `db` client uses the
  // stateless neon-http driver, which does not support interactive
  // `db.transaction()`. Implementing this atomically requires a single
  // raw-SQL CTE (one HTTP round trip = one implicit server transaction).
  //
  // Rather than ship a half-right merge in the scaffolding PR, detect
  // the case and throw an explicit `MergeConflictError`. M5-premium-checkout will add
  // a dedicated `mergeProfiles(walletId, handleId)` helper that runs
  // the CTE when it actually needs this path (wallet-link flow from
  // the handle-only Apple Pay path). No call sites hit upsertProfile
  // yet, so throwing here is a safe contract for the scaffolding.
  if (byWallet && byHandle && byWallet.id !== byHandle.id) {
    throw new MergeConflictError(byWallet.id, byHandle.id);
  }

  // Single-row update: either wallet or handle matched an existing row,
  // OR they both matched the same row. Update in place.
  const existing = byWallet ?? byHandle;
  if (existing) {
    return updateProfileInPlace(existing.id, {
      wallet: wallet ?? existing.wallet,
      handle: handle ?? existing.handle,
      premiumSource: premiumSource ?? existing.premiumSource,
      grantedBy: grantedBy ?? existing.grantedBy,
      reason: reason ?? existing.reason,
      // !==undefined so null explicitly clears; ?? would treat null as "keep existing"
      stripeSessionId: stripeSessionId !== undefined ? stripeSessionId : existing.stripeSessionId,
    });
  }

  // Insert-fresh path with TOCTOU protection. Between the parallel
  // lookup above and this insert, a concurrent `upsertProfile` call
  // with the same wallet/handle could race us to the insert and win
  //  -  a bare insert would then throw an unhandled unique constraint
  // violation from one of the two partial unique indexes.
  //
  // `onConflictDoNothing()` targets any unique conflict: if someone
  // inserted first, we get an empty `returning()` array instead of
  // a thrown error. We then re-run the lookup and apply our update
  // against the row the concurrent request created, giving the
  // caller the same "last writer wins" semantics as the no-race
  // path without needing to surface raw DB errors.
  const insertedRows = await db
    .insert(profiles)
    .values({ wallet, handle, premiumSource, grantedBy, reason, stripeSessionId })
    .onConflictDoNothing()
    .returning();

  if (insertedRows.length > 0) {
    return toProfileRow(insertedRows[0]);
  }

  // Race: a concurrent upsert created the row we wanted to insert.
  // Re-query and update in place. We intentionally do NOT recurse
  // into `upsertProfile`  -  recursion would double the lookup + risk
  // re-entering the merge-conflict branch if the race winner happened
  // to combine wallet+handle differently than we expected.
  const [retryByWallet, retryByHandle] = await Promise.all([
    wallet ? getProfileByWallet(wallet) : Promise.resolve(null),
    handle ? getProfileByHandle(handle) : Promise.resolve(null),
  ]);
  const raceWinner = retryByWallet ?? retryByHandle;
  if (!raceWinner) {
    throw new Error(
      'upsertProfile: insert rejected by unique constraint but row not findable on re-query',
    );
  }
  // Check for merge-conflict across the race: if the concurrent
  // insert landed with one identity and we wanted the other, we'd
  // still hit the cross-row merge case we already guard above.
  if (
    retryByWallet &&
    retryByHandle &&
    retryByWallet.id !== retryByHandle.id
  ) {
    throw new MergeConflictError(retryByWallet.id, retryByHandle.id);
  }
  return updateProfileInPlace(raceWinner.id, {
    wallet: wallet ?? raceWinner.wallet,
    handle: handle ?? raceWinner.handle,
    premiumSource: premiumSource ?? raceWinner.premiumSource,
    grantedBy: grantedBy ?? raceWinner.grantedBy,
    reason: reason ?? raceWinner.reason,
    stripeSessionId: stripeSessionId !== undefined ? stripeSessionId : raceWinner.stripeSessionId,
  });
}

/**
 * Shared "UPDATE profiles SET ... RETURNING *" step used by both the
 * normal update path and the race-recovery path in `upsertProfile`.
 */
async function updateProfileInPlace(
  id: number,
  patch: {
    wallet: string | null;
    handle: string | null;
    premiumSource: ProfileRow['premiumSource'];
    grantedBy: string | null;
    reason: string | null;
    stripeSessionId: string | null;
  },
): Promise<ProfileRow> {
  const updatedRows = await db
    .update(profiles)
    .set({
      wallet: patch.wallet,
      handle: patch.handle,
      premiumSource: patch.premiumSource,
      grantedBy: patch.grantedBy,
      reason: patch.reason,
      stripeSessionId: patch.stripeSessionId,
      updatedAt: new Date(),
    })
    .where(eq(profiles.id, id))
    .returning();
  // Empty `returning()` means the row we tried to update was
  // concurrently deleted between the lookup and this write. The
  // race-recovery path in upsertProfile is the most likely caller
  // to hit this; surface a named error rather than letting the
  // destructure blow up as `Cannot read properties of undefined`.
  if (updatedRows.length === 0) {
    throw new Error(
      `updateProfileInPlace: profile ${id} was concurrently deleted`,
    );
  }
  return toProfileRow(updatedRows[0]);
}

/**
 * Admin premium grant  -  comp premium to a wallet or a handle with no
 * burn, no tx, no Stripe charge. Used by operators from /admin to
 * resolve support issues, reward contributors, hand out comps for
 * Farcaster giveaways, etc.
 *
 * Two identity modes:
 *   - `{ wallet }`  -  inserts a `premium_users` row with `source='admin_grant'`,
 *     `txHash=null`, `grantedBy`, and an optional `reason`. The wallet
 *     immediately reads as premium from `/api/premium/[wallet]`.
 *   - `{ handle }`  -  upserts a `profiles` row with `premium_source='admin_grant'`
 *     and no wallet. The handle becomes premium via the profiles-table
 *     path (wiring up in M5-premium-checkout). For now this creates the profile row so
 *     the grant is recorded even before the M5-premium-checkout check-path lands.
 *
 * Both modes are idempotent: re-granting the same wallet/handle just
 * updates the existing row.
 *
 * Caller is responsible for admin authentication  -  this function does
 * NOT check the allowlist. The `/api/admin/grant-premium` route guards
 * via `requireAdminWallet()` before calling here.
 */
export interface GrantPremiumInput {
  wallet?: string | null;
  handle?: string | null;
  /** Admin wallet performing the grant  -  stored for audit. */
  grantedBy: string;
  /** Optional free-form note (max 200 chars). */
  reason?: string | null;
}

export type GrantPremiumResult =
  | { kind: 'wallet'; wallet: string }
  | { kind: 'handle'; profileId: number; handle: string };

export async function grantPremium(input: GrantPremiumInput): Promise<GrantPremiumResult> {
  const wallet = normalizeIdentity(input.wallet);
  const handle = normalizeIdentity(input.handle);
  const grantedBy = input.grantedBy.toLowerCase();
  const reason = input.reason?.slice(0, 200) ?? null;

  if (wallet === null && handle === null) {
    throw new Error('grantPremium requires wallet or handle');
  }
  if (wallet !== null && handle !== null) {
    throw new Error('grantPremium takes exactly one of wallet or handle, not both');
  }

  if (wallet !== null) {
    const normalizedWallet = wallet.toLowerCase();
    await db
      .insert(premiumUsers)
      .values({
        wallet: normalizedWallet,
        txHash: null,
        source: 'admin_grant',
        grantedBy,
        reason,
      })
      .onConflictDoUpdate({
        target: premiumUsers.wallet,
        set: {
          // Explicitly null txHash on conflict  -  if this wallet
          // previously paid with crypto, its tx_hash is stale now
          // that source flips to 'admin_grant'. Leaving the old
          // hash would leave the audit row internally inconsistent
          // (claims to be an admin grant, still references a burn tx).
          txHash: null,
          source: 'admin_grant',
          grantedBy,
          reason,
          unlockedAt: new Date(),
        },
      });
    return { kind: 'wallet', wallet: normalizedWallet };
  }

  // Handle path: upsert into profiles with premium_source='admin_grant'.
  // Note: the game's premium check currently only reads from
  // premium_users (keyed on wallet). Handle-only premium becomes
  // effective when M5-premium-checkout wires the leaderboard/premium reads through
  // profiles. The grant is recorded now so the audit trail is intact.
  const profile = await upsertProfile({
    handle,
    premiumSource: 'admin_grant',
    // Coalesce nulls to undefined: upsertProfile's type narrows these
    // non-clearable fields to `string | undefined`, so "omitted" is
    // the only way to express "keep existing".
    grantedBy: grantedBy ?? undefined,
    reason: reason ?? undefined,
  });
  return { kind: 'handle', profileId: profile.id, handle: handle as string };
}

/**
 * One row in the admin grant audit list. Grants live in two different
 * tables depending on identity kind:
 *   - `premium_users`  -  grant-by-wallet path
 *   - `profiles`  -  grant-by-handle path (no wallet, M5-premium-checkout-facing)
 *
 * The discriminated `identity` field lets the audit UI render both
 * without the client needing to know which table each row came from.
 * Both branches carry `grantedBy` + `reason` (wallet branch from
 * `premium_users`, handle branch from `profiles`) so the audit is
 * fully attributable regardless of which identity path was used.
 */
export interface PremiumGrantRow {
  identity: { kind: 'wallet'; wallet: string } | { kind: 'handle'; handle: string };
  unlockedAt: Date;
  source: string;
  grantedBy: string | null;
  reason: string | null;
}

/**
 * Recent admin grants for the `/admin` grant tab. Unions the two
 * storage sources, filters to `source='admin_grant'` so paid unlocks
 * don't clutter the list, and returns rows newest-first. Uses two
 * DB queries rather than a SQL UNION so each side can stay on its
 * own Drizzle builder without raw SQL.
 */
export async function getRecentPremiumGrants(limit = 50): Promise<PremiumGrantRow[]> {
  const [walletRows, handleRows] = await Promise.all([
    db
      .select({
        wallet: premiumUsers.wallet,
        unlockedAt: premiumUsers.unlockedAt,
        source: premiumUsers.source,
        grantedBy: premiumUsers.grantedBy,
        reason: premiumUsers.reason,
      })
      .from(premiumUsers)
      .where(eq(premiumUsers.source, 'admin_grant'))
      .orderBy(sql`${premiumUsers.unlockedAt} DESC`)
      .limit(limit),
    db
      .select({
        handle: profiles.handle,
        unlockedAt: profiles.updatedAt,
        grantedBy: profiles.grantedBy,
        reason: profiles.reason,
      })
      .from(profiles)
      .where(
        and(eq(profiles.premiumSource, 'admin_grant'), isNotNull(profiles.handle)),
      )
      .orderBy(sql`${profiles.updatedAt} DESC`)
      .limit(limit),
  ]);

  const merged: PremiumGrantRow[] = [
    ...walletRows.map(
      (r): PremiumGrantRow => ({
        identity: { kind: 'wallet', wallet: r.wallet },
        unlockedAt: r.unlockedAt,
        source: r.source,
        grantedBy: r.grantedBy,
        reason: r.reason,
      }),
    ),
    ...handleRows
      .filter(
        (r): r is {
          handle: string;
          unlockedAt: Date;
          grantedBy: string | null;
          reason: string | null;
        } => r.handle !== null,
      )
      .map(
        (r): PremiumGrantRow => ({
          identity: { kind: 'handle', handle: r.handle },
          unlockedAt: r.unlockedAt,
          source: 'admin_grant',
          grantedBy: r.grantedBy,
          reason: r.reason,
        }),
      ),
  ];

  merged.sort((a, b) => b.unlockedAt.getTime() - a.unlockedAt.getTime());
  return merged.slice(0, limit);
}

/**
 * Revoke a previously-granted premium entitlement. Clears both storage
 * paths so a wallet+handle profile can't hold onto premium via the
 * half we forgot. Idempotent — a second call when nothing is set
 * resolves to a no-op.
 */
export async function revokePremiumForProfile(profileId: number): Promise<void> {
  // Fetch the profile so we know the wallet (if any) to clean up
  // premium_users alongside profiles.premium_source.
  const [profile] = await db
    .select({ wallet: profiles.wallet })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .limit(1);
  if (!profile) return;

  await Promise.all([
    db
      .update(profiles)
      .set({ premiumSource: null, grantedBy: null, reason: null })
      .where(eq(profiles.id, profileId)),
    profile.wallet
      ? db.delete(premiumUsers).where(eq(premiumUsers.wallet, profile.wallet))
      : Promise.resolve(),
  ]);
}

/**
 * Admin-initiated profile edit. Optional fields — omit to leave
 * untouched, pass `null` to clear. Returns `false` when the handle or
 * email would collide with another profile (unique constraint), true
 * on success. Caller is responsible for admin auth; this function
 * does NOT check the allowlist.
 */
export interface UpdateAdminProfileInput {
  id: number;
  handle?: string | null;
  email?: string | null;
}

export async function updateAdminProfile(
  input: UpdateAdminProfileInput,
): Promise<{ ok: true } | { ok: false; reason: 'conflict' | 'not_found' }> {
  const patch: Record<string, string | null | Date> = {};
  if (input.handle !== undefined) {
    patch.handle = input.handle ? input.handle.trim().toLowerCase() : null;
  }
  if (input.email !== undefined) {
    patch.email = input.email ? input.email.trim().toLowerCase() : null;
  }
  if (Object.keys(patch).length === 0) return { ok: true };
  patch.updatedAt = new Date();

  try {
    const result = await db
      .update(profiles)
      .set(patch)
      .where(eq(profiles.id, input.id))
      .returning({ id: profiles.id });
    if (result.length === 0) return { ok: false, reason: 'not_found' };
    return { ok: true };
  } catch (err) {
    // Postgres unique-violation SQLSTATE 23505 → a handle or email that
    // another profile already owns. Translate to a structured result so
    // the route can return 409 without leaking driver internals.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('23505')) return { ok: false, reason: 'conflict' };
    throw err;
  }
}

/**
 * Admin-initiated profile delete. Preserves solves and wordmark rows
 * by nulling their `profile_id` references (so cumulative totals on
 * the leaderboard don't vanish — anonymous solves still count toward
 * the daily board) before removing the profile itself. Also clears
 * the matching `premium_users` row when the profile carried a wallet.
 *
 * Returns `false` if no row exists for the id — safe to call twice.
 */
export async function deleteAdminProfile(profileId: number): Promise<boolean> {
  // Single-statement atomic delete via data-modifying CTEs.
  // Neon-http can't open an interactive transaction (stateless HTTP
  // driver), but one SQL statement is an implicit server
  // transaction: all CTEs run against the statement-start MVCC
  // snapshot and commit or roll back together.
  //
  // The previous implementation issued five separate `db.execute`
  // calls; if the final `DELETE FROM profiles` threw, wordmarks and
  // streaks had already committed on prior HTTP round-trips and the
  // profile row survived — a permanent data-integrity split that
  // admin retry couldn't fix (the foreign children were gone).
  //
  // Per-table strategy differs:
  //   - solves: null out profile_id. Rows stay alive under anonymous
  //     attribution so the daily leaderboard totals don't shift.
  //   - wordmarks: DELETE outright. A naive null-out would violate
  //     the `wordmarks_identity_required` CHECK on any handle-only
  //     or email-auth holder — their rows carry profile_id but no
  //     wallet, so clearing profile_id leaves nothing to satisfy
  //     the "at least one identity" constraint AND collapses the
  //     generated `player_key` column to NULL. Wordmarks are
  //     per-owner achievements; deleting the user deletes them.
  //   - streaks: DELETE outright. Same reasoning — a streak with no
  //     owner has no meaning and some rows are profile-only.
  //   - premium_users: DELETE the matching wallet row. The subselect
  //     reads `profiles.wallet` from the shared pre-modification
  //     snapshot, so it works correctly even though the main query
  //     deletes the profile row in the same statement.
  const rows = await db.execute<{ id: number }>(sql`
    WITH
      upd_solves AS (
        UPDATE solves SET profile_id = NULL
        WHERE profile_id = ${profileId}
        RETURNING 1
      ),
      del_wordmarks AS (
        DELETE FROM wordmarks
        WHERE profile_id = ${profileId}
        RETURNING 1
      ),
      del_streaks AS (
        DELETE FROM streaks
        WHERE profile_id = ${profileId}
        RETURNING 1
      ),
      del_premium AS (
        DELETE FROM premium_users
        WHERE wallet = (SELECT wallet FROM profiles WHERE id = ${profileId})
        RETURNING 1
      )
    DELETE FROM profiles
    WHERE id = ${profileId}
    RETURNING id
  `);
  const resolved = Array.isArray(rows) ? rows : (rows.rows ?? []);
  return resolved.length > 0;
}

/**
 * Record a paid premium unlock from the crypto path (direct permit-burn).
 * Called by `/api/premium/verify` after the server independently confirms
 * the `UnlockedWithBurn` event on the GriddlePremium contract. Idempotent
 * on wallet  -  a replayed verify re-runs the same upsert with the same
 * txHash and ends up at identical state.
 */
export interface RecordCryptoUnlockInput {
  wallet: string;
  txHash: string;
  /** USDC pulled on-chain (6-decimal units). Serialized to the
   *  numeric(20,6) column as a decimal string. */
  usdcAmount: bigint;
  /** $WORD wei burned in the same tx. Serialized as a decimal string. */
  wordBurned: bigint;
}

/**
 * Look up the current `premium_users` row for a wallet. Returns null if
 * none exists. Used by:
 *
 *   - **Stripe webhook**: short-circuit before opening a new on-chain
 *     escrow — if the wallet is already premium (prior crypto unlock,
 *     admin grant, or earlier fiat), pulling more $WORD from the
 *     stockpile would lock funds with no DB trace, since
 *     `onConflictDoNothing` on the insert would drop the new row.
 *
 *   - **Escrow-sync cron**: distinguish "incomplete fiat row from THIS
 *     session" (safe to retry) from "row belongs to a different
 *     premium path" (drop the retry). The caller compares
 *     `externalId` against `keccak256(stripeSessionId)`.
 */
export async function getPremiumRowByWallet(wallet: string): Promise<{
  wallet: string;
  source: string;
  unlockedAt: Date;
  externalId: string | null;
  escrowStatus: string | null;
} | null> {
  const rows = await db
    .select({
      wallet: premiumUsers.wallet,
      source: premiumUsers.source,
      unlockedAt: premiumUsers.unlockedAt,
      externalId: premiumUsers.externalId,
      escrowStatus: premiumUsers.escrowStatus,
    })
    .from(premiumUsers)
    .where(eq(premiumUsers.wallet, wallet.toLowerCase()))
    .limit(1);
  return rows[0] ?? null;
}

export async function recordCryptoUnlock(input: RecordCryptoUnlockInput): Promise<void> {
  const normalized = input.wallet.toLowerCase();
  // USDC is 6-decimal, so convert the integer unit count back to a
  // dollar-precision decimal string for the numeric(20, 6) column.
  // Explicit string representation avoids JS number precision loss.
  const usdcDecimal = formatUsdc6(input.usdcAmount);
  const wordBurnedStr = input.wordBurned.toString();
  await db
    .insert(premiumUsers)
    .values({
      wallet: normalized,
      txHash: input.txHash,
      source: 'crypto',
      grantedBy: null,
      reason: null,
      stripeSessionId: null,
      usdcAmount: usdcDecimal,
      wordBurned: wordBurnedStr,
      // Crypto burns immediately — no escrow lifecycle to track.
      escrowStatus: null,
      escrowOpenTx: null,
      escrowBurnTx: null,
      externalId: null,
    })
    .onConflictDoUpdate({
      target: premiumUsers.wallet,
      set: {
        txHash: input.txHash,
        source: 'crypto',
        grantedBy: null,
        reason: null,
        // Explicitly null stripeSessionId on conflict  -  if this wallet
        // previously paid via fiat, its session id is stale now that
        // source flips to 'crypto'. Leaving the old id would leave the
        // row internally inconsistent (claims to be a crypto unlock,
        // still references a Stripe session). Matches the existing
        // txHash / grantedBy / reason clearing pattern above.
        stripeSessionId: null,
        usdcAmount: usdcDecimal,
        wordBurned: wordBurnedStr,
        escrowStatus: null,
        escrowOpenTx: null,
        escrowBurnTx: null,
        externalId: null,
        unlockedAt: new Date(),
      },
    });

  // Mirror into profiles so the leaderboard / archive reads can eventually
  // resolve premium status by handle as well. Intentionally a fire-and-
  // forget pattern from the caller's point of view  -  if the profile
  // upsert races another writer, the error is surfaced here and retried
  // at the verify endpoint level, not silently swallowed.
  // Explicitly null stripeSessionId so a user who previously paid via
  // fiat doesn't retain the stale Stripe session id on their profile row
  // after re-unlocking via crypto  -  mirrors the same clearing done on
  // the premium_users row above.
  await upsertProfile({ wallet: normalized, premiumSource: 'crypto', stripeSessionId: null });
}

/**
 * Record a paid premium unlock from the fiat path (Stripe checkout).
 * Called by the `checkout.session.completed` webhook after signature
 * verification. `stripeSessionId` is the idempotency key  -  a replayed
 * webhook matches the partial unique index on `stripe_session_id` and
 * no-ops instead of double-granting.
 *
 * Both `wallet` and `handle` are optional here but at least one must be
 * present (validated at the caller). If a wallet is present the grant
 * lands in `premium_users` keyed on that wallet; if only a handle is
 * present it lands in `profiles` with `premium_source='fiat'` and the
 * wallet-keyed read path will pick it up once the player connects.
 */
export interface RecordFiatUnlockInput {
  stripeSessionId: string;
  wallet?: string | null;
  handle?: string | null;
  /** Populated when the webhook successfully opened the on-chain
   *  escrow via `unlockForUser`. Null when the call failed + was
   *  enqueued for retry; the sync cron will backfill it. */
  escrowOpenTx?: string | null;
  /** keccak256(stripeSessionId) — same key the contract uses. */
  externalId?: string | null;
  /** $WORD wei pulled into escrow. Stringified; DB column is
   *  numeric(40,0). */
  wordAmount?: bigint | null;
  /** 'pending' | 'burned' | 'refunded'. Defaults to 'pending' at
   *  write time. */
  escrowStatus?: 'pending' | 'burned' | 'refunded' | null;
}

export async function recordFiatUnlock(input: RecordFiatUnlockInput): Promise<void> {
  const wallet = normalizeIdentity(input.wallet);
  const handle = normalizeIdentity(input.handle);
  if (!wallet && !handle) {
    throw new Error('recordFiatUnlock requires at least one of wallet or handle');
  }

  if (wallet) {
    const normalizedWallet = wallet.toLowerCase();
    // Wallet path: wallet IS the primary key, so wallet-keyed idempotency
    // is guaranteed by onConflictDoUpdate alone. We do NOT store the
    // stripeSessionId on this row  -  that column exists for handle-only
    // fiat buyers who have no wallet PK to anchor their row. Storing it
    // here would create a unique-index conflict on the stripe_session_idx
    // when a second wallet tries to migrate from the same session (e.g.
    // the buyer disconnects wallet A and connects wallet B). The audit
    // trail for wallet-path fiat purchases is in the profiles row written
    // below, which always carries the stripe_session_id.
    // onConflictDoNothing: if the wallet already has a premium_users row
    // (from a prior crypto unlock, admin grant, or a previous fiat purchase),
    // the existing row wins. We must NOT overwrite it  -  doing so would
    // destroy the txHash and source from a crypto premium row, making the
    // on-chain burn untraceable from the DB alone. The wallet is already
    // premium; no update is needed in any case.
    await db
      .insert(premiumUsers)
      .values({
        wallet: normalizedWallet,
        txHash: null,
        source: 'fiat',
        grantedBy: null,
        reason: null,
        stripeSessionId: null,
        // Escrow telemetry — present whenever the on-chain
        // unlockForUser succeeded. Null if the webhook couldn't reach
        // the chain and left the retry queue to handle it.
        escrowStatus: input.escrowStatus ?? null,
        escrowOpenTx: input.escrowOpenTx ?? null,
        escrowBurnTx: null,
        externalId: input.externalId ?? null,
        // Only record the quoted $WORD amount when the escrow
        // actually opened on-chain (escrowStatus='pending'). If the
        // escrow call failed, the quote is stale and writing it to
        // `word_burned` would show a bogus figure in the admin ledger
        // until the retry cron fixes it — let the cron set it at the
        // real oracle price instead.
        wordBurned:
          input.escrowStatus === 'pending' && input.wordAmount
            ? input.wordAmount.toString()
            : null,
      })
      .onConflictDoNothing();
  }

  // Persist the stripe session id on the profile row. For wallet-path
  // fiat unlocks this is the ONLY place the session id lives (we don't
  // store it on premium_users for the wallet path  -  see comment above).
  // For handle-only fiat buyers, profiles is the sole identity row.
  // The partial unique index on profiles.stripe_session_id gives
  // idempotency: a replayed webhook updates in place rather than
  // inserting a duplicate.
  // upsertProfile is supplementary audit  -  premium access is already
  // granted via the premium_users row above (wallet path) or the session
  // key (no-wallet path). A profile write failure must NOT propagate: if it
  // did, the migrate route's catch block would restore the session key even
  // though the premium_users insert already committed, allowing a second
  // wallet to claim the same session and create a double-grant.
  await upsertProfile({
    wallet: wallet ?? undefined,
    handle: handle ?? undefined,
    premiumSource: 'fiat',
    stripeSessionId: input.stripeSessionId,
  }).catch((err) => {
    console.error('[recordFiatUnlock] upsertProfile failed (non-fatal, premium_users row committed)', err);
  });
}

/**
 * Solve-timing read. Returns both the load time and the Start time for
 * this session's puzzle row. The solve route prefers started_at and
 * falls back to loaded_at when it's null (direct POST, or a row that
 * pre-dates the Start gate).
 */
export async function getPuzzleLoadAndStart(
  sessionId: string,
  dayNumber: number,
): Promise<{ loadedAt: Date; startedAt: Date | null } | null> {
  const rows = await db
    .select({
      loadedAt: puzzleLoads.loadedAt,
      startedAt: puzzleLoads.startedAt,
    })
    .from(puzzleLoads)
    .innerJoin(puzzles, eq(puzzleLoads.puzzleId, puzzles.id))
    .where(and(eq(puzzleLoads.sessionId, sessionId), eq(puzzles.dayNumber, dayNumber)))
    .limit(1);
  if (rows.length === 0) return null;
  return {
    loadedAt: new Date(rows[0].loadedAt),
    startedAt: rows[0].startedAt ? new Date(rows[0].startedAt) : null,
  };
}

/**
 * Read the current `started_at` (if any) for a (session, puzzle) pair,
 * addressed by dayNumber. Used by SSR + archive puzzle loads to decide
 * whether to show the Start gate or render the puzzle as already-in-
 * progress (timer running from the stored start).
 *
 * Delegates to getPuzzleLoadAndStart so both callers share a single
 * query shape — schema/join changes land in one place.
 */
export async function getPuzzleStartedAt(
  sessionId: string,
  dayNumber: number,
): Promise<Date | null> {
  const result = await getPuzzleLoadAndStart(sessionId, dayNumber);
  return result?.startedAt ?? null;
}

/**
 * First-Start-wins. Stamps started_at = NOW() on the puzzle_loads row
 * for this (session, puzzle) pair iff started_at is still NULL. Returns
 * the authoritative started_at after the write (either the fresh
 * stamp, or the pre-existing one on a replay).
 *
 * Upserts the row with started_at pre-populated when no puzzle_loads
 * row exists yet. That covers a direct /api/puzzle/start POST that
 * bypassed the SSR page — still rare, but the game shouldn't silently
 * write no row and leave solve timing broken if it happens.
 */
export async function markPuzzleStarted(
  sessionId: string,
  puzzleId: number,
): Promise<Date> {
  // UPDATE first — the common path (row already exists from
  // recordPuzzleLoad). COALESCE keeps started_at immutable after the
  // first stamp: subsequent calls read back the original value.
  const updated = await db
    .update(puzzleLoads)
    .set({ startedAt: sql`COALESCE(${puzzleLoads.startedAt}, NOW())` })
    .where(
      and(
        eq(puzzleLoads.sessionId, sessionId),
        eq(puzzleLoads.puzzleId, puzzleId),
      ),
    )
    .returning({ startedAt: puzzleLoads.startedAt });

  if (updated.length > 0 && updated[0].startedAt != null) {
    return new Date(updated[0].startedAt);
  }

  // No row existed — insert one with started_at populated. Use
  // onConflictDoUpdate with the same COALESCE guard so a parallel
  // recordPuzzleLoad (which sets started_at=null) inserting first
  // doesn't steal the Start stamp.
  const inserted = await db
    .insert(puzzleLoads)
    .values({ sessionId, puzzleId, startedAt: sql`NOW()` })
    .onConflictDoUpdate({
      target: [puzzleLoads.sessionId, puzzleLoads.puzzleId],
      set: { startedAt: sql`COALESCE(${puzzleLoads.startedAt}, NOW())` },
    })
    .returning({ startedAt: puzzleLoads.startedAt });

  if (inserted.length === 0 || inserted[0].startedAt == null) {
    throw new Error('markPuzzleStarted: failed to persist started_at');
  }
  return new Date(inserted[0].startedAt);
}

// ─── Magic link auth ─────────────────────────────────────────────────────────

import { createHash, randomBytes } from 'crypto';

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 5;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a magic link token for the given email. Returns the raw
 * token to embed in the link URL; stores only the SHA-256 hash.
 * Rate-limited to 5 requests per email per hour.
 */
export async function createMagicLink(
  email: string,
): Promise<{ token: string } | { error: string }> {
  const normalized = email.toLowerCase().trim();
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);

  const raw = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);

  // Atomic rate limit: a single INSERT ... SELECT that only inserts
  // when the recent-token count is under the cap. Returns a row when
  // the insert happened and nothing when it was rate-limited. Closes
  // the TOCTOU gap between a separate count + insert.
  //
  // Counts ALL tokens created in the last hour, used or not. The
  // rate limit is a spam guard on the email transport — 5 magic link
  // emails per hour is the hard ceiling on how many messages we'll
  // send to a single address, regardless of whether the user clicked
  // them. A legit user needing >5 in an hour is an extreme edge case
  // (most never need more than 1) and is worth the trade against
  // leaving the transport uncapped.
  const inserted = await db.execute<{ id: number }>(sql`
    INSERT INTO magic_links (email, token_hash, expires_at)
    SELECT ${normalized}, ${tokenHash}, ${expiresAt}
    WHERE (
      SELECT count(*) FROM magic_links
      WHERE email = ${normalized}
        AND created_at >= ${since}
    ) < ${RATE_LIMIT_MAX}
    RETURNING id
  `);

  if (inserted.rows.length === 0) {
    return { error: 'Too many sign-in requests. Try again in an hour.' };
  }
  return { token: raw };
}

/**
 * Delete a magic link by its raw token. Used by the request route to
 * roll back a just-created token when the email transport fails, so
 * the wasted slot doesn't count against the hourly rate limit.
 */
export async function deleteMagicLink(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await db.delete(magicLinks).where(eq(magicLinks.tokenHash, tokenHash));
}

/**
 * Verify a magic link token. Marks it used immediately on success
 * to prevent replay. Returns the email on success.
 */
export async function verifyMagicLink(
  token: string,
): Promise<{ email: string } | { error: string }> {
  const tokenHash = hashToken(token);

  // Single atomic UPDATE: only one concurrent request can set usedAt from
  // NULL to a timestamp. The second concurrent request finds no matching
  // row (usedAt IS NULL fails) and gets an empty returning() array —
  // no SELECT+UPDATE race, no double-verification.
  const rows = await db
    .update(magicLinks)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(magicLinks.tokenHash, tokenHash),
        isNull(magicLinks.usedAt),
        gte(magicLinks.expiresAt, new Date()),
      ),
    )
    .returning({ email: magicLinks.email });

  if (rows.length === 0) {
    return { error: 'Invalid or expired sign-in link.' };
  }

  return { email: rows[0].email };
}

/**
 * Auto-merge two profile rows into one. The older row (by createdAt) is
 * kept as the "survivor" — its id, createdAt, and any non-null identity
 * fields are preserved. Non-null fields from the newer row fill in any
 * gaps. The newer row is then deleted.
 *
 * Implemented as a raw-SQL CTE so both the DELETE and the UPDATE land in
 * a single implicit server transaction on the neon-http driver (one HTTP
 * roundtrip = one transaction on the serverless HTTP protocol).
 *
 * Callers receive the merged survivor ProfileRow.
 */
export async function mergeProfiles(
  idA: number,
  idB: number,
): Promise<ProfileRow> {
  // Fully atomic merge. Previously this function read both rows into JS,
  // computed the merged patch, then issued a CTE to DELETE+UPDATE. The
  // read-compute-write sequence wasn't atomic — a concurrent writer
  // mutating the donor row between the read and the CTE (e.g. an email
  // just getting verified) would silently lose the fresh value.
  //
  // The rewritten version is a single SQL statement. All reads of
  // `profiles` happen from the statement-start MVCC snapshot, so the
  // COALESCEs inside the CTE can't observe a stale version of one row
  // while the DELETE/UPDATE commit another. Neon-http still can't start
  // a transaction, but one statement is an implicit one.
  // NOTE on CTE ordering:
  //
  // The UPDATE's `FROM pair, deleted` is load-bearing — `deleted`
  // carries a RETURNING clause and is referenced here specifically
  // so Postgres serializes the DELETE before the UPDATE. Sibling
  // data-modifying CTEs without a dependency run concurrently under
  // the same MVCC snapshot; our `profiles_email_lower_idx` unique
  // constraint is checked row-by-row as the UPDATE rewrites indexed
  // columns, so a concurrent UPDATE could race ahead of the DELETE
  // and see the old newer-row entry still occupying the email slot.
  // That produced a 23505 unique_violation every time we tried to
  // merge a wallet-only profile with a freshly-verified email-only
  // profile (starl3xx + starl3xx.mail@gmail.com in the wild) — the
  // email-only row persisted as an orphan and the calling route
  // bubbled the error up as "session binding failed".
  //
  // By joining `deleted` into the UPDATE's FROM, we force the UPDATE
  // to read from `deleted`'s RETURNING stream, which in turn forces
  // `deleted` to complete before the UPDATE pass starts writing
  // indexed columns. The cross join with a single-row `pair` × a
  // single-row `deleted` still produces exactly one input row; the
  // UPDATE targets the older profile as before.
  const rows = await db.execute<{ older_id: number }>(sql`
    WITH pair AS (
      SELECT
        older.id            AS older_id,
        newer.id            AS newer_id,
        COALESCE(older.wallet,             newer.wallet)             AS wallet,
        COALESCE(older.handle,             newer.handle)             AS handle,
        COALESCE(older.email,              newer.email)              AS email,
        COALESCE(older.email_verified_at,  newer.email_verified_at)  AS email_verified_at,
        -- Avatar priority: a 'custom' avatar on EITHER side wins over
        -- a 'farcaster'/null avatar on the other side, regardless of
        -- row age. Plain COALESCE would pick the older row first —
        -- which loses the user's uploaded photo if they had an older
        -- Farcaster row that gets merged with a newer custom row.
        -- The avatar_url and avatar_source CASEs mirror each other so
        -- the merged row's (url, source) pair is always from the same
        -- source row (never a Frankenstein of one url + the other source).
        CASE
          WHEN older.avatar_source = 'custom' THEN older.avatar_url
          WHEN newer.avatar_source = 'custom' THEN newer.avatar_url
          ELSE COALESCE(older.avatar_url, newer.avatar_url)
        END                                                            AS avatar_url,
        CASE
          WHEN older.avatar_source = 'custom' THEN older.avatar_source
          WHEN newer.avatar_source = 'custom' THEN newer.avatar_source
          ELSE COALESCE(older.avatar_source, newer.avatar_source)
        END                                                            AS avatar_source,
        COALESCE(older.farcaster_fid,      newer.farcaster_fid)      AS farcaster_fid,
        COALESCE(older.farcaster_username, newer.farcaster_username) AS farcaster_username,
        COALESCE(older.premium_source,     newer.premium_source)     AS premium_source,
        COALESCE(older.granted_by,         newer.granted_by)         AS granted_by,
        COALESCE(older.reason,             newer.reason)             AS reason,
        COALESCE(older.stripe_session_id,  newer.stripe_session_id)  AS stripe_session_id
      FROM
        profiles older,
        profiles newer
      WHERE older.id IN (${idA}, ${idB})
        AND newer.id IN (${idA}, ${idB})
        AND older.id <> newer.id
        AND (older.created_at, older.id) <= (newer.created_at, newer.id)
    ),
    deleted AS (
      DELETE FROM profiles
      WHERE id = (SELECT newer_id FROM pair)
      RETURNING id AS deleted_id
    ),
    updated AS (
      UPDATE profiles p SET
        wallet             = pair.wallet,
        handle             = pair.handle,
        email              = pair.email,
        email_verified_at  = pair.email_verified_at,
        avatar_url         = pair.avatar_url,
        avatar_source      = pair.avatar_source,
        farcaster_fid      = pair.farcaster_fid,
        farcaster_username = pair.farcaster_username,
        premium_source     = pair.premium_source,
        granted_by         = pair.granted_by,
        reason             = pair.reason,
        stripe_session_id  = pair.stripe_session_id,
        updated_at         = now()
      FROM pair, deleted
      WHERE p.id = pair.older_id
      RETURNING p.id AS older_id
    )
    SELECT older_id FROM updated
  `);

  // `db.execute()` returns raw driver rows with snake_case column
  // names; toProfileRow expects drizzle-mapped camelCase. Instead of
  // renaming keys, just fetch the survivor through the query builder —
  // the atomic CTE above already did the merge, so this read is free
  // and guaranteed to see the merged state.
  const resultRows = Array.isArray(rows) ? rows : rows.rows;
  const olderId = resultRows[0]?.older_id;
  if (olderId == null) {
    throw new Error('mergeProfiles: one or both profiles not found');
  }
  const survivor = await db.select().from(profiles).where(eq(profiles.id, olderId)).limit(1);
  if (!survivor[0]) {
    throw new Error('mergeProfiles: survivor row disappeared immediately after merge');
  }
  return toProfileRow(survivor[0]);
}

/**
 * Upsert a profile for a Farcaster miniapp user. Called from GameClient
 * when a wallet connects and `inMiniApp === true`.
 *
 * Strategy:
 *   1. Look up by Farcaster FID — if found, bind session and return.
 *   2. Look up by wallet — if found, add FID/username/pfp and return.
 *   3. If both exist as different rows → auto-merge.
 *   4. If neither exists → create a new profile with all Farcaster data.
 */
export async function upsertProfileForFarcaster(input: {
  fid: number;
  username: string | null;
  /**
   * Farcaster's human-readable display_name (e.g. "Big Jake"). No
   * longer stored on profiles — we only keep the lowercase
   * `farcaster_username` alongside our own `handle`. Still accepted
   * here as an input so the caller doesn't have to know, but it's
   * effectively ignored.
   */
  displayName?: string | null;
  avatarUrl: string | null;
  wallet: string | null;
}): Promise<ProfileRow> {
  const wallet = input.wallet ? input.wallet.toLowerCase() : null;

  // byWallet uses the raw-SQL helper to dodge the drizzle wallet-eq
  // drift. byFid stays on the drizzle builder — no drift observed on
  // integer columns, and farcaster_fid is wholly owned by this helper
  // so a fallback wouldn't save reads elsewhere.
  const [byFid, byWallet] = await Promise.all([
    db.select().from(profiles)
      .where(eq(profiles.farcasterFid, input.fid)).limit(1),
    wallet ? selectRawProfileByWallet(wallet) : Promise.resolve(null),
  ]);

  const fidRow  = byFid[0]   ?? null;
  const walletRow = byWallet ?? null;

  // Decide whether a Farcaster sync is allowed to overwrite an
  // existing avatarUrl on a row. Custom uploads are protected — once
  // a user has uploaded their own photo, subsequent Farcaster syncs
  // must NOT clobber it. Farcaster-sourced avatars and null rows are
  // both fair game: we treat `null` avatar_source as "unknown, but
  // since no one has ever uploaded, it's safe to replace with the
  // current Farcaster pfp". This is the QoL fix that lets a user's
  // updated Farcaster pfp propagate into Griddle without requiring
  // a re-connect.
  const canOverwriteAvatar = (row: { avatarSource: string | null } | null): boolean =>
    !row || row.avatarSource !== 'custom';

  // Auto-merge if two different rows, then apply fresh Farcaster input
  // on top of the merged survivor so the latest username/avatar/wallet
  // aren't silently lost (mergeProfiles only combines existing row data).
  // Crucially includes farcasterFid in the patch: mergeProfiles uses
  // `older.farcasterFid ?? newer.farcasterFid`, so if the older wallet
  // row had a stale FID (or none), the merged row might not carry the
  // FID belonging to the user who's currently authing. Always overwrite
  // with the incoming FID since we were looked up by it.
  if (fidRow && walletRow && fidRow.id !== walletRow.id) {
    const merged = await mergeProfiles(fidRow.id, walletRow.id);
    const freshPatch: Record<string, unknown> = {
      farcasterFid: input.fid,
      updatedAt: new Date(),
    };
    if (input.username) freshPatch.farcasterUsername = input.username;
    // Avatar policy on the merged survivor: protect 'custom' uploads
    // (merged inherits avatarSource via mergeProfiles COALESCE); for
    // anything else, apply the incoming Farcaster pfp if provided.
    if (input.avatarUrl && canOverwriteAvatar(merged)) {
      freshPatch.avatarUrl = input.avatarUrl;
      freshPatch.avatarSource = 'farcaster';
    }
    // Always overwrite the merged wallet with the user's current one
    // when supplied. mergeProfiles picks `older.wallet ?? newer.wallet`,
    // so if both rows had wallets the older one wins and the user's
    // *current* wallet (carried by walletRow, which mergeProfiles just
    // deleted) would disappear from the profiles table entirely,
    // leaving the session-wallet KV referencing a wallet no profile
    // owns. Authoritative source here is the wallet the user is
    // actively connecting with.
    if (wallet) freshPatch.wallet = wallet;
    const rows = await db
      .update(profiles)
      .set(freshPatch)
      .where(eq(profiles.id, merged.id))
      .returning();
    return toProfileRow(rows[0]);
  }

  const existing = fidRow ?? walletRow ?? null;

  // Avatar policy for the single-row update path: protect custom
  // uploads, otherwise adopt the incoming Farcaster pfp. This is the
  // QoL fix — previously this line was
  //   `existing?.avatarUrl ?? input.avatarUrl ?? null`
  // which pinned the avatar to whatever was set on first-ever sync
  // and never refreshed it afterwards, so a user who updated their
  // Farcaster pfp would see the stale image in Griddle forever.
  const nextAvatarUrl =
    canOverwriteAvatar(existing) && input.avatarUrl
      ? input.avatarUrl
      : existing?.avatarUrl ?? input.avatarUrl ?? null;
  const nextAvatarSource =
    canOverwriteAvatar(existing) && input.avatarUrl
      ? 'farcaster'
      : existing?.avatarSource ?? (input.avatarUrl ? 'farcaster' : null);

  const patch = {
    farcasterFid:      input.fid,
    farcasterUsername: input.username ?? existing?.farcasterUsername ?? null,
    avatarUrl:         nextAvatarUrl,
    avatarSource:      nextAvatarSource,
    wallet:            wallet ?? existing?.wallet ?? null,
    updatedAt:         new Date(),
  };

  if (existing) {
    const rows = await db
      .update(profiles)
      .set(patch)
      .where(eq(profiles.id, existing.id))
      .returning();
    return toProfileRow(rows[0]);
  }

  // New profile. Seed a handle from the Farcaster @username — but run
  // it through the profanity check and null it out if it fails (user
  // can pick a clean one from Settings later). If the slugified handle
  // collides with an existing unique-index entry, drop it (null handle)
  // and let the insert succeed on fid/wallet instead. The user can set
  // their handle from Settings — better than crashing the first connect.
  let seedHandle: string | null = null;
  if (input.username) {
    const slug = slugifyUsername(input.username);
    const { valid } = validateUsername(slug);
    if (valid) seedHandle = slug;
  }

  const inserted = await db.insert(profiles).values({
    farcasterFid: input.fid,
    farcasterUsername: input.username ?? null,
    handle: seedHandle,
    avatarUrl: input.avatarUrl ?? null,
    avatarSource: input.avatarUrl ? 'farcaster' : null,
    wallet,
    updatedAt: new Date(),
  }).onConflictDoNothing().returning();

  let r = inserted[0];
  if (!r) {
    // onConflictDoNothing returned empty — could be fid, wallet, OR
    // handle collision. If it was a handle collision on a new FID/wallet,
    // retry without the handle so the profile still gets created.
    if (seedHandle) {
      const retry = await db.insert(profiles).values({
        farcasterFid: input.fid,
        farcasterUsername: input.username ?? null,
        handle: null,
        avatarUrl: input.avatarUrl ?? null,
        avatarSource: input.avatarUrl ? 'farcaster' : null,
        wallet,
        updatedAt: new Date(),
      }).onConflictDoNothing().returning();
      r = retry[0];
    }
    if (!r) {
      // True FID/wallet collision — another request won the race.
      const refetch = await db
        .select()
        .from(profiles)
        .where(eq(profiles.farcasterFid, input.fid))
        .limit(1);
      r = refetch[0]
        ?? (wallet
          ? (await selectRawProfileByWallet(wallet)) ?? undefined
          : undefined);
      if (!r) throw new Error('upsertProfileForFarcaster: insert conflict but no row found on re-fetch');
    }
  }
  return toProfileRow(r);
}

/**
 * Get or create a profile keyed on email. Used after magic link
 * verification to give the user a profile they can enrich later.
 */
export async function getOrCreateProfileByEmail(
  email: string,
): Promise<ProfileRow> {
  const normalized = email.toLowerCase().trim();

  // Look for existing profile by email
  const existing = await db
    .select()
    .from(profiles)
    .where(sql`lower(${profiles.email}) = lower(${normalized})`)
    .limit(1);

  if (existing.length > 0) {
    let r = existing[0];
    // If email wasn't verified yet, verify it now — use .returning() so
    // the returned profile object matches what's actually in the DB
    // (same updatedAt, same emailVerifiedAt).
    if (!r.emailVerifiedAt) {
      const now = new Date();
      const updated = await db
        .update(profiles)
        .set({ emailVerifiedAt: now, updatedAt: now })
        .where(eq(profiles.id, r.id))
        .returning();
      if (updated[0]) r = updated[0];
    }
    return toProfileRow(r);
  }

  // Create new email-only profile — onConflictDoNothing guards the
  // race where two concurrent verify requests for the same email both
  // pass the SELECT above and reach the INSERT simultaneously. The
  // second request gets an empty returning() and falls through to the
  // re-query below. Without this, the second request would throw an
  // uncaught unique constraint violation, consuming the magic link
  // token with no profile created.
  const inserted = await db
    .insert(profiles)
    .values({
      email: normalized,
      emailVerifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();

  // Re-fetch if the concurrent insert won the race
  const r = inserted[0] ?? (await db
    .select()
    .from(profiles)
    .where(sql`lower(${profiles.email}) = lower(${normalized})`)
    .limit(1)
  )[0];

  if (!r) {
    // Insert hit a conflict but the re-fetch also returned nothing —
    // the racing row must have been deleted between the two queries.
    // Extremely unlikely in practice; surface a clear error instead of
    // crashing on undefined.id.
    throw new Error(`getOrCreateProfileByEmail: conflict on ${normalized} but no row on re-fetch`);
  }
  return toProfileRow(r);
}

// ─── User settings ──────────────────────────────────────────────────────────

export interface UserSettingsRow {
  wallet: string;
  streakProtectionEnabled: boolean;
  streakProtectionUsedAt: Date | null;
  unassistedModeEnabled: boolean;
  darkModeEnabled: boolean;
  updatedAt: Date;
}

/** Default settings used when no row exists for the wallet. */
export const DEFAULT_USER_SETTINGS: Omit<UserSettingsRow, 'wallet' | 'updatedAt'> = {
  streakProtectionEnabled: false,
  streakProtectionUsedAt: null,
  unassistedModeEnabled: false,
  darkModeEnabled: false,
};

/**
 * Uses raw SQL — see "Drizzle wallet-eq drift" in README Code Style.
 * Called from both `/api/settings` and (after the SSR hydration PR)
 * the root `app/page.tsx` server component, so both paths need a
 * drift-proof read.
 */
export async function getUserSettings(wallet: string): Promise<UserSettingsRow | null> {
  const normalized = wallet.toLowerCase();
  const result = await db.execute<{
    wallet: string;
    streakProtectionEnabled: boolean;
    streakProtectionUsedAt: Date | string | null;
    unassistedModeEnabled: boolean;
    darkModeEnabled: boolean;
    updatedAt: Date | string;
  }>(sql`
    SELECT
      wallet,
      streak_protection_enabled   AS "streakProtectionEnabled",
      streak_protection_used_at   AS "streakProtectionUsedAt",
      unassisted_mode_enabled     AS "unassistedModeEnabled",
      dark_mode_enabled           AS "darkModeEnabled",
      updated_at                  AS "updatedAt"
    FROM user_settings
    WHERE wallet = ${normalized}
    LIMIT 1
  `);
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    wallet: r.wallet,
    streakProtectionEnabled: r.streakProtectionEnabled,
    streakProtectionUsedAt:
      r.streakProtectionUsedAt == null
        ? null
        : r.streakProtectionUsedAt instanceof Date
          ? r.streakProtectionUsedAt
          : new Date(r.streakProtectionUsedAt),
    unassistedModeEnabled: r.unassistedModeEnabled,
    darkModeEnabled: r.darkModeEnabled,
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt : new Date(r.updatedAt),
  };
}

export interface UpdateUserSettingsInput {
  streakProtectionEnabled?: boolean;
  unassistedModeEnabled?: boolean;
  darkModeEnabled?: boolean;
}

export async function upsertUserSettings(
  wallet: string,
  patch: UpdateUserSettingsInput,
): Promise<UserSettingsRow> {
  const normalized = wallet.toLowerCase();
  const rows = await db
    .insert(userSettings)
    .values({
      wallet: normalized,
      streakProtectionEnabled: patch.streakProtectionEnabled ?? false,
      unassistedModeEnabled: patch.unassistedModeEnabled ?? false,
      darkModeEnabled: patch.darkModeEnabled ?? false,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userSettings.wallet,
      set: {
        ...(patch.streakProtectionEnabled !== undefined && {
          streakProtectionEnabled: patch.streakProtectionEnabled,
        }),
        ...(patch.unassistedModeEnabled !== undefined && {
          unassistedModeEnabled: patch.unassistedModeEnabled,
        }),
        ...(patch.darkModeEnabled !== undefined && {
          darkModeEnabled: patch.darkModeEnabled,
        }),
        updatedAt: new Date(),
      },
    })
    .returning();
  const r = rows[0];
  return {
    wallet: r.wallet,
    streakProtectionEnabled: r.streakProtectionEnabled,
    streakProtectionUsedAt: r.streakProtectionUsedAt,
    unassistedModeEnabled: r.unassistedModeEnabled,
    darkModeEnabled: r.darkModeEnabled,
    updatedAt: r.updatedAt,
  };
}

// ─── Funnel telemetry rollups ──────────────────────────────────────

// Type definitions live in `lib/funnel/types.ts` so the admin Funnel
// tab (a `'use client'` component) can import the same shapes without
// dragging db/client.ts and the postgres driver into the client bundle.
// Re-exported here so existing server-side call sites keep their
// import paths.
export type {
  FunnelWindow,
  FunnelStageRow,
  FunnelBreakdownRow,
  FunnelTimeToConvertRow,
  FunnelStats,
} from '@/lib/funnel/types';
import type { FunnelWindow, FunnelStats } from '@/lib/funnel/types';

/** SQL interval string for a FunnelWindow. `all` returns null = no bound. */
function windowIntervalSql(window: FunnelWindow) {
  switch (window) {
    case '24h': return sql`now() - interval '1 day'`;
    case '7d':  return sql`now() - interval '7 days'`;
    case '30d': return sql`now() - interval '30 days'`;
    case 'all': return null;
  }
}

export async function getFunnelStats(window: FunnelWindow = '7d'): Promise<FunnelStats> {
  const since = windowIntervalSql(window);
  const timeBound = since
    ? sql`${funnelEvents.createdAt} >= ${since}`
    : sql`true`;

  // Stage rollup — distinct sessions and total events per event_name.
  const stageRows = await db
    .select({
      eventName: funnelEvents.eventName,
      sessions: sql<number>`count(distinct ${funnelEvents.sessionId})::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(funnelEvents)
    .where(timeBound)
    .groupBy(funnelEvents.eventName);

  // Breakdown — second group key is the metadata discriminator we care
  // about for each event. checkout_failed is special: its metadata has
  // BOTH `method` and `reason`, and we want the bucket to be the reason
  // (e.g. http_400) — not the method — so the funnel surfaces failure
  // taxonomies. Plain coalesce would pick `method` first and collapse
  // all failures under "fiat" / "crypto". Use a CASE expression so
  // checkout_failed routes to `reason`, everything else falls back to
  // the method/feature/variant coalesce.
  const bucketExpr = sql`
    case
      when ${funnelEvents.eventName} = 'checkout_failed'
        then coalesce(${funnelEvents.metadata}->>'reason', 'n/a')
      else coalesce(
        ${funnelEvents.metadata}->>'method',
        ${funnelEvents.metadata}->>'feature',
        ${funnelEvents.metadata}->>'variant',
        'n/a'
      )
    end
  `;
  const breakdownRows = await db
    .select({
      eventName: funnelEvents.eventName,
      bucket: sql<string>`${bucketExpr}`,
      sessions: sql<number>`count(distinct ${funnelEvents.sessionId})::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(funnelEvents)
    .where(timeBound)
    .groupBy(funnelEvents.eventName, bucketExpr);

  // Median time-to-convert per method. For each session we compute the
  // gap between its earliest upgrade_clicked and its earliest
  // checkout_completed of the same method, then take the median via
  // percentile_cont. Sessions that never converted don't appear — we're
  // measuring speed, not rate (that's what the stages query is for).
  //
  // Note: the reusable `timeBound` fragment renders as
  // `funnel_events.created_at` which is ambiguous inside the self-join
  // below (both aliases `uc` and `cc` point at funnel_events). Build
  // a CTE-local time bound that names the alias explicitly.
  const ttcTimeBound = since ? sql`uc.created_at >= ${since}` : sql`true`;
  const ttcRows = await db.execute<{ method: string; median_ms: number | null }>(sql`
    WITH paired AS (
      SELECT
        uc.session_id,
        uc.metadata->>'method' AS method,
        extract(epoch FROM (min(cc.created_at) - min(uc.created_at))) * 1000 AS gap_ms
      FROM funnel_events uc
      JOIN funnel_events cc
        ON cc.session_id = uc.session_id
       AND cc.event_name = 'checkout_completed'
       AND cc.metadata->>'method' = uc.metadata->>'method'
       AND cc.created_at >= uc.created_at
      WHERE uc.event_name = 'upgrade_clicked'
        AND ${ttcTimeBound}
      GROUP BY uc.session_id, uc.metadata->>'method'
    )
    SELECT method,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_ms)::float AS median_ms
    FROM paired
    WHERE gap_ms >= 0
    GROUP BY method
  `);

  const ttcArr = Array.isArray(ttcRows) ? ttcRows : ttcRows.rows;
  const medianTimeToConvertMs: FunnelStats['medianTimeToConvertMs'] = (['crypto', 'fiat'] as const).map(
    (method) => {
      const row = ttcArr.find((r) => r.method === method);
      return { method, ms: row?.median_ms ?? null };
    },
  );

  return {
    window,
    stages: stageRows,
    breakdown: breakdownRows,
    medianTimeToConvertMs,
  };
}

// ─── Wordmarks ──────────────────────────────────────────────────────

export interface EarnedWordmarkRow {
  wordmarkId: string;
  earnedAt: Date;
  puzzleId: number | null;
}

/**
 * Insert a batch of wordmark awards for a wallet, skipping any that
 * already exist (via the `(wallet, wordmark_id)` unique index).
 * Returns the ids that were actually inserted — callers use this
 * return value to decide which ones to surface in the earn toast
 * post-solve.
 *
 * Empty input is a no-op and returns an empty list (don't hit the DB
 * for a zero-row insert, which drizzle handles gracefully but still
 * costs a round trip).
 */
export async function insertWordmarksIfNew(
  identity: StatsIdentity,
  wordmarkIds: readonly string[],
  puzzleId: number | null,
): Promise<string[]> {
  if (wordmarkIds.length === 0) return [];
  const profileId = identity.profileId ?? null;
  const wallet = identity.wallet?.toLowerCase() ?? null;
  // No identifiable player → nothing to write. Anonymous (session-only)
  // callers can't earn wordmarks since there's no durable identity to
  // attach them to.
  if (profileId == null && wallet == null) return [];

  const rows = wordmarkIds.map((id) => ({
    profileId,
    wallet,
    wordmarkId: id,
    puzzleId,
  }));
  // ON CONFLICT targets the generated `player_key` column's unique
  // index so a wallet + profile row collides with a profile-only row
  // (once profile_id is the same), preventing a player from double-
  // earning the same wordmark across identity changes.
  const inserted = await db
    .insert(wordmarks)
    .values(rows)
    .onConflictDoNothing({
      target: [wordmarks.playerKey, wordmarks.wordmarkId],
    })
    .returning({ wordmarkId: wordmarks.wordmarkId });
  return inserted.map((r) => r.wordmarkId);
}

/**
 * Fetch all wordmarks earned by a player, newest first. Used by the
 * Lexicon grid on the Stats panel.
 *
 * Keyed on player_key (profile_id preferred, wallet fallback) so a
 * handle-only user and a wallet-only user each see their own row
 * set under the same identity scheme the /api/solve write path uses.
 *
 * Uses raw SQL — see the "Drizzle wallet-eq drift" note in the README
 * Code Style section. The original wallet-eq flakiness was observed
 * on the same column pattern being used here, so the same raw-SQL
 * precaution applies.
 */
export async function getWordmarksForPlayer(
  identity: StatsIdentity,
): Promise<EarnedWordmarkRow[]> {
  const playerKey = playerKeyFor(identity);
  if (playerKey == null) return [];
  const result = await db.execute<{
    wordmarkId: string;
    earnedAt: Date;
    puzzleId: number | null;
  }>(sql`
    SELECT
      wordmark_id AS "wordmarkId",
      earned_at   AS "earnedAt",
      puzzle_id   AS "puzzleId"
    FROM wordmarks
    WHERE player_key = ${playerKey}
    ORDER BY earned_at DESC
  `);
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  return rows.map((r) => ({
    wordmarkId: r.wordmarkId,
    // Neon HTTP may return timestamps as either Date or ISO string
    // depending on driver version — coerce defensively so callers can
    // always call `.toISOString()` on the result.
    earnedAt: r.earnedAt instanceof Date ? r.earnedAt : new Date(r.earnedAt),
    puzzleId: r.puzzleId,
  }));
}

/**
 * Update the streak row for a wallet after a successful solve.
 *
 * Rules (matching the spec):
 *   - First solve ever           → currentStreak = 1, longest = 1
 *   - Same dayNumber as last     → no change (player already solved today)
 *   - dayNumber === last + 1     → currentStreak += 1, bump longest if needed
 *   - Any larger gap             → currentStreak = 1 (streak broken + restart)
 *
 * Premium streak-protection is NOT integrated here — that's a follow-up.
 * For now, missing a day always resets the streak regardless of the
 * user_settings.streak_protection_enabled flag.
 *
 * This is the first write path for the `streaks` table — previously
 * the table was read-only from the admin-seeded side, which meant
 * Fireproof / Steadfast / Centurion never had a chance to fire. Now
 * that solves drive streak state, those three wordmarks become
 * earnable.
 *
 * Returns the post-update `currentStreak` so the caller can feed it
 * into awardWordmarks without a follow-up SELECT.
 */
export async function updateStreakForSolve(
  identity: StatsIdentity,
  dayNumber: number,
): Promise<{ currentStreak: number; longestStreak: number }> {
  const playerKey = playerKeyFor(identity);
  if (playerKey == null) {
    // Fully anonymous (session-only) — no identity to attach a
    // streak to. Caller shouldn't hit this path, but zero out
    // defensively instead of crashing.
    return { currentStreak: 0, longestStreak: 0 };
  }
  const profileId = identity.profileId ?? null;
  const wallet = identity.wallet?.toLowerCase() ?? null;

  // Raw SQL read — see "Drizzle wallet-eq drift" in README Code Style.
  // Writes below stay on drizzle's builder since no drift has been
  // observed on that path.
  const existing = await selectStreakRow(playerKey);

  const today = getCurrentDayNumber();

  if (existing == null) {
    // Archive solve as first-ever solve: create a row but don't start
    // a streak (no lastSolvedDayNumber, streak stays at 0).
    if (dayNumber !== today) {
      await db
        .insert(streaks)
        .values({
          profileId,
          wallet,
          currentStreak: 0,
          longestStreak: 0,
          lastSolvedDayNumber: null,
          updatedAt: new Date(),
        })
        .onConflictDoNothing({ target: streaks.playerKey });
      return { currentStreak: 0, longestStreak: 0 };
    }
    await db
      .insert(streaks)
      .values({
        profileId,
        wallet,
        currentStreak: 1,
        longestStreak: 1,
        lastSolvedDayNumber: dayNumber,
        updatedAt: new Date(),
      })
      .onConflictDoNothing({ target: streaks.playerKey });
    // Re-read in the rare case a concurrent request won the insert race.
    const after = await selectStreakRow(playerKey);
    return {
      currentStreak: after?.currentStreak ?? 1,
      longestStreak: after?.longestStreak ?? 1,
    };
  }

  const row = existing;
  const last = row.lastSolvedDayNumber;

  // Archive solves (any day that isn't today) never affect streak state.
  // Without this guard, solving an archive puzzle between lastSolved and
  // today would incorrectly break or extend the streak.
  if (dayNumber !== today) {
    return {
      currentStreak: row.currentStreak,
      longestStreak: row.longestStreak,
    };
  }

  let nextCurrent: number;
  if (last == null) {
    nextCurrent = 1;
  } else if (dayNumber === last) {
    // Same-day re-solve: keep state as-is, don't bump the streak.
    return {
      currentStreak: row.currentStreak,
      longestStreak: row.longestStreak,
    };
  } else if (dayNumber === last + 1) {
    nextCurrent = row.currentStreak + 1;
  } else {
    // Missed at least one day — streak breaks and restarts at 1.
    nextCurrent = 1;
  }

  const nextLongest = Math.max(row.longestStreak, nextCurrent);

  // Optimistic concurrency: include lastSolvedDayNumber in the WHERE
  // so a concurrent request that updated between our SELECT and this
  // UPDATE causes 0 affected rows instead of silently clobbering.
  // The neon-http driver doesn't support interactive transactions, so
  // this is the atomicity primitive we have.
  const updated = await db
    .update(streaks)
    .set({
      currentStreak: nextCurrent,
      longestStreak: nextLongest,
      lastSolvedDayNumber: dayNumber,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(streaks.playerKey, playerKey),
        last == null
          ? isNull(streaks.lastSolvedDayNumber)
          : eq(streaks.lastSolvedDayNumber, last),
      ),
    )
    .returning({
      currentStreak: streaks.currentStreak,
      longestStreak: streaks.longestStreak,
    });

  if (updated.length > 0) {
    return updated[0];
  }

  // Concurrent update won the race — re-read the winner's state.
  const reread = await selectStreakRow(playerKey);
  return {
    currentStreak: reread?.currentStreak ?? nextCurrent,
    longestStreak: reread?.longestStreak ?? nextLongest,
  };
}

/**
 * Internal helper — raw SQL SELECT of a streaks row by player_key.
 * Exists only so the three reads inside `updateStreakForSolve` (and
 * the stats helper above) share a drift-proof code path without
 * duplicating the raw SQL three times. See "Drizzle wallet-eq drift"
 * in README Code Style — the same pattern that bit us on wallet has
 * been observed here too on dynamic routes.
 */
async function selectStreakRow(playerKey: string): Promise<{
  currentStreak: number;
  longestStreak: number;
  lastSolvedDayNumber: number | null;
  updatedAt: Date;
} | null> {
  const result = await db.execute<{
    currentStreak: number;
    longestStreak: number;
    lastSolvedDayNumber: number | null;
    updatedAt: Date | string;
  }>(sql`
    SELECT
      current_streak         AS "currentStreak",
      longest_streak         AS "longestStreak",
      last_solved_day_number AS "lastSolvedDayNumber",
      updated_at             AS "updatedAt"
    FROM streaks
    WHERE player_key = ${playerKey}
    LIMIT 1
  `);
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    currentStreak: r.currentStreak,
    longestStreak: r.longestStreak,
    lastSolvedDayNumber: r.lastSolvedDayNumber,
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt : new Date(r.updatedAt),
  };
}

/**
 * Count of lifetime eligible solves for a player. Used by
 * awardWordmarks to decide Fledgling (1st) and Goldfinch (100th).
 * Includes the just-inserted row since this is called post-insert.
 *
 * Identity-aware so handle-only users (no wallet) still get their
 * milestones. Prefers profile_id matching with a wallet fallback —
 * same rule as solveBelongsTo but embedded inline because we want a
 * single scalar count, not the predicate.
 */
export async function getLifetimeSolveCount(
  identity: StatsIdentity,
): Promise<number> {
  const profileId = identity.profileId ?? null;
  const wallet = identity.wallet?.toLowerCase() ?? null;
  if (profileId == null && wallet == null) return 0;

  // Raw SQL — see "Drizzle wallet-eq drift" in README Code Style. This
  // result feeds Fledgling / Goldfinch awarding, so a drift-induced
  // undercount would deny legitimate milestones.
  //
  // COUNT(DISTINCT puzzle_id) prevents inflated Goldfinch progress
  // when a user re-solves the same puzzle (refresh → re-submit). The
  // solves table has no unique constraint on (wallet, puzzle_id), so
  // duplicate rows are expected. Without DISTINCT, re-solves would
  // accumulate toward the 100-puzzle threshold.
  //
  // Match on profile_id OR wallet so a player's pre-wallet and
  // post-wallet rows both count toward the same milestone. No
  // double-counting because DISTINCT puzzle_id collapses any
  // duplication across identity paths.
  const result = await db.execute<{ count: number }>(sql`
    SELECT COUNT(DISTINCT puzzle_id)::int AS count
    FROM solves
    WHERE solved = true
      AND (flag IS NULL OR flag = 'suspicious')
      AND (
        ${profileId != null ? sql`profile_id = ${profileId}` : sql`false`}
        OR ${wallet != null ? sql`wallet = ${wallet}` : sql`false`}
      )
  `);
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  return rows[0]?.count ?? 0;
}

/**
 * First successful solve by this identity for this puzzle, or null.
 * Used by POST /api/solve to enforce first-solve-wins — a user who
 * has already cracked the puzzle sees their original time, not the
 * time of any replay attempt.
 *
 * Matches on profile_id OR wallet (lowercased), mirroring
 * solveBelongsTo but scoped to a single puzzle and always filtered
 * to solved=true. Session-only anonymous rows are not covered
 * because they carry no cross-device identity to dedupe against —
 * the caller must gate on (profileId || wallet) before invoking.
 */
export async function getFirstSuccessfulSolveForPuzzle(
  identity: StatsIdentity,
  puzzleId: number,
): Promise<{
  serverSolveMs: number | null;
  flag: 'ineligible' | 'suspicious' | null;
} | null> {
  const profileId = identity.profileId ?? null;
  const wallet = identity.wallet?.toLowerCase() ?? null;
  if (profileId == null && wallet == null) return null;

  const result = await db.execute<{
    server_solve_ms: number | null;
    flag: 'ineligible' | 'suspicious' | null;
  }>(sql`
    SELECT server_solve_ms, flag
    FROM solves
    WHERE puzzle_id = ${puzzleId}
      AND solved = true
      AND (
        ${profileId != null ? sql`profile_id = ${profileId}` : sql`false`}
        OR ${wallet != null ? sql`wallet = ${wallet}` : sql`false`}
      )
    ORDER BY created_at ASC
    LIMIT 1
  `);
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  if (rows.length === 0) return null;
  return {
    serverSolveMs: rows[0].server_solve_ms,
    flag: rows[0].flag,
  };
}

/**
 * Earliest successful-solve duration for this (identity, puzzle)
 * combination, or null if the caller hasn't solved it yet. Unlike
 * `getFirstSuccessfulSolveForPuzzle`, this matches on profile_id OR
 * wallet OR session_id (via `solveBelongsTo`) — so an anonymous
 * session's prior solve is still detected on refresh.
 *
 * Used by SSR to hydrate the post-solve UI state (frozen timer, crumb
 * lock) on page load. Without this, a refreshed already-solved page
 * would render the timer ticking from the original `started_at` (so
 * a minutes-old start looks like a live-but-very-slow attempt) and
 * the crumb detector would be armed, letting the player "discover"
 * words they'd already banked.
 */
export async function getPreviousSolveMsForPuzzle(
  identity: StatsIdentity,
  puzzleId: number,
): Promise<number | null> {
  const rows = await db
    .select({ ms: solves.serverSolveMs })
    .from(solves)
    .where(
      and(
        eq(solves.puzzleId, puzzleId),
        eq(solves.solved, true),
        isNotNull(solves.serverSolveMs),
        solveBelongsTo(identity),
      ),
    )
    .orderBy(asc(solves.createdAt))
    .limit(1);
  return rows.length > 0 && rows[0].ms != null ? Number(rows[0].ms) : null;
}

// ─── Premium Stats ─────────────────────────────────────────────────

export interface PremiumStats {
  /** Last 30 eligible solves for this wallet, one point per puzzle, oldest first. */
  solveTrend: { dayNumber: number; serverSolveMs: number }[];
  /** Last 7 puzzle days; serverSolveMs is null for days the user didn't solve. */
  last7Days: { dayNumber: number; date: string; serverSolveMs: number | null }[];
  /**
   * Today's percentile: 0–100, where 88 means "faster than 88% of the
   * field". Null when the user hasn't solved today (or when they're the
   * only solver; the UI handles both by showing a CTA / alternate copy).
   */
  percentileRank: number | null;
  /** Career podium / top-10 counts using the same same-day policy as the leaderboard. */
  placements: {
    first: number;
    second: number;
    third: number;
    /** Includes 1st/2nd/3rd. */
    topTen: number;
  };
}

/**
 * Aggregate stat bundle feeding the premium stats dashboard. Four reads
 * in parallel:
 *
 *   1. solveTrend     — DISTINCT ON (day_number) so a wallet with
 *                       multiple solves per puzzle contributes once,
 *                       keyed on fastest time.
 *   2. last7Days      — left-joined against the puzzles table so days
 *                       with no user solve still appear (as null) and
 *                       the bar chart can render gap placeholders.
 *   3. percentileRank — computed from today's leaderboard: rank among
 *                       eligible wallets by best server_solve_ms,
 *                       inverted to a "faster than %" number.
 *   4. placements     — single window-function CTE over the full
 *                       eligible solve history. Scales with the
 *                       `solves(puzzle_id, server_solve_ms)` index
 *                       added in PR #53.
 *
 * Every read applies the same eligibility filter as the public
 * leaderboard: solved + wallet + server_solve_ms + (flag null | flag =
 * 'suspicious') + same-day-as-puzzle-date. Using different rules here
 * would let the stats dashboard diverge from the leaderboard, which
 * is exactly the kind of drift users notice and distrust.
 */
export async function getPremiumStats(identity: StatsIdentity): Promise<PremiumStats> {
  const today = getCurrentDayNumber();

  // Synthetic "player key" used to group today's/all-time solves when
  // computing percentile + placements. profile_id is preferred over
  // wallet so a single user's pre-wallet and post-wallet solves share
  // the same key — without this preference, a handle-only user who
  // later linked a wallet would have their history split between
  // `p:<profile_id>` and `<wallet>` keys and the ranked queries would
  // silently drop the pre-wallet half.
  //
  // Wallet-only users (no profile) fall back to wallet. Anonymous
  // session-only rows (no wallet, no profile_id) are excluded from
  // ranked queries — they belong to no identifiable player.
  const callerKey =
    identity.profileId != null
      ? `p:${identity.profileId}`
      : (identity.wallet?.toLowerCase() ?? null);

  const identityMatches = solveBelongsTo(identity);

  const [trendRows, weekRows, percentileRows, placementRows] = await Promise.all([
    // 1. solveTrend — last 30 puzzles this player has solved, fastest
    //    per puzzle, oldest first. DISTINCT ON + matching ORDER BY
    //    lets PG use an index walk to pick the fastest per puzzle.
    //
    //    NOTE: no `s` alias on solves here. `solveBelongsTo` renders
    //    Drizzle column references as "solves"."col"; aliasing the
    //    FROM clause would hide the real name and error at runtime
    //    ("invalid reference to FROM-clause entry for table \"solves\"").
    db.execute<{ day_number: number; server_solve_ms: number }>(sql`
      WITH per_puzzle AS (
        SELECT DISTINCT ON (p.day_number)
          p.day_number, solves.server_solve_ms
        FROM solves
        JOIN puzzles p ON p.id = solves.puzzle_id
        WHERE ${identityMatches}
          AND solves.solved = true
          AND (solves.flag IS NULL OR solves.flag = 'suspicious')
          AND solves.server_solve_ms IS NOT NULL
          AND solves.created_at::date = p.date::date
        ORDER BY p.day_number DESC, solves.server_solve_ms ASC
        LIMIT 30
      )
      SELECT day_number, server_solve_ms FROM per_puzzle ORDER BY day_number ASC
    `),

    // 2. last7Days — every day in the trailing 7 appears exactly once,
    //    null server_solve_ms signals a gap for the bar chart. Same
    //    no-alias-on-solves rule as solveTrend so `identityMatches`
    //    (which renders "solves"."col") resolves correctly.
    db.execute<{
      day_number: number;
      date: string;
      server_solve_ms: number | null;
    }>(sql`
      SELECT
        p.day_number,
        p.date::text AS date,
        MIN(CASE
          WHEN solves.solved = true
            AND (solves.flag IS NULL OR solves.flag = 'suspicious')
            AND solves.server_solve_ms IS NOT NULL
            AND solves.created_at::date = p.date::date
          THEN solves.server_solve_ms
        END)::int AS server_solve_ms
      FROM puzzles p
      LEFT JOIN solves
        ON solves.puzzle_id = p.id
        AND ${identityMatches}
      WHERE p.day_number > ${today - 7} AND p.day_number <= ${today}
      GROUP BY p.day_number, p.date
      ORDER BY p.day_number ASC
    `),

    // 3. percentileRank — caller's best vs total field, grouped by
    //    the synthetic player_key so wallet + profile-only players are
    //    ranked side by side. EXISTS guard avoids the `best_ms < NULL`
    //    false-rank-1 trap for non-solvers (see PR #54's Bugbot fix).
    callerKey == null
      ? Promise.resolve([{ rank: null, total: 0 }])
      : db.execute<{ rank: number | null; total: number }>(sql`
        WITH today_eligible AS (
          SELECT
            COALESCE('p:' || s.profile_id::text, s.wallet) AS player_key,
            MIN(s.server_solve_ms) AS best_ms
          FROM solves s
          JOIN puzzles p ON p.id = s.puzzle_id
          WHERE p.day_number = ${today}
            AND s.solved = true
            AND (s.flag IS NULL OR s.flag = 'suspicious')
            AND (s.wallet IS NOT NULL OR s.profile_id IS NOT NULL)
            AND s.server_solve_ms IS NOT NULL
            AND s.created_at::date = p.date::date
          GROUP BY player_key
        )
        SELECT
          CASE
            WHEN EXISTS (SELECT 1 FROM today_eligible WHERE player_key = ${callerKey}) THEN
              (SELECT count(*) + 1 FROM today_eligible
                WHERE best_ms < (SELECT best_ms FROM today_eligible WHERE player_key = ${callerKey}))::int
            ELSE NULL
          END AS rank,
          (SELECT count(*) FROM today_eligible)::int AS total
      `),

    // 4. placements — window-function RANK over all eligible solves
    //    gives every player_key a rank per puzzle in a single scan.
    //    FILTER counts collapse to the four numbers we need.
    callerKey == null
      ? Promise.resolve([{ first: 0, second: 0, third: 0, top_ten: 0 }])
      : db.execute<{ first: number; second: number; third: number; top_ten: number }>(sql`
        WITH eligible AS (
          SELECT
            s.puzzle_id,
            COALESCE('p:' || s.profile_id::text, s.wallet) AS player_key,
            MIN(s.server_solve_ms) AS best_ms
          FROM solves s
          JOIN puzzles p ON p.id = s.puzzle_id
          WHERE s.solved = true
            AND (s.flag IS NULL OR s.flag = 'suspicious')
            AND (s.wallet IS NOT NULL OR s.profile_id IS NOT NULL)
            AND s.server_solve_ms IS NOT NULL
            AND s.created_at::date = p.date::date
          GROUP BY s.puzzle_id, player_key
        ),
        ranked AS (
          SELECT puzzle_id, player_key,
                 RANK() OVER (PARTITION BY puzzle_id ORDER BY best_ms ASC) AS rnk
          FROM eligible
        )
        SELECT
          COUNT(*) FILTER (WHERE rnk = 1)::int  AS first,
          COUNT(*) FILTER (WHERE rnk = 2)::int  AS second,
          COUNT(*) FILTER (WHERE rnk = 3)::int  AS third,
          COUNT(*) FILTER (WHERE rnk <= 10)::int AS top_ten
        FROM ranked
        WHERE player_key = ${callerKey}
      `),
  ]);

  const trend = (Array.isArray(trendRows) ? trendRows : trendRows.rows) ?? [];
  const week = (Array.isArray(weekRows) ? weekRows : weekRows.rows) ?? [];
  const percentile = (Array.isArray(percentileRows) ? percentileRows : percentileRows.rows) ?? [];
  const placements = (Array.isArray(placementRows) ? placementRows : placementRows.rows) ?? [];

  const { rank, total } = percentile[0] ?? { rank: null, total: 0 };
  let percentileRank: number | null = null;
  if (rank != null && total > 0) {
    // "Faster than X%": (field-behind-you / total) * 100. The
    // subtraction by rank gives the count of wallets slower-or-equal;
    // clamping to [0, 100] keeps the value sane when rank > total (a
    // race between today_eligible and wallet could technically produce
    // this mid-query, though the CTE makes it impossible in practice).
    percentileRank = Math.max(0, Math.min(100, Math.round(((total - rank) / total) * 100)));
  }

  const p = placements[0] ?? { first: 0, second: 0, third: 0, top_ten: 0 };

  return {
    solveTrend: trend.map((r) => ({
      dayNumber: Number(r.day_number),
      serverSolveMs: Number(r.server_solve_ms),
    })),
    last7Days: week.map((r) => ({
      dayNumber: Number(r.day_number),
      date: String(r.date),
      serverSolveMs: r.server_solve_ms == null ? null : Number(r.server_solve_ms),
    })),
    percentileRank,
    placements: {
      first: Number(p.first ?? 0),
      second: Number(p.second ?? 0),
      third: Number(p.third ?? 0),
      topTen: Number(p.top_ten ?? 0),
    },
  };
}

// ─── Puzzle Crumbs ─────────────────────────────────────────────────

/**
 * Fetch all crumbs a session has found on a given puzzle, oldest first.
 * Returns the raw word strings — the caller (API route or hook) owns
 * the response shape.
 */
export async function getCrumbsForSession(
  sessionId: string,
  puzzleId: number,
): Promise<string[]> {
  const rows = await db
    .select({ word: puzzleCrumbs.word })
    .from(puzzleCrumbs)
    .where(
      and(
        eq(puzzleCrumbs.sessionId, sessionId),
        eq(puzzleCrumbs.puzzleId, puzzleId),
      ),
    )
    .orderBy(asc(puzzleCrumbs.foundAt));
  return rows.map((r) => r.word);
}

/**
 * Persist a newly discovered crumb. Idempotent — the unique index on
 * (session_id, puzzle_id, word) means a duplicate insert is a silent
 * no-op via ON CONFLICT DO NOTHING.
 *
 * Returns `true` if the row was inserted (new crumb), `false` if it
 * already existed.
 */
export async function saveCrumb(
  sessionId: string,
  puzzleId: number,
  word: string,
  wallet: string | null,
): Promise<boolean> {
  const result = await db
    .insert(puzzleCrumbs)
    .values({
      sessionId,
      puzzleId,
      word: word.toLowerCase(),
      wallet: wallet?.toLowerCase() ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: puzzleCrumbs.id });
  return result.length > 0;
}
