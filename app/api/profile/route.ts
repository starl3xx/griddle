import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import { getSessionProfile } from '@/lib/session-profile';
import { getSessionWallet } from '@/lib/wallet-session';
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
          displayName: p.displayName,
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
          displayName: p.displayName,
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
 * Body: `{ handle?, displayName?, avatarUrl? }`
 *
 * Updates the profile bound to the current session. Requires a profile
 * to already exist (via email auth or wallet connect).
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
    displayName?: string;
    avatarUrl?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  // Patch values are `string` for set-to-value and `null` for
  // clear-this-column. Drizzle's .set() happily writes null into a
  // nullable varchar; the schema marks all three fields nullable.
  const patch: Record<string, string | null> = {};
  if (body.handle !== undefined) {
    // Handles can't be cleared — losing a handle is destructive since
    // another user could immediately claim it, and the leaderboard uses
    // handle as display identity. Validate the slug shape either way.
    const handle = body.handle.trim().toLowerCase().slice(0, 32);
    // Lowercase letters, digits, underscores. No hyphens, no unicode,
    // no special characters. Mirrors SettingsModal's client-side check
    // and the slugifier in /api/profile/create.
    if (!/^[a-z0-9_]+$/.test(handle) || handle.length < 2) {
      return NextResponse.json(
        { error: 'handle must be 2–32 chars, lowercase letters, numbers, or underscores' },
        { status: 400 },
      );
    }
    patch.handle = handle;
  }
  if (body.displayName !== undefined) {
    // displayName is required once the user has a profile — empty would
    // render as a literal "" everywhere it surfaces. Reject blanks.
    const displayName = body.displayName.trim().slice(0, 50);
    if (!displayName) {
      return NextResponse.json({ error: 'displayName cannot be empty' }, { status: 400 });
    }
    patch.displayName = displayName;
  }
  if (body.avatarUrl !== undefined) {
    // avatarUrl CAN be cleared — send `null` explicitly to drop it
    // back to the default silhouette. Empty string is treated the same
    // as null (common mistake) to be forgiving to clients. A real URL
    // must be non-empty after trim so it can't render as <img src="">.
    if (body.avatarUrl === null || body.avatarUrl.trim() === '') {
      patch.avatarUrl = null;
    } else {
      patch.avatarUrl = body.avatarUrl.trim().slice(0, 500);
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  // Catch unique-index violations (handle collision with another
  // profile) and surface them as a 409 instead of an unhandled 500.
  // drizzle re-throws the underlying pg error; detect by SQLSTATE
  // 23505 code or index name substring so we don't couple to a
  // specific driver error class.
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
      return NextResponse.json({ error: 'handle already taken' }, { status: 409 });
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
      displayName: p.displayName,
      avatarUrl: p.avatarUrl,
      wallet: p.wallet,
      premiumSource: p.premiumSource,
    },
  });
}
