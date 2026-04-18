import { NextResponse } from 'next/server';
import { requireAdminWallet } from '@/lib/admin';
import { db } from '@/lib/db/client';
import { profiles, premiumUsers } from '@/lib/db/schema';
import { and, eq, ilike, or, sql, desc } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SourceFilter = 'all' | 'crypto' | 'fiat' | 'admin_grant' | 'pending' | 'refunded';

/**
 * GET /api/admin/transactions
 *
 * Paginated ledger of every paid / granted premium row, joined to the
 * matching profile so the UI can surface a human identity next to the
 * payment telemetry (USDC amount, $WORD burned, escrow lifecycle).
 *
 * Query params:
 *   q        — search (wallet prefix, handle substring, or email
 *              substring). Searches across premium_users.email and
 *              profiles.email so an anonymous Stripe buyer whose
 *              profile hasn't merged yet is still findable.
 *   filter   — 'all' | 'crypto' | 'fiat' | 'admin_grant' | 'pending'
 *              | 'refunded'
 *   page     — 1-indexed page number
 *   limit    — rows per page (10–100)
 *
 * Admin-gated by `requireAdminWallet`; 404 on unauthorized to avoid
 * leaking the route's existence.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') ?? '').trim();
  const filterParam = (searchParams.get('filter') ?? 'all') as SourceFilter;

  const rawPage = parseInt(searchParams.get('page') ?? '1', 10);
  const rawLimit = parseInt(searchParams.get('limit') ?? '50', 10);
  const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1;
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(10, rawLimit)) : 50;
  const offset = (page - 1) * limit;

  const searchTerm = q ? `%${q}%` : null;

  // Build WHERE in two layers:
  //   (a) search across wallet + handle + email (both the tx-row email
  //       snapshot and the profile's durable email)
  //   (b) filter by source / escrow status
  const searchWhere = searchTerm
    ? or(
        ilike(premiumUsers.wallet, searchTerm),
        ilike(profiles.handle, searchTerm),
        ilike(premiumUsers.email, searchTerm),
        ilike(profiles.email, searchTerm),
      )
    : undefined;

  const filterWhere = (() => {
    switch (filterParam) {
      case 'crypto':
        return eq(premiumUsers.source, 'crypto');
      case 'fiat':
        return eq(premiumUsers.source, 'fiat');
      case 'admin_grant':
        return eq(premiumUsers.source, 'admin_grant');
      case 'pending':
        return eq(premiumUsers.escrowStatus, 'pending');
      case 'refunded':
        return eq(premiumUsers.escrowStatus, 'refunded');
      case 'all':
      default:
        return undefined;
    }
  })();

  const where = [searchWhere, filterWhere].filter(Boolean);
  const compoundWhere = where.length > 0 ? and(...where) : undefined;

  const [rows, countResult] = await Promise.all([
    db
      .select({
        wallet: premiumUsers.wallet,
        handle: profiles.handle,
        // Prefer the tx-row email (Stripe source of truth at purchase
        // time), fall back to the profile's email for rows written
        // before M6-premium-email-anchor.
        email: sql<string | null>`coalesce(${premiumUsers.email}, ${profiles.email})`,
        source: premiumUsers.source,
        txHash: premiumUsers.txHash,
        stripeSessionId: premiumUsers.stripeSessionId,
        usdcAmount: premiumUsers.usdcAmount,
        wordBurned: premiumUsers.wordBurned,
        escrowStatus: premiumUsers.escrowStatus,
        escrowOpenTx: premiumUsers.escrowOpenTx,
        escrowBurnTx: premiumUsers.escrowBurnTx,
        externalId: premiumUsers.externalId,
        unlockedAt: premiumUsers.unlockedAt,
        grantedBy: premiumUsers.grantedBy,
        reason: premiumUsers.reason,
      })
      .from(premiumUsers)
      .leftJoin(profiles, eq(profiles.wallet, premiumUsers.wallet))
      .where(compoundWhere)
      .orderBy(desc(premiumUsers.unlockedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(premiumUsers)
      .leftJoin(profiles, eq(profiles.wallet, premiumUsers.wallet))
      .where(compoundWhere),
  ]);

  const total = Number(countResult[0]?.count ?? 0);

  return NextResponse.json({
    rows: rows.map((r) => ({
      wallet: r.wallet,
      handle: r.handle,
      email: r.email,
      source: r.source,
      txHash: r.txHash,
      stripeSessionId: r.stripeSessionId,
      usdcAmount: r.usdcAmount,
      wordBurned: r.wordBurned,
      escrowStatus: r.escrowStatus,
      escrowOpenTx: r.escrowOpenTx,
      escrowBurnTx: r.escrowBurnTx,
      externalId: r.externalId,
      unlockedAt: r.unlockedAt,
      grantedBy: r.grantedBy,
      reason: r.reason,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}
