import { NextResponse } from 'next/server';
import { getSessionId } from '@/lib/session';
import { getSessionWallet } from '@/lib/wallet-session';
import { setSessionProfileOrThrow } from '@/lib/session-profile';
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

  const sessionId = await getSessionId();

  // Security: require the wallet in the request body to match the wallet
  // already bound to this session in KV (set by /api/wallet/link earlier
  // in the connect flow). This prevents arbitrary callers from claiming
  // any FID — the caller must have already proven wallet ownership via
  // the wagmi connector before we trust the Farcaster context data they
  // report. Note: FID verification via SIWF is not used (miniapp-only),
  // so the wallet match is the primary guard here.
  const sessionWallet = await getSessionWallet(sessionId);
  const requestWallet = body.wallet ? body.wallet.toLowerCase() : null;

  if (!sessionWallet || sessionWallet !== requestWallet) {
    return NextResponse.json(
      { error: 'wallet mismatch — connect wallet before updating Farcaster profile' },
      { status: 403 },
    );
  }

  const profile = await upsertProfileForFarcaster({
    fid: body.fid,
    username: body.username ?? null,
    displayName: body.displayName ?? null,
    avatarUrl: body.avatarUrl ?? null,
    wallet: requestWallet,
  });
  // Consistent with /api/profile/create and /api/auth/verify: use the
  // throwing variant so callers know for sure the binding landed.
  // The wallet-based fallback in GET /api/profile would usually cover
  // a Farcaster user reloading after a KV miss, but the contract
  // inconsistency caused real confusion in testing — every endpoint
  // that creates-and-binds should fail closed.
  try {
    await setSessionProfileOrThrow(sessionId, profile.id);
  } catch (err) {
    console.error('[profile/farcaster] setSessionProfile failed', err);
    return NextResponse.json(
      { error: 'Could not bind profile to session; please retry.' },
      { status: 503 },
    );
  }

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
