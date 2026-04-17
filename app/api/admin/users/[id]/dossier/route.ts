import { NextResponse } from 'next/server';
import { requireAdminWallet } from '@/lib/admin';
import { getUserDossier } from '@/lib/db/queries';

/**
 * GET /api/admin/users/[id]/dossier
 *
 * Full history bundle for one user. `[id]` can be either:
 *   - A numeric profile id (registered user), e.g. `/users/42/dossier`
 *   - A `session:<sessionId>` token (anon player), URL-encoded
 *
 * Returns summary + recent solves + recent funnel events + wordmarks.
 * Powers the UserDossierModal opened from the Users tab.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Next.js has already URL-decoded the path segment when populating
  // `params.id`, so a second decodeURIComponent would incorrectly
  // un-encode any literal `%` sequences the client meant to keep
  // (e.g. session ids that include percent-encoded characters).
  const { id: raw } = await params;

  let dossier = null;
  if (raw.startsWith('session:')) {
    const sessionId = raw.slice('session:'.length);
    if (!sessionId) return NextResponse.json({ error: 'invalid session id' }, { status: 400 });
    dossier = await getUserDossier({ sessionId });
  } else {
    const profileId = parseInt(raw, 10);
    if (!Number.isFinite(profileId) || profileId <= 0) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }
    dossier = await getUserDossier({ profileId });
  }

  if (!dossier) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ dossier });
}
