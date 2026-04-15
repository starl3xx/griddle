import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import { setSessionProfile } from '@/lib/session-profile';
import { db } from '@/lib/db/client';
import { profiles } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

/**
 * POST /api/profile/create
 *
 * Body: `{ displayName: string }`
 *
 * Creates a display-name-only profile for users who don't want to
 * provide an email. No email verification — profile is bound to this
 * browser session via Upstash KV. If the session is lost (new browser,
 * cleared cookies) the user will need to re-create or add an email.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  let body: { displayName?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const displayName = (body.displayName ?? '').trim().slice(0, 50);
  if (!displayName) {
    return NextResponse.json({ error: 'displayName required' }, { status: 400 });
  }

  // Use displayName as the handle (slugified) if no handle exists.
  // The slug is lowercase alphanumeric + hyphen, max 32 chars.
  const handle = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'player';

  // Try the slugified handle first. If it's taken, fall back to a
  // 4-digit random suffix. Use onConflictDoNothing + empty-returning
  // check to detect handle uniqueness without swallowing unrelated
  // DB errors (connection failures, CHECK constraint violations, etc.)
  // in a blanket try/catch.
  let profileId: number;
  const firstTry = await db
    .insert(profiles)
    .values({ handle, displayName, updatedAt: new Date() })
    .onConflictDoNothing()
    .returning({ id: profiles.id });

  if (firstTry.length > 0) {
    profileId = firstTry[0].id;
  } else {
    const suffix = Math.floor(Math.random() * 9000 + 1000).toString();
    const fallbackHandle = `${handle.slice(0, 27)}-${suffix}`;
    const retry = await db
      .insert(profiles)
      .values({ handle: fallbackHandle, displayName, updatedAt: new Date() })
      .onConflictDoNothing()
      .returning({ id: profiles.id });
    if (!retry.length) {
      return NextResponse.json({ error: 'Could not create profile, try a different name.' }, { status: 409 });
    }
    profileId = retry[0].id;
  }

  const sessionId = await getSessionId();
  await setSessionProfile(sessionId, profileId);

  return NextResponse.json({ profileId, handle });
}
