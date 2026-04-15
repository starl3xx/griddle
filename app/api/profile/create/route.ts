import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import { getSessionProfile, setSessionProfileOrThrow } from '@/lib/session-profile';
import { db } from '@/lib/db/client';
import { profiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

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

  // Guard: if the session already has a profile bound, refuse to
  // create a second one. Without this, a malicious client could loop
  // this endpoint with different display names to squat handles —
  // each call creates a new profile, overwrites the session KV
  // binding, and leaves the previous profile orphaned but still
  // blocking its handle via the unique index. Callers that actually
  // want to update an existing profile use PATCH /api/profile.
  const sessionId = await getSessionId();
  const existing = await getSessionProfile(sessionId);
  if (existing !== null) {
    return NextResponse.json(
      { error: 'profile already exists for this session; use PATCH /api/profile to update' },
      { status: 409 },
    );
  }

  // Slugify the display name into a handle that matches the same shape
  // PATCH /api/profile validates against: /^[a-z0-9]+(-[a-z0-9]+)*$/,
  // 2–32 chars. Crucially, trim trailing hyphens AFTER the length slice
  // — stripping before slice lets the slice itself re-introduce a
  // hyphen at the cut point, producing handles the PATCH validator
  // then rejects (making the profile uneditable).
  const toValidSlug = (raw: string): string => {
    let s = raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 32)
      .replace(/^-+|-+$/g, '');
    if (!s) s = 'player';
    if (s.length < 2) s = `${s}-player`.slice(0, 32).replace(/-+$/, '');
    return s;
  };
  const handle = toValidSlug(displayName);

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
    // Strip a trailing hyphen from the base before appending the suffix
    // so we never produce "xxx--1234" when the base was slice-trimmed.
    const base = handle.slice(0, 27).replace(/-+$/, '');
    const fallbackHandle = `${base}-${suffix}`;
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
