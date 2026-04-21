import { NextResponse } from 'next/server';
import { runOraclePush, type OracleUpdateResult } from '@/lib/oracle-push';

/**
 * Vercel cron → /api/cron/oracle-update
 *
 * Runs every 2 minutes (schedule in vercel.json). Reads the current
 * $WORD/USDC price from GeckoTerminal and pushes it to the on-chain
 * PushedWordOracle so GriddlePremium's 5-minute staleness check always
 * has a fresh reading, regardless of whether LHAW's own cron is up.
 *
 * Why a cron + a pushed feed rather than an on-chain TWAP: $WORD lives
 * in a Clanker v4 pool on Uniswap v4 which has no observation hook, so
 * there's no manipulation-resistant on-chain read available for this
 * token. GeckoTerminal indexes the pool off-chain and we re-publish
 * that number on-chain. See contracts/src/PushedWordOracle.sol for the
 * full trust model and lib/oracle-push.ts for the shared pipeline.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET`. Vercel's scheduler sets
 * this header automatically when CRON_SECRET is defined in env; hitting
 * the route from anywhere else requires the same header. The admin
 * force-update path goes through `/api/admin/oracle/force-update`
 * instead — same internals (runOraclePush), different auth (admin
 * wallet), and it bypasses the `cron_enabled` toggle.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse<OracleUpdateResult>> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET not configured' },
      { status: 503 },
    );
  }
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  return runOraclePush({ forced: false });
}
