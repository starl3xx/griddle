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
 * Unified user listing. `registered` returns `profiles` rows;
 * `anon` returns session_ids with solves but no profile or wallet;
 * `all` pages contiguously through registered rows first and then
 * overflows into anon rows. The anon rows carry a synthetic
 * `kind: 'anon'` discriminator so the client can render them as
 * `anon:{sessionId.slice(0,8)}` identities.
 *
 * Pagination semantics for `all`: pages 1..ceil(regTotal/limit)
 * yield registered rows; the last page of registered plus the first
 * page of anon can share a boundary page when registered total
 * doesn't divide evenly into `limit`. Each page never returns more
 * than `limit` rows, and `pages = ceil((reg+anon)/limit)` lines up
 * with the actual row count.
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
  const startOffset = (page - 1) * limit;

  // Totals first — needed for pagination math whether we return
  // registered, anon, or both.
  const registeredTotal = type === 'anon' ? 0 : await countRegistered({ q });
  const anonTotal       = type === 'registered' ? 0 : await countAnon({ q });

  // Work out how many rows from each source this page should contain.
  let regOffset = 0, regTake = 0;
  let anonOffset = 0, anonTake = 0;

  if (type === 'registered') {
    regOffset = startOffset;
    regTake = limit;
  } else if (type === 'anon') {
    anonOffset = startOffset;
    anonTake = limit;
  } else {
    // 'all' — registered first, then anon. Compute the slice of each
    // that falls inside this page's [startOffset, startOffset+limit)
    // window.
    const regSliceStart = Math.min(startOffset, registeredTotal);
    const regSliceEnd   = Math.min(startOffset + limit, registeredTotal);
    regOffset = regSliceStart;
    regTake   = Math.max(0, regSliceEnd - regSliceStart);

    const anonStartGlobal = Math.max(0, startOffset + regTake - registeredTotal + regSliceStart - startOffset);
    // Simpler: anon rows start immediately after registered. Treat
    // `registeredTotal` as the boundary in the combined list.
    const combinedCursor = startOffset + regTake; // global index after consuming the registered slice
    anonOffset = Math.max(0, combinedCursor - registeredTotal);
    anonTake   = Math.max(0, limit - regTake);
    // Silence the unused-binding linter — the derivation above
    // preserves the intuitive form for future readers.
    void anonStartGlobal;
  }

  const registeredRows = regTake > 0
    ? await listRegistered({ q, offset: regOffset, limit: regTake })
    : [];
  const anonResult = anonTake > 0
    ? await getAnonSessions({ offset: anonOffset, limit: anonTake, search: q || undefined })
    : { rows: [], total: anonTotal };

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

  const total = registeredTotal + anonTotal;
  return NextResponse.json({
    users,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    counts: { registered: registeredTotal, anon: anonTotal },
  });
}

async function listRegistered(opts: { q: string; offset: number; limit: number }) {
  const searchTerm = opts.q ? `%${opts.q}%` : null;
  const where = searchTerm
    ? or(ilike(profiles.wallet, searchTerm), ilike(profiles.handle, searchTerm))
    : undefined;
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
    .offset(opts.offset);
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

/**
 * Count-only variant of the anon-session query — lets the route
 * compute `registeredTotal + anonTotal` without fetching rows when
 * this page only needs one source.
 */
async function countAnon(opts: { q: string }): Promise<number> {
  const res = await getAnonSessions({ offset: 0, limit: 0, search: opts.q || undefined });
  return res.total;
}
