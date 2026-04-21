import { NextResponse } from 'next/server';
import { requireAdminWallet } from '@/lib/admin';
import { runOraclePush } from '@/app/api/cron/oracle-update/route';

/**
 * Admin one-shot oracle push.
 *
 * Runs the same push pipeline as the Vercel cron (fetch price, convert,
 * setPrice on-chain) but gated on admin auth instead of CRON_SECRET,
 * and bypasses the `cron_enabled` toggle. Useful for verifying the
 * pipeline end-to-end before flipping the cron on, or for recovering
 * from a stuck feed without waiting for the next 2-min tick.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const admin = await requireAdminWallet();
  if (!admin) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return runOraclePush({ forced: true });
}
