import { and, asc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from './client';
import {
  puzzles,
  puzzleLoads,
  solves,
  streaks,
  premiumUsers,
  profiles,
} from './schema';
import { getCurrentDayNumber } from '@/lib/scheduler';
import { secondsUntilUtcMidnight } from '@/lib/format';
import { kv } from '@/lib/kv';

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
 * the answer to a public surface — `getTodayPuzzle()` only ever reads
 * from the public key. Same type-level guarantee that the original
 * non-cached version had.
 */

/** Public puzzle payload — sent to the client. NEVER includes the word. */
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

/** Server-only payload — used by /api/solve to verify the claim. */
interface PuzzleAnswer {
  id: number;
  word: string;
}

const PUBLIC_KEY = (dayNumber: number) => `griddle:puzzle:public:${dayNumber}`;
const ANSWER_KEY = (dayNumber: number) => `griddle:puzzle:answer:${dayNumber}`;

/**
 * Cache-safe wrappers around Upstash. Every kv.get / kv.set call goes
 * through these so a transient Upstash failure (network blip, rate
 * limit, brief outage) never breaks the request — we just log and fall
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
  const dayNumber = getCurrentDayNumber();

  const cached = await safeKvGet<TodayPuzzlePayload>(PUBLIC_KEY(dayNumber));
  if (cached) return cached;

  const row = await refreshCacheForDay(dayNumber);
  return row ? toPublicPayload(row) : null;
}

/**
 * Fetch the puzzle answer word by dayNumber. Only used from solve
 * verification — never call this from any code path that touches the
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
 * `getPuzzleWordByDayNumber` on a miss — whichever fires first warms
 * the cache for the other.
 *
 * TTL is `secondsUntilUtcMidnight()` so the cached row expires exactly
 * when the daily puzzle rolls over. Avoids serving yesterday’s puzzle
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

  // TTL must be ≥ 1 — Upstash rejects 0. If we’re within the same
  // second as midnight, fall back to a 60-second TTL.
  const ttl = Math.max(60, secondsUntilUtcMidnight());

  // Two cache keys, populated in parallel via safeKvSet so a transient
  // Upstash failure can never block returning the freshly-fetched row.
  // Public key intentionally omits the word — type-level word stripping
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
 * `ON CONFLICT DO NOTHING` — later loads of the same puzzle by the same
 * session keep the earliest `loaded_at`, which is the correct start
 * time for `server_solve_ms`.
 *
 * NOT cached: this is a write-only path and each row is per-session,
 * so there’s no shared row to cache.
 */
export async function recordPuzzleLoad(sessionId: string, puzzleId: number): Promise<void> {
  await db
    .insert(puzzleLoads)
    .values({ sessionId, puzzleId })
    .onConflictDoNothing({ target: [puzzleLoads.sessionId, puzzleLoads.puzzleId] });
}

/**
 * Daily leaderboard row — one wallet, their fastest legitimate solve.
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
 *   - flag IS NULL (no ineligible/suspicious — anti-bot drops them)
 *   - wallet IS NOT NULL (no anonymous solves on the leaderboard)
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
    .select({ id: puzzles.id })
    .from(puzzles)
    .where(eq(puzzles.dayNumber, dayNumber))
    .limit(1);
  if (puzzleRows.length === 0) return [];
  const puzzleId = puzzleRows[0].id;

  // Pull all eligible solves for the puzzle, sorted by speed. Walk the
  // result once and keep the first occurrence per wallet — that's their
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
        isNull(solves.flag),
        isNotNull(solves.wallet),
        isNotNull(solves.serverSolveMs),
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
    })
    .from(solves)
    .where(isNotNull(solves.flag))
    .orderBy(sql`${solves.createdAt} DESC`)
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    flag: r.flag as 'ineligible' | 'suspicious',
  }));
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
 * Admin Pulse aggregate — one-shot snapshot feeding the Pulse tab on
 * the admin dashboard. Five headline numbers, each with enough context
 * for a one-glance health read. Kept cheap: every query is indexed on
 * `created_at` or `puzzle_id` + `wallet`, and the 24h/7d windows are
 * small constant-bound scans on recent rows.
 *
 * NOT cached — the admin page is low-traffic by definition, staleness
 * hurts more than latency.
 */
export interface AdminPulse {
  /** Successful solves in the last 24h (no flag filter — includes flagged). */
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
      // Successful solves in the last 24h — includes flagged rows. This
      // is the denominator for `flaggedRatePct`, so the numerator below
      // MUST also filter on `solved = true` or the ratio skews.
      solves24h: sql<number>`count(*) filter (where ${solves.createdAt} >= now() - interval '1 day' and ${solves.solved} = true)::int`,
      solves7d: sql<number>`count(*) filter (where ${solves.solved} = true)::int`,
      activeWallets7d: sql<number>`count(distinct ${solves.wallet}) filter (where ${solves.wallet} is not null)::int`,
      // Intersection: flagged AND solved=true — matches the denominator.
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
 * Archive listing — past puzzle days (excluding today), newest first.
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
 * Player profile queries — scaffolding for the inclusive leaderboard in
 * M4f. A profile is identified by a wallet, a handle, or both; the UI
 * renders `handle` when set and falls back to a truncated wallet.
 *
 * These helpers are safe to call before M4f's UI ships — nothing in the
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
  createdAt: Date;
  updatedAt: Date;
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
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    wallet: r.wallet,
    handle: r.handle,
    premiumSource: r.premiumSource as ProfileRow['premiumSource'],
    grantedBy: r.grantedBy,
    reason: r.reason,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
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
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    wallet: r.wallet,
    handle: r.handle,
    premiumSource: r.premiumSource as ProfileRow['premiumSource'],
    grantedBy: r.grantedBy,
    reason: r.reason,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Upsert a profile. Used by both premium unlock paths:
 *
 *   - **Crypto**: `upsertProfile({ wallet, premiumSource: 'crypto' })` —
 *     creates or updates the wallet-keyed profile on unlock.
 *   - **Fiat**: `upsertProfile({ handle, premiumSource: 'fiat' })` —
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
 * normalized input that may have been emptied out — `normalizeIdentity`
 * treats `null`, `undefined`, and empty-string the same.
 *
 * The other three fields are `T | undefined` only (not `| null`): the
 * implementation below collapses undefined into "keep existing", and
 * there's no current need for a caller to explicitly clear a
 * `premiumSource` / `grantedBy` / `reason`. Admin grant audit fields
 * in particular are append-only — once recorded, they're part of the
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
 * `handle` entirely — an empty string is never a valid identity, so
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

  if (wallet === null && handle === null) {
    throw new Error('upsertProfile requires at least one of wallet or handle');
  }

  // Look up BOTH identities before deciding what to do. The two unique
  // partial indexes on `profiles` mean we can't catch duplicates via
  // `onConflictDoUpdate` against both columns at once, and we also need
  // to detect the "merge" case — where wallet and handle each already
  // own a different row — before we try to write to either.
  const [byWallet, byHandle] = await Promise.all([
    wallet ? getProfileByWallet(wallet) : Promise.resolve(null),
    handle ? getProfileByHandle(handle) : Promise.resolve(null),
  ]);

  // Merge case: wallet and handle each point at DIFFERENT existing rows.
  // This is the "handle-only fiat profile later connects a wallet that
  // already has a crypto profile" scenario. The cross-row merge needs
  // to atomically DELETE the handle-only row and UPDATE the wallet row
  // to pick up the handle — but the runtime `db` client uses the
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
    });
  }

  // Insert-fresh path with TOCTOU protection. Between the parallel
  // lookup above and this insert, a concurrent `upsertProfile` call
  // with the same wallet/handle could race us to the insert and win
  // — a bare insert would then throw an unhandled unique constraint
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
    .values({ wallet, handle, premiumSource, grantedBy, reason })
    .onConflictDoNothing()
    .returning();

  if (insertedRows.length > 0) {
    const r = insertedRows[0];
    return {
      id: r.id,
      wallet: r.wallet,
      handle: r.handle,
      premiumSource: r.premiumSource as ProfileRow['premiumSource'],
      grantedBy: r.grantedBy,
      reason: r.reason,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  // Race: a concurrent upsert created the row we wanted to insert.
  // Re-query and update in place. We intentionally do NOT recurse
  // into `upsertProfile` — recursion would double the lookup + risk
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
  const updated = updatedRows[0];
  return {
    id: updated.id,
    wallet: updated.wallet,
    handle: updated.handle,
    premiumSource: updated.premiumSource as ProfileRow['premiumSource'],
    grantedBy: updated.grantedBy,
    reason: updated.reason,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };
}

/**
 * Admin premium grant — comp premium to a wallet or a handle with no
 * burn, no tx, no Stripe charge. Used by operators from /admin to
 * resolve support issues, reward contributors, hand out comps for
 * Farcaster giveaways, etc.
 *
 * Two identity modes:
 *   - `{ wallet }` — inserts a `premium_users` row with `source='admin_grant'`,
 *     `txHash=null`, `grantedBy`, and an optional `reason`. The wallet
 *     immediately reads as premium from `/api/premium/[wallet]`.
 *   - `{ handle }` — upserts a `profiles` row with `premium_source='admin_grant'`
 *     and no wallet. The handle becomes premium via the profiles-table
 *     path (wiring up in M4f). For now this creates the profile row so
 *     the grant is recorded even before the M4f check-path lands.
 *
 * Both modes are idempotent: re-granting the same wallet/handle just
 * updates the existing row.
 *
 * Caller is responsible for admin authentication — this function does
 * NOT check the allowlist. The `/api/admin/grant-premium` route guards
 * via `requireAdminWallet()` before calling here.
 */
export interface GrantPremiumInput {
  wallet?: string | null;
  handle?: string | null;
  /** Admin wallet performing the grant — stored for audit. */
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
          // Explicitly null txHash on conflict — if this wallet
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
 *   - `premium_users` — grant-by-wallet path
 *   - `profiles` — grant-by-handle path (no wallet, M4f-facing)
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
