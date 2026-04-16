import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import { getSessionProfile, setSessionProfileOrThrow } from '@/lib/session-profile';
import { getSessionWallet } from '@/lib/wallet-session';
import { db } from '@/lib/db/client';
import { profiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * POST /api/profile/create
 *
 * Body: `{ displayName: string, avatarUrl?: string }`
 *
 * Creates a profile for the current session. Two modes:
 *
 *   1. **Handle-only** — no wallet bound. Profile row has displayName
 *      + a slugified handle, no wallet. Bound to the session via
 *      Upstash KV. If the session is lost (new browser, cleared
 *      cookies) the user will need to re-create or add an email.
 *
 *   2. **Wallet-linked** — session already has a wallet bound (the
 *      user clicked Connect Wallet earlier). Profile row has displayName
 *      + handle + WALLET so the "Complete your profile" flow from
 *      SettingsModal produces a full wallet-linked row in one shot,
 *      not an orphan handle-only row that then races with wallet/link's
 *      reconcile.
 *
 * Either mode accepts an optional `avatarUrl`. Handle is always auto-
 * slugified from displayName; it can be changed later via PATCH.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AVATAR_URL_RE = /^https?:\/\/[^\s]{1,500}$/;

export async function POST(req: Request): Promise<NextResponse> {
  let body: { displayName?: string; avatarUrl?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const displayName = (body.displayName ?? '').trim().slice(0, 50);
  if (!displayName) {
    return NextResponse.json({ error: 'displayName required' }, { status: 400 });
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

  // Guard: if the session already has a profile bound, refuse to
  // create a second one. Without this, a malicious client could loop
  // this endpoint with different display names to squat handles —
  // each call creates a new profile, overwrites the session KV
  // binding, and leaves the previous profile orphaned but still
  // blocking its handle via the unique index. Callers that actually
  // want to update an existing profile use PATCH /api/profile.
  //
  // Mirror the PATCH handler: check BOTH the session-profile KV (for
  // handle-only / email-auth profiles) AND the session-wallet KV +
  // wallet-linked profile row (for users who unlocked premium via
  // crypto/fiat and got a profile row from recordCryptoUnlock /
  // recordFiatUnlock). Missing the wallet branch lets a wallet-linked
  // user pass the guard and create a shadow profile.
  const sessionId = await getSessionId();
  const existingFromProfile = await getSessionProfile(sessionId);
  if (existingFromProfile !== null) {
    return NextResponse.json(
      { error: 'profile already exists for this session; use PATCH /api/profile to update' },
      { status: 409 },
    );
  }
  const sessionWallet = await getSessionWallet(sessionId);
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

  // Slugify the display name into a handle that matches the same shape
  // PATCH /api/profile validates against: /^[a-z0-9_]+$/, 2–32 chars.
  // Any non-matching character (spaces, punctuation, unicode glyphs
  // like $, ✪, etc.) becomes an underscore — and the slug may not
  // start or end with an underscore.
  //
  // Crucially, trim leading/trailing underscores AFTER the length slice:
  // stripping before the slice lets the slice itself re-introduce an
  // underscore at the cut point, producing handles the PATCH validator
  // would then reject (leaving the profile uneditable).
  const toValidSlug = (raw: string): string => {
    let s = raw
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 32)
      .replace(/^_+|_+$/g, '');
    if (!s) s = 'player';
    if (s.length < 2) s = `${s}_player`.slice(0, 32).replace(/_+$/, '');
    return s;
  };
  const handle = toValidSlug(displayName);

  // Shared insert payload — wallet comes from the session KV binding
  // (if any), so a wallet-connected user completing their profile
  // ends up with a proper wallet-linked row in one shot. avatarUrl is
  // optional and validated above.
  const baseValues = {
    handle,
    displayName,
    avatarUrl,
    wallet: sessionWallet,
    updatedAt: new Date(),
  };

  // Try the slugified handle first. If onConflictDoNothing returns
  // empty, the insert raced a unique-index conflict on EITHER handle
  // OR wallet (when sessionWallet is set). Both paths look identical
  // from onConflictDoNothing's perspective, so differentiate by post-
  // insert state: if a row now exists for our session-wallet, the
  // conflict was on wallet (TOCTOU with the pre-insert guard) — we
  // can't retry by changing the handle, so surface a clear error.
  // If no wallet row exists, assume handle conflict and retry with
  // a 4-digit suffix.
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
    // 4-digit random suffix. Strip a trailing underscore from the
    // base before appending so we never produce "xxx__1234", and
    // so the resulting handle always matches the PATCH validator's
    // /^[a-z0-9_]+$/ — a hyphen separator here would produce a
    // handle the PATCH endpoint rejects, leaving the profile
    // uneditable.
    const suffix = Math.floor(Math.random() * 9000 + 1000).toString();
    const base = handle.slice(0, 27).replace(/_+$/, '');
    const fallbackHandle = `${base}_${suffix}`;
    const retry = await db
      .insert(profiles)
      .values({ ...baseValues, handle: fallbackHandle })
      .onConflictDoNothing()
      .returning({ id: profiles.id });
    if (!retry.length) {
      return NextResponse.json({ error: 'Could not create profile, try a different name.' }, { status: 409 });
    }
    profileId = retry[0].id;
  }

  // Bind the new profile to the session in KV. MUST succeed — the
  // non-throwing setSessionProfile would silently swallow a KV flake,
  // leaving an orphaned DB row and a client that optimistically thinks
  // it has an account but reverts to anonymous on reload. Mirror the
  // magic-link verify path: use the throwing variant, and if it fails,
  // delete the just-created profile row so the user can retry cleanly
  // instead of leaving a dangling handle (which would block re-creates
  // because the unique index is already taken).
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
