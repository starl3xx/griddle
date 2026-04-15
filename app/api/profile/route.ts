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

  let body: { handle?: string; displayName?: string; avatarUrl?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const patch: Record<string, string> = {};
  if (body.handle !== undefined) patch.handle = body.handle.trim().slice(0, 32);
  if (body.displayName !== undefined) patch.displayName = body.displayName.trim().slice(0, 50);
  if (body.avatarUrl !== undefined) patch.avatarUrl = body.avatarUrl.trim().slice(0, 500);

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const rows = await db
    .update(profiles)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(profiles.id, profileId))
    .returning();

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
