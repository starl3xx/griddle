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
} from './schema';
import { getCurrentDayNumber } from '@/lib/scheduler';
import { secondsUntilUtcMidnight } from '@/lib/format';
import { kv } from '@/lib/kv';
import { slugifyUsername, validateUsername } from '@/lib/username';

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
  wallet: string;
  serverSolveMs: number;
  unassisted: boolean;
}

/**
 * Top N solvers for a given day. Filters:
 *   - solved = true (no failed attempts)
 *   - flag is NULL or 'suspicious' (only 'ineligible' is excluded)
 *   - wallet IS NOT NULL (no anonymous solves on the leaderboard)
 *   - same-day only: solve created_at matches the puzzle date (archive
 *     solves don't qualify for leaderboard placement)
 *
 * Each wallet appears once with their fastest serverSolveMs. Drizzle
 * `selectDistinctOn` would be cleaner but isn't available across all
 * dialects we care about, so we use a raw window function over the
 * result. For ~100 row leaderboards this is fast enough that the
 * extra complexity isn't worth optimizing.
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

  // Pull all eligible solves for the puzzle, sorted by speed. Walk the
  // result once and keep the first occurrence per wallet  -  that's their
  // fastest. For a real puzzle this is at most ~hundreds of rows; for
  // viral days we can swap to DISTINCT ON later.
  const rows = await db
    .select({
      wallet: solves.wallet,
      serverSolveMs: solves.serverSolveMs,
      unassisted: solves.unassisted,
    })
    .from(solves)
    .where(
      and(
        eq(solves.puzzleId, puzzleId),
        eq(solves.solved, true),
        // Only 'ineligible' is excluded — 'suspicious' is an internal
        // flag for admin review, not a leaderboard ban.
        sql`(${solves.flag} IS NULL OR ${solves.flag} = 'suspicious')`,
        isNotNull(solves.wallet),
        isNotNull(solves.serverSolveMs),
        // Same-day filter: only solves submitted on the puzzle's date
        // qualify for leaderboard placement. Archive/late solves are
        // excluded so retroactive play can't inflate past leaderboards.
        sql`${solves.createdAt}::date = ${puzzleDate}::date`,
      ),
    )
    .orderBy(asc(solves.serverSolveMs));

  const seen = new Set<string>();
  const result: LeaderboardEntry[] = [];
  for (const row of rows) {
    if (!row.wallet || row.serverSolveMs == null) continue;
    if (seen.has(row.wallet)) continue;
    seen.add(row.wallet);
    result.push({
      rank: result.length + 1,
      wallet: row.wallet,
      serverSolveMs: row.serverSolveMs,
      unassisted: row.unassisted,
    });
    if (result.length >= limit) break;
  }
  return result;
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
 * Per-wallet aggregate stats for the Stats modal. All derived from
 * `solves` + `streaks`, filtered to eligible rows (solved=true, no
 * ineligible/suspicious flag). A wallet with zero qualifying rows
 * returns zero-valued fields rather than null so the UI can render
 * the modal without branching on undefined fields.
 */
export interface WalletStats {
  totalSolves: number;
  unassistedSolves: number;
  fastestMs: number | null;
  averageMs: number | null;
  currentStreak: number;
  longestStreak: number;
}

export async function getWalletStats(wallet: string): Promise<WalletStats> {
  const normalized = wallet.toLowerCase();

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
        eq(solves.wallet, normalized),
        eq(solves.solved, true),
        isNull(solves.flag),
        isNotNull(solves.serverSolveMs),
      ),
    );

  const [streakRow] = await db
    .select({
      currentStreak: streaks.currentStreak,
      longestStreak: streaks.longestStreak,
    })
    .from(streaks)
    .where(eq(streaks.wallet, normalized))
    .limit(1);

  return {
    totalSolves: agg?.totalSolves ?? 0,
    unassistedSolves: agg?.unassistedSolves ?? 0,
    fastestMs: agg?.fastestMs ?? null,
    averageMs: agg?.averageMs ?? null,
    currentStreak: streakRow?.currentStreak ?? 0,
    longestStreak: streakRow?.longestStreak ?? 0,
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
 * Player profile queries  -  scaffolding for the inclusive leaderboard in
 * M4f. A profile is identified by a wallet, a handle, or both; the UI
 * renders `handle` when set and falls back to a truncated wallet.
 *
 * These helpers are safe to call before M4f's UI ships  -  nothing in the
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
 * Lookup by wallet address. Normalized to lowercase before the query so
 * mixed-case input (e.g. the checksummed form from wagmi) hits the same
 * row as the lowercased form stored on write.
 */
export async function getProfileByWallet(wallet: string): Promise<ProfileRow | null> {
  const normalized = wallet.toLowerCase();
  const rows = await db
    .select()
    .from(profiles)
    .where(eq(profiles.wallet, normalized))
    .limit(1);
  return rows.length === 0 ? null : toProfileRow(rows[0]);
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
 * on that function for why the merge itself is deferred to M4f.
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
  // the case and throw an explicit `MergeConflictError`. M4f will add
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
 *     path (wiring up in M4f). For now this creates the profile row so
 *     the grant is recorded even before the M4f check-path lands.
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
  // effective when M4f wires the leaderboard/premium reads through
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
 *   - `profiles`  -  grant-by-handle path (no wallet, M4f-facing)
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
 * Record a paid premium unlock from the crypto path (direct permit-burn).
 * Called by `/api/premium/verify` after the server independently confirms
 * the `UnlockedWithBurn` event on the GriddlePremium contract. Idempotent
 * on wallet  -  a replayed verify re-runs the same upsert with the same
 * txHash and ends up at identical state.
 */
export async function recordCryptoUnlock(
  wallet: string,
  txHash: string,
): Promise<void> {
  const normalized = wallet.toLowerCase();
  await db
    .insert(premiumUsers)
    .values({
      wallet: normalized,
      txHash,
      source: 'crypto',
      grantedBy: null,
      reason: null,
      stripeSessionId: null,
    })
    .onConflictDoUpdate({
      target: premiumUsers.wallet,
      set: {
        txHash,
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
 * Fetch the loaded_at timestamp for a (session, puzzle) pair. Returns
 * null if the session never called /api/puzzle/today for this puzzle
 * before submitting a solve.
 *
 * NOT cached: per-session, per-puzzle, low cache-hit-rate. Direct DB read.
 */
export async function getPuzzleLoadedAt(
  sessionId: string,
  dayNumber: number,
): Promise<Date | null> {
  const rows = await db
    .select({ loadedAt: puzzleLoads.loadedAt })
    .from(puzzleLoads)
    .innerJoin(puzzles, eq(puzzleLoads.puzzleId, puzzles.id))
    .where(and(eq(puzzleLoads.sessionId, sessionId), eq(puzzles.dayNumber, dayNumber)))
    .limit(1);
  if (rows.length === 0) return null;
  return new Date(rows[0].loadedAt);
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
      FROM pair
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

  const [byFid, byWallet] = await Promise.all([
    db.select().from(profiles)
      .where(eq(profiles.farcasterFid, input.fid)).limit(1),
    wallet ? db.select().from(profiles)
      .where(eq(profiles.wallet, wallet)).limit(1)
      : Promise.resolve([] as typeof profiles.$inferSelect[]),
  ]);

  const fidRow  = byFid[0]   ?? null;
  const walletRow = byWallet[0] ?? null;

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
          ? (await db.select().from(profiles).where(eq(profiles.wallet, wallet)).limit(1))[0]
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

export async function getUserSettings(wallet: string): Promise<UserSettingsRow | null> {
  const rows = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.wallet, wallet.toLowerCase()))
    .limit(1);
  if (rows.length === 0) return null;
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
  wallet: string,
  wordmarkIds: readonly string[],
  puzzleId: number | null,
): Promise<string[]> {
  if (wordmarkIds.length === 0) return [];
  const normalized = wallet.toLowerCase();
  const rows = wordmarkIds.map((id) => ({
    wallet: normalized,
    wordmarkId: id,
    puzzleId,
  }));
  const inserted = await db
    .insert(wordmarks)
    .values(rows)
    .onConflictDoNothing({
      target: [wordmarks.wallet, wordmarks.wordmarkId],
    })
    .returning({ wordmarkId: wordmarks.wordmarkId });
  return inserted.map((r) => r.wordmarkId);
}

/**
 * Fetch all wordmarks earned by a wallet, newest first. Used by the
 * Lexicon grid on the Stats panel.
 */
export async function getWordmarksForWallet(
  wallet: string,
): Promise<EarnedWordmarkRow[]> {
  const normalized = wallet.toLowerCase();
  const rows = await db
    .select({
      wordmarkId: wordmarks.wordmarkId,
      earnedAt: wordmarks.earnedAt,
      puzzleId: wordmarks.puzzleId,
    })
    .from(wordmarks)
    .where(eq(wordmarks.wallet, normalized))
    .orderBy(sql`${wordmarks.earnedAt} DESC`);
  return rows.map((r) => ({
    wordmarkId: r.wordmarkId,
    earnedAt: r.earnedAt,
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
 * This is the first write path for the `streaks` table — prior to M5j
 * the table was read-only from the admin-seeded side, which meant
 * Fireproof / Steadfast / Centurion never had a chance to fire. Now
 * that solves drive streak state, those three wordmarks become
 * earnable.
 *
 * Returns the post-update `currentStreak` so the caller can feed it
 * into awardWordmarks without a follow-up SELECT.
 */
export async function updateStreakForSolve(
  wallet: string,
  dayNumber: number,
): Promise<{ currentStreak: number; longestStreak: number }> {
  const normalized = wallet.toLowerCase();

  const existing = await db
    .select()
    .from(streaks)
    .where(eq(streaks.wallet, normalized))
    .limit(1);

  if (existing.length === 0) {
    await db
      .insert(streaks)
      .values({
        wallet: normalized,
        currentStreak: 1,
        longestStreak: 1,
        lastSolvedDayNumber: dayNumber,
        updatedAt: new Date(),
      })
      .onConflictDoNothing({ target: streaks.wallet });
    // Re-read in the rare case a concurrent request won the insert race.
    const after = await db
      .select()
      .from(streaks)
      .where(eq(streaks.wallet, normalized))
      .limit(1);
    const row = after[0];
    return {
      currentStreak: row?.currentStreak ?? 1,
      longestStreak: row?.longestStreak ?? 1,
    };
  }

  const row = existing[0];
  const last = row.lastSolvedDayNumber;
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
  } else if (dayNumber > last + 1) {
    // Missed at least one day — streak breaks and restarts at 1.
    nextCurrent = 1;
  } else {
    // Solve for a PAST puzzle (archive). Doesn't change the current
    // streak trajectory; just record that it happened and leave the
    // streak state untouched.
    return {
      currentStreak: row.currentStreak,
      longestStreak: row.longestStreak,
    };
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
        eq(streaks.wallet, normalized),
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
  const reread = await db
    .select()
    .from(streaks)
    .where(eq(streaks.wallet, normalized))
    .limit(1);
  return {
    currentStreak: reread[0]?.currentStreak ?? nextCurrent,
    longestStreak: reread[0]?.longestStreak ?? nextLongest,
  };
}

/**
 * Count of lifetime eligible solves for a wallet. Used by
 * awardWordmarks to decide Fledgling (1st) and Goldfinch (100th).
 * Includes the just-inserted row since this is called post-insert.
 */
export async function getLifetimeSolveCount(wallet: string): Promise<number> {
  const normalized = wallet.toLowerCase();
  // COUNT(DISTINCT puzzle_id) to prevent inflated Goldfinch progress
  // when a user re-solves the same puzzle (refresh → re-submit). The
  // solves table has no unique constraint on (wallet, puzzle_id), so
  // duplicate rows are expected. Without DISTINCT, re-solves would
  // accumulate toward the 100-puzzle threshold.
  const rows = await db
    .select({ count: sql<number>`count(DISTINCT ${solves.puzzleId})::int` })
    .from(solves)
    .where(
      and(
        eq(solves.wallet, normalized),
        eq(solves.solved, true),
        isNull(solves.flag),
      ),
    );
  return rows[0]?.count ?? 0;
}
