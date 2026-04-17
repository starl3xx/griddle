import { NextResponse } from 'next/server';
import { requireAdminWallet } from '@/lib/admin';
import { db } from '@/lib/db/client';
import { profiles, premiumUsers } from '@/lib/db/schema';
import { ilike, or, eq, sql, desc } from 'drizzle-orm';
import { getAnonSessions } from '@/lib/db/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/users?type=all|registered|anon&q=&page=&limit=
 *
 * Unified user listing. `registered` returns `profiles` rows (legacy
 * behavior); `anon` returns session_ids with solves but no profile or
 * wallet; `all` interleaves them (registered first, then anon) so the
 * admin sees the full player base. The anon rows carry a synthetic
 * `kind: 'anon'` discriminator so the client can render them as
 * `anon:{sessionId.slice(0,8)}` identities.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') ?? '').trim();
  const typeParam = searchParams.get('type') ?? 'all';
  const type: 'all' | 'registered' | 'anon' =
    typeParam === 'registered' || typeParam === 'anon' ? typeParam : 'all';

  const rawPage  = parseInt(searchParams.get('page')  ?? '1',  10);
  const rawLimit = parseInt(searchParams.get('limit') ?? '50', 10);
  const page  = Number.isFinite(rawPage)  ? Math.max(1,   rawPage)        : 1;
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(10, rawLimit)) : 50;

  const registeredRows = type === 'anon' ? [] : await listRegistered({ q, page, limit });
  const registeredTotal = type === 'anon' ? 0 : await countRegistered({ q });
  const anonResult = type === 'registered' ? { rows: [], total: 0 } : await getAnonSessions({ page, limit, search: q || undefined });

  const users = [
    ...registeredRows.map((r) => ({ ...r, kind: 'registered' as const })),
    ...anonResult.rows.map((r) => ({
      kind: 'anon' as const,
      sessionId: r.sessionId,
      solves: r.solves,
      firstSeen: r.firstSeen,
      lastActive: r.lastActive,
    })),
  ];

  const total = registeredTotal + anonResult.total;
  return NextResponse.json({
    users,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    counts: { registered: registeredTotal, anon: anonResult.total },
  });
}

async function listRegistered(opts: { q: string; page: number; limit: number }) {
  const searchTerm = opts.q ? `%${opts.q}%` : null;
  const where = searchTerm
    ? or(ilike(profiles.wallet, searchTerm), ilike(profiles.handle, searchTerm))
    : undefined;
  const offset = (opts.page - 1) * opts.limit;
  const rows = await db
    .select({
      id: profiles.id,
      handle: profiles.handle,
      wallet: profiles.wallet,
      email: profiles.email,
      emailVerifiedAt: profiles.emailVerifiedAt,
      avatarUrl: profiles.avatarUrl,
      premiumSource: profiles.premiumSource,
      premiumUsersSource: premiumUsers.source,
      createdAt: profiles.createdAt,
      premiumUnlockedAt: premiumUsers.unlockedAt,
    })
    .from(profiles)
    .leftJoin(premiumUsers, eq(profiles.wallet, premiumUsers.wallet))
    .where(where)
    .orderBy(desc(profiles.createdAt))
    .limit(opts.limit)
    .offset(offset);
  return rows.map((r) => ({
    id: r.id,
    handle: r.handle,
    wallet: r.wallet,
    email: r.email,
    emailVerifiedAt: r.emailVerifiedAt,
    avatarUrl: r.avatarUrl,
    premium: !!(r.premiumSource || r.premiumUnlockedAt),
    premiumSource: r.premiumSource ?? r.premiumUsersSource ?? null,
    createdAt: r.createdAt,
  }));
}

async function countRegistered(opts: { q: string }): Promise<number> {
  const searchTerm = opts.q ? `%${opts.q}%` : null;
  const where = searchTerm
    ? or(ilike(profiles.wallet, searchTerm), ilike(profiles.handle, searchTerm))
    : undefined;
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(profiles)
    .where(where);
  return Number(row?.count ?? 0);
}
