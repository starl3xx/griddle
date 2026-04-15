import { NextResponse } from 'next/server';
import { requireAdminWallet } from '@/lib/admin';
import { db } from '@/lib/db/client';
import { profiles, premiumUsers } from '@/lib/db/schema';
import { ilike, or, eq, sql, desc } from 'drizzle-orm';

/**
 * GET /api/admin/users?q=&page=&limit=
 *
 * Paginated + searchable user list for the /admin Users tab.
 * Searches across wallet, handle, and premium_source.
 *
 * Note: email, display_name, avatar_url, farcaster_fid columns are added
 * by M4i (PR #30). This query will grow to include them post-merge.
 *
 * Auth: admin wallet via requireAdminWallet().
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') ?? '').trim();
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = Math.min(100, Math.max(10, parseInt(searchParams.get('limit') ?? '50', 10)));
  const offset = (page - 1) * limit;

  const searchTerm = q ? `%${q}%` : null;

  const where = searchTerm
    ? or(
        ilike(profiles.wallet, searchTerm),
        ilike(profiles.handle, searchTerm),
      )
    : undefined;

  const [rows, countResult] = await Promise.all([
    db
      .select({
        id: profiles.id,
        handle: profiles.handle,
        wallet: profiles.wallet,
        premiumSource: profiles.premiumSource,
        createdAt: profiles.createdAt,
        premiumUnlockedAt: premiumUsers.unlockedAt,
        premiumTxHash: premiumUsers.txHash,
      })
      .from(profiles)
      .leftJoin(premiumUsers, eq(profiles.wallet, premiumUsers.wallet))
      .where(where)
      .orderBy(desc(profiles.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(profiles)
      .where(where),
  ]);

  const total = Number(countResult[0]?.count ?? 0);

  return NextResponse.json({
    users: rows.map((r) => ({
      id: r.id,
      handle: r.handle,
      wallet: r.wallet,
      premium: !!(r.premiumSource || r.premiumUnlockedAt),
      premiumSource: r.premiumSource || (r.premiumUnlockedAt ? 'wallet' : null),
      createdAt: r.createdAt,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}
