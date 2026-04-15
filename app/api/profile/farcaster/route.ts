import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import { setSessionProfile } from '@/lib/session-profile';
import { upsertProfileForFarcaster } from '@/lib/db/queries';

/**
 * POST /api/profile/farcaster
 *
 * Body: `{ fid, username?, displayName?, avatarUrl?, wallet? }`
 *
 * Called by GameClient when a wallet connects and inMiniApp === true.
 * Creates or updates the Farcaster user's profile (auto-merging if a
 * wallet profile already exists), then binds the profile to the
 * browser session in Upstash KV.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface FarcasterBody {
  fid: number;
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  wallet?: string | null;
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: FarcasterBody;
  try {
    body = (await req.json()) as FarcasterBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!body.fid || typeof body.fid !== 'number') {
    return NextResponse.json({ error: 'fid required' }, { status: 400 });
  }

  const profile = await upsertProfileForFarcaster({
    fid: body.fid,
    username: body.username ?? null,
    displayName: body.displayName ?? null,
    avatarUrl: body.avatarUrl ?? null,
    wallet: body.wallet ?? null,
  });

  const sessionId = await getSessionId();
  await setSessionProfile(sessionId, profile.id);

  return NextResponse.json({
    profile: {
      id: profile.id,
      farcasterFid: profile.farcasterFid,
      farcasterUsername: profile.farcasterUsername,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      wallet: profile.wallet,
      email: profile.email,
      premiumSource: profile.premiumSource,
    },
  });
}
