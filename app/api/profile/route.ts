import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import { getSessionProfile } from '@/lib/session-profile';
import { getSessionWallet } from '@/lib/wallet-session';
import { isSessionPremium } from '@/lib/premium-check';
import { validateUsername } from '@/lib/username';
import { db } from '@/lib/db/client';
import { profiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * GET /api/profile
 *
 * Returns the profile bound to the current session (by session-profile
 * KV key or session-wallet KV key). Returns `{ profile: null }` when
 * no profile is bound.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const sessionId = await getSessionId();

  // Try session-profile binding first (email auth / handle-only profiles)
  const profileId = await getSessionProfile(sessionId);
  if (profileId !== null) {
    const rows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, profileId))
      .limit(1);
    if (rows.length > 0) {
      const p = rows[0];
      return NextResponse.json({
        profile: {
          id: p.id,
          email: p.email,
          handle: p.handle,
          avatarUrl: p.avatarUrl,
          wallet: p.wallet,
          premiumSource: p.premiumSource,
          emailVerifiedAt: p.emailVerifiedAt,
        },
      });
    }
  }

  // Fall back to wallet binding
  const wallet = await getSessionWallet(sessionId);
  if (wallet) {
    const rows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.wallet, wallet))
      .limit(1);
    if (rows.length > 0) {
      const p = rows[0];
      return NextResponse.json({
        profile: {
          id: p.id,
          email: p.email,
          handle: p.handle,
          avatarUrl: p.avatarUrl,
          wallet: p.wallet,
          premiumSource: p.premiumSource,
          emailVerifiedAt: p.emailVerifiedAt,
        },
      });
    }
  }

  return NextResponse.json({ profile: null });
}

/**
 * PATCH /api/profile
 *
 * Body: `{ handle?, avatarUrl? }`
 *
 * Updates the profile bound to the current session. Requires a
 * profile to already exist.
 *
 * Changing the handle (username) is a **Premium** feature — free
 * users get whatever handle was seeded at profile creation and
 * can't rename without upgrading. The gate is enforced here rather
 * than client-side so a direct POST can't bypass it.
 *
 * Profanity check runs on any handle patch via `validateUsername`.
 * The check is a floor, not a ceiling — see lib/profanity.ts.
 */
export async function PATCH(req: Request): Promise<NextResponse> {
  const sessionId = await getSessionId();

  // Mirror GET: try session-profile first, fall back to wallet-linked profile.
  let profileId = await getSessionProfile(sessionId);
  if (profileId === null) {
    const wallet = await getSessionWallet(sessionId);
    if (wallet) {
      const rows = await db.select({ id: profiles.id }).from(profiles)
        .where(eq(profiles.wallet, wallet)).limit(1);
      if (rows.length > 0) profileId = rows[0].id;
    }
  }
  if (profileId === null) {
    return NextResponse.json({ error: 'no profile bound to session' }, { status: 401 });
  }

  let body: {
    handle?: string;
    avatarUrl?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  // Patch values are `string` for set-to-value and `null` for
  // clear-this-column.
  //
  // Note on avatarSource: any avatar patch coming through PATCH
  // /api/profile is a user-driven edit (Settings' upload flow, a
  // manual URL paste, etc.), so we always tag it as 'custom' — this
  // shields it from the Farcaster sync overwrite path. Clearing
  // avatarUrl to null also clears avatarSource, so a later Farcaster
  // sync can re-seed it as 'farcaster'.
  const patch: Record<string, string | null> = {};
  if (body.handle !== undefined) {
    const handle = body.handle.trim().toLowerCase().slice(0, 32);
    const validation = validateUsername(handle);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error ?? 'invalid username' },
        { status: 400 },
      );
    }
    // Premium gate only on CHANGES — not on initial sets. After a
    // magic-link or OTP verify, the freshly-created profile has a
    // null handle; the user then picks a username in SettingsModal
    // and PATCHes it here. They shouldn't need Premium to complete
    // onboarding. We detect "initial set" by checking whether the
    // current profile row already has a handle. If it does, this is
    // a rename → require Premium. If it doesn't, this is first-time
    // setup → allow.
    const currentRows = await db
      .select({ handle: profiles.handle })
      .from(profiles)
      .where(eq(profiles.id, profileId))
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
    patch.handle = handle;
  }
  if (body.avatarUrl !== undefined) {
    // avatarUrl CAN be cleared — send `null` explicitly to drop it
    // back to the default silhouette. Empty string is treated the same
    // as null (common mistake) to be forgiving to clients.
    if (body.avatarUrl === null || body.avatarUrl.trim() === '') {
      patch.avatarUrl = null;
      patch.avatarSource = null;
    } else {
      patch.avatarUrl = body.avatarUrl.trim().slice(0, 500);
      patch.avatarSource = 'custom';
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  // Catch unique-index violations (handle collision with another
  // profile) and surface them as a 409 instead of an unhandled 500.
  let rows;
  try {
    rows = await db
      .update(profiles)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(profiles.id, profileId))
      .returning();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('profiles_handle_lower_idx') || msg.includes('23505')) {
      return NextResponse.json({ error: 'That username is taken.' }, { status: 409 });
    }
    throw err;
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'profile not found' }, { status: 404 });
  }

  const p = rows[0];
  return NextResponse.json({
    profile: {
      id: p.id,
      email: p.email,
      handle: p.handle,
      avatarUrl: p.avatarUrl,
      wallet: p.wallet,
      premiumSource: p.premiumSource,
    },
  });
}
