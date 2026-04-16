import { NextResponse } from 'next/server';
import { getArchiveList } from '@/lib/db/queries';

/**
 * GET /api/archive
 *
 * Returns the list of past puzzle days (newest first, excluding today)
 * for the Archive tab inside BrowseModal. The server component at
 * `/archive/page.tsx` calls `getArchiveList()` directly for deep-linked
 * SSR; this JSON endpoint is the client-side counterpart used from the
 * modal.
 *
 * Premium gating is handled client-side — the tile that opens the
 * Archive tab is already Premium-gated, so we don't re-enforce here.
 * Anyone who knows the URL can fetch it, mirroring the `/archive`
 * page's public access.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const entries = await getArchiveList(60);
  return NextResponse.json({ entries });
}
