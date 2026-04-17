import { NextResponse } from 'next/server';
import { requireAdminWallet } from '@/lib/admin';
import { db } from '@/lib/db/client';
import { profiles, premiumUsers } from '@/lib/db/schema';
import { ilike, or, eq, sql, desc } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') ?? '').trim();

  // Guard against NaN from non-numeric params
  const rawPage  = parseInt(searchParams.get('page')  ?? '1',  10);
  const rawLimit = parseInt(searchParams.get('limit') ?? '50', 10);
  const page  = Number.isFinite(rawPage)  ? Math.max(1,   rawPage)        : 1;
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(10, rawLimit)) : 50;
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
        email: profiles.email,
        emailVerifiedAt: profiles.emailVerifiedAt,
        avatarUrl: profiles.avatarUrl,
        premiumSource: profiles.premiumSource,
        // Also select the actual source from premium_users (not just unlockedAt)
        premiumUsersSource: premiumUsers.source,
        createdAt: profiles.createdAt,
        premiumUnlockedAt: premiumUsers.unlockedAt,
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
      email: r.email,
      emailVerifiedAt: r.emailVerifiedAt,
      avatarUrl: r.avatarUrl,
      premium: !!(r.premiumSource || r.premiumUnlockedAt),
      // Use the actual source column from premium_users, not a fabricated string
      premiumSource: r.premiumSource ?? r.premiumUsersSource ?? null,
      createdAt: r.createdAt,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}
