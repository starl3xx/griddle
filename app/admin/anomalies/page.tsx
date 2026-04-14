import { notFound } from 'next/navigation';
import { getRecentAnomalies } from '@/lib/db/queries';
import { requireAdminWallet } from '@/lib/admin';
import { formatMs } from '@/lib/format';

/**
 * Admin anomaly dashboard. Server component — checks the connected
 * wallet against the ADMIN_WALLETS allowlist before rendering anything.
 *
 * Non-admin visitors get a 404 (not 403) so the existence of the page
 * isn't leaked. If you can't see it, it doesn't exist for you.
 *
 * Shows the most recent ~200 flagged solves with all the timing
 * telemetry needed to decide "bot or human?" — server time, client
 * time, keystroke count, stddev, min interval, flag.
 */
export const dynamic = 'force-dynamic';

export default async function AnomaliesPage() {
  const adminWallet = await requireAdminWallet();
  if (!adminWallet) notFound();

  const entries = await getRecentAnomalies(200);

  return (
    <main className="flex-1 flex flex-col items-start px-4 pt-10 pb-12 gap-6 max-w-5xl mx-auto w-full">
      <header>
        <h1 className="text-3xl font-black tracking-tight text-gray-900">
          Anomaly review
        </h1>
        <p className="text-sm font-medium text-gray-500 mt-1">
          {entries.length} flagged solves · admin: {adminWallet.slice(0, 6)}…
          {adminWallet.slice(-4)}
        </p>
      </header>

      <div className="w-full overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-gray-500 uppercase tracking-widest">
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 pr-3">When</th>
              <th className="text-left py-2 pr-3">Puzzle</th>
              <th className="text-left py-2 pr-3">Flag</th>
              <th className="text-left py-2 pr-3">Wallet / Session</th>
              <th className="text-right py-2 pr-3">Server</th>
              <th className="text-right py-2 pr-3">Client</th>
              <th className="text-right py-2 pr-3">Strokes</th>
              <th className="text-right py-2 pr-3">Stddev</th>
              <th className="text-right py-2 pr-3">Min</th>
            </tr>
          </thead>
          <tbody className="font-mono text-gray-800">
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  {new Date(e.createdAt).toISOString().replace('T', ' ').slice(0, 19)}
                </td>
                <td className="py-1.5 pr-3 tabular-nums">#{e.puzzleId}</td>
                <td className="py-1.5 pr-3">
                  <span
                    className={
                      e.flag === 'ineligible'
                        ? 'text-error font-bold'
                        : 'text-warning font-bold'
                    }
                  >
                    {e.flag}
                  </span>
                </td>
                <td className="py-1.5 pr-3 truncate max-w-[180px]">
                  {e.wallet
                    ? `${e.wallet.slice(0, 6)}…${e.wallet.slice(-4)}`
                    : `anon:${e.sessionId.slice(0, 8)}`}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {e.serverSolveMs != null ? formatMs(e.serverSolveMs) : '—'}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {e.clientSolveMs != null ? formatMs(e.clientSolveMs) : '—'}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {e.keystrokeCount ?? '—'}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {e.keystrokeStddevMs ?? '—'}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {e.keystrokeMinMs ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
