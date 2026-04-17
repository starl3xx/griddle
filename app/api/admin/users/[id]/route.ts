import { NextResponse } from 'next/server';
import { requireAdminWallet } from '@/lib/admin';
import {
  deleteAdminProfile,
  grantPremium,
  revokePremiumForProfile,
  updateAdminProfile,
} from '@/lib/db/queries';
import { db } from '@/lib/db/client';
import { profiles } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Admin per-user CRUD surface. Lets operators edit a profile's
 * username/email, flip its premium status, or delete the record
 * entirely from the Users tab.
 *
 * All paths 404 for non-admins — no existence leak.
 *
 *   PATCH  /api/admin/users/[id]  body: { handle?, email?, premium? }
 *   DELETE /api/admin/users/[id]
 *
 * Patch fields are optional; omit to leave unchanged. `null` clears
 * the field. Premium toggles route through `grantPremium` (on) or
 * `revokePremiumForProfile` (off) so the existing audit trail is
 * preserved. Handle/email unique-violation returns 409 instead of 500
 * so the client can surface a "already taken" message without parsing
 * driver errors.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PatchBody {
  handle?: string | null;
  email?: string | null;
  premium?: boolean;
  /**
   * Optional free-form reason (max 200 chars) attached to a premium
   * grant. Mirrors the Grant tab's reason field so operators can say
   * why a Users-tab grant was issued ("launch contributor", "support
   * comp", etc.). Ignored when `premium: false` or when `premium` is
   * absent.
   */
  reason?: string;
}

function parseId(param: string): number | null {
  const n = parseInt(param, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  // Load the current state up-front so we can validate the POST-
  // patch intent before touching the DB. Without this, the previous
  // order (scalar first, then premium) left the profile half-updated
  // when the premium path rejected — e.g. admin clears the handle of
  // a wallet-less profile AND flips premium=true in the same request:
  // the handle clear commits, then grantPremium 400s because the
  // profile now has neither wallet nor handle to anchor the grant.
  const [existing] = await db
    .select({ wallet: profiles.wallet, handle: profiles.handle })
    .from(profiles)
    .where(eq(profiles.id, id))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: 'profile not found' }, { status: 404 });
  }

  // Project the post-patch handle so the premium-grant path can
  // check its anchor against the intended state, not the pre-patch
  // state. wallet can't be edited via PATCH so no projection there.
  const projectedHandle =
    body.handle === undefined ? existing.handle : (body.handle ? body.handle.trim().toLowerCase() : null);

  if (body.premium === true && !existing.wallet && !projectedHandle) {
    return NextResponse.json(
      { error: 'profile has no wallet or handle to grant premium to' },
      { status: 400 },
    );
  }

  // Scalar field update. Safe to do before the premium toggle now
  // that the reject-case above has been ruled out — if we get past
  // the guards, every downstream write is expected to succeed.
  if (body.handle !== undefined || body.email !== undefined) {
    const result = await updateAdminProfile({
      id,
      handle: body.handle,
      email: body.email,
    });
    if (!result.ok) {
      if (result.reason === 'not_found') {
        return NextResponse.json({ error: 'profile not found' }, { status: 404 });
      }
      return NextResponse.json(
        { error: 'handle or email already in use' },
        { status: 409 },
      );
    }
  }

  // Premium toggle. `premium` must be a boolean to take effect; we
  // don't coerce truthiness so a caller that omits the field stays a
  // no-op rather than silently flipping to `false`.
  if (typeof body.premium === 'boolean') {
    if (body.premium) {
      // `grantPremium` takes exactly one of wallet or handle. Prefer
      // wallet since that lights up the wallet-keyed premium_users
      // table used by the game's premium check; fall back to the
      // projected handle. The pre-write guard already ensured at
      // least one anchor exists.
      // Forward the operator-supplied reason when present; fall back
      // to 'admin UI' so older clients keep the same audit trail they
      // had before this PATCH learned about reasons.
      const trimmedReason = (body.reason ?? '').trim().slice(0, 200);
      const grantReason = trimmedReason || 'admin UI';
      if (existing.wallet) {
        await grantPremium({ wallet: existing.wallet, grantedBy: admin, reason: grantReason });
      } else if (projectedHandle) {
        await grantPremium({ handle: projectedHandle, grantedBy: admin, reason: grantReason });
      }
    } else {
      await revokePremiumForProfile(id);
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const deleted = await deleteAdminProfile(id);
  if (!deleted) {
    return NextResponse.json({ error: 'profile not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
