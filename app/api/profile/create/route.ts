import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import { getSessionProfile, setSessionProfileOrThrow } from '@/lib/session-profile';
import { getSessionWallet } from '@/lib/wallet-session';
import { slugifyUsername, validateUsername } from '@/lib/username';
import { isSessionPremium } from '@/lib/premium-check';
import { db } from '@/lib/db/client';
import { profiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * POST /api/profile/create
 *
 * Body: `{ username: string, avatarUrl?: string }`
 *
 * Creates a profile for the current session. Two modes:
 *
 *   1. **Handle-only** — no wallet bound. Profile row has a username
 *      (stored in the `handle` column), no wallet. Bound to the
 *      session via Upstash KV. If the session is lost (new browser,
 *      cleared cookies) the user will need to re-create or add an
 *      email.
 *
 *   2. **Wallet-linked** — session already has a wallet bound (the
 *      user clicked Connect Wallet earlier). Profile row has the
 *      username + WALLET so the "Complete your profile" flow in
 *      SettingsModal produces a full wallet-linked row in one shot,
 *      not an orphan handle-only row that then races with wallet/link's
 *      reconcile.
 *
 * The username is slugified + profanity-checked server-side. The
 * client-side form runs the same `validateUsername` for immediate
 * feedback, but the server is the authoritative gate.
 *
 * Note on the old `displayName` field: the previous two-field design
 * (free-form display name + slugified handle) collapsed into a
 * single "username". For back-compat with older client
 * bundles still mid-deploy, we accept `displayName` as an alias.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AVATAR_URL_RE = /^https?:\/\/[^\s]{1,500}$/;

export async function POST(req: Request): Promise<NextResponse> {
  let body: { username?: string; displayName?: string; avatarUrl?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  // Accept either `username` (new) or `displayName` (old bundle alias).
  const rawUsername = (body.username ?? body.displayName ?? '').trim();
  if (!rawUsername) {
    return NextResponse.json({ error: 'username required' }, { status: 400 });
  }

  // Slugify first, then validate. Slugifying enforces shape; validating
  // enforces the profanity check (slugifier is a coercion helper and
  // explicitly does NOT reject profane input).
  const handle = slugifyUsername(rawUsername);
  const validation = validateUsername(handle);
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.error ?? 'invalid username' },
      { status: 400 },
    );
  }

  // avatarUrl is optional. Accepts string, empty string, null, or
  // absent — all normalize to either a validated URL or null.
  // `typeof` guard is critical because `body.avatarUrl !== undefined`
  // alone would let a JSON `null` fall through to `.trim()` and throw.
  let avatarUrl: string | null = null;
  if (typeof body.avatarUrl === 'string') {
    const trimmed = body.avatarUrl.trim().slice(0, 500);
    if (trimmed) {
      if (!AVATAR_URL_RE.test(trimmed)) {
        return NextResponse.json(
          { error: 'avatarUrl must be a http(s) URL' },
          { status: 400 },
        );
      }
      avatarUrl = trimmed;
    }
  }

  // Upsert: if the session (or wallet) already owns a profile, update
  // it instead of returning 409. This covers the common case where the
  // client's `profile` state is stale (e.g. user opened Settings before
  // the mount refetch resolved) and the "Complete profile" form sends a
  // POST even though the profile already exists server-side.
  const sessionId = await getSessionId();
  const existingFromProfile = await getSessionProfile(sessionId);
  const sessionWallet = await getSessionWallet(sessionId);

  let existingId: number | null = existingFromProfile;
  if (existingId === null && sessionWallet) {
    const walletRows = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.wallet, sessionWallet))
      .limit(1);
    if (walletRows.length > 0) existingId = walletRows[0].id;
  }

  if (existingId !== null) {
    // Profile exists — update handle + avatar instead of rejecting.
    // Only update columns the user actually supplied so we don't
    // accidentally blank fields the Farcaster sync set earlier.
    //
    // Premium gate: if the profile already has a handle and the new
    // handle differs, this is a rename → require Premium. Mirrors
    // the PATCH /api/profile gate. Initial sets (null → value) are
    // allowed for free users.
    const currentRows = await db
      .select({ handle: profiles.handle })
      .from(profiles)
      .where(eq(profiles.id, existingId))
      .limit(1);
    const currentHandle = currentRows[0]?.handle;
    if (currentHandle && currentHandle !== handle) {
      const premium = await isSessionPremium(sessionId);
      if (!premium) {
        return NextResponse.json(
          { error: 'Changing your username is a Premium feature.' },
          { status: 402 },
        );
      }
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    patch.handle = handle;
    if (avatarUrl !== null) {
      patch.avatarUrl = avatarUrl;
      patch.avatarSource = 'custom';
    }
    try {
      const rows = await db
        .update(profiles)
        .set(patch)
        .where(eq(profiles.id, existingId))
        .returning({ id: profiles.id, handle: profiles.handle });
      // Ensure session-profile binding exists (it may be missing if the
      // profile was found via wallet fallback).
      if (existingFromProfile === null) {
        await setSessionProfileOrThrow(sessionId, existingId);
      }
      return NextResponse.json({
        profileId: rows[0]?.id ?? existingId,
        handle: rows[0]?.handle ?? handle,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('profiles_handle_lower_idx') || msg.includes('23505')) {
        return NextResponse.json({ error: 'That username is taken.' }, { status: 409 });
      }
      throw err;
    }
  }

  // Shared insert payload. avatarSource is 'custom' on any non-null
  // avatar to shield from future Farcaster sync overwrites.
  const baseValues = {
    handle,
    avatarUrl,
    avatarSource: avatarUrl ? 'custom' : null,
    wallet: sessionWallet,
    updatedAt: new Date(),
  };

  // Try the slugified handle first. If onConflictDoNothing returns
  // empty, the insert raced a unique-index conflict on EITHER handle
  // OR wallet. Differentiate by post-insert state.
  let profileId: number;
  const firstTry = await db
    .insert(profiles)
    .values(baseValues)
    .onConflictDoNothing()
    .returning({ id: profiles.id });

  if (firstTry.length > 0) {
    profileId = firstTry[0].id;
  } else {
    // Was the conflict on wallet? Re-check.
    if (sessionWallet) {
      const walletRows = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.wallet, sessionWallet))
        .limit(1);
      if (walletRows.length > 0) {
        return NextResponse.json(
          { error: 'profile already exists for this wallet; use PATCH /api/profile to update' },
          { status: 409 },
        );
      }
    }

    // Not a wallet conflict — assume handle collision, retry with a
    // 4-digit random suffix. Trim a trailing underscore from the base
    // before appending so we never produce "xxx__1234".
    const suffix = Math.floor(Math.random() * 9000 + 1000).toString();
    const base = handle.slice(0, 27).replace(/_+$/, '');
    const fallbackHandle = `${base}_${suffix}`;
    const retry = await db
      .insert(profiles)
      .values({ ...baseValues, handle: fallbackHandle })
      .onConflictDoNothing()
      .returning({ id: profiles.id });
    if (!retry.length) {
      return NextResponse.json({ error: 'That username is taken.' }, { status: 409 });
    }
    profileId = retry[0].id;
  }

  // Bind the new profile to the session in KV. MUST succeed.
  try {
    await setSessionProfileOrThrow(sessionId, profileId);
  } catch (err) {
    console.error('[profile/create] setSessionProfile failed; rolling back profile row', err);
    try {
      await db.delete(profiles).where(eq(profiles.id, profileId));
    } catch (delErr) {
      console.error('[profile/create] rollback delete also failed', delErr);
    }
    return NextResponse.json(
      { error: 'Could not bind profile to session; please retry.' },
      { status: 503 },
    );
  }

  return NextResponse.json({ profileId, handle });
}
