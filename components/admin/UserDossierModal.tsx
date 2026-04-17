'use client';

import { useEffect, useState } from 'react';
import { CircleNotch, Crown, Check, PuzzlePiece } from '@phosphor-icons/react';
import { formatMsCompact as formatMs } from '@/lib/format';

interface DossierData {
  summary: {
    identityKind: 'profile' | 'anon';
    profileId: number | null;
    sessionId: string | null;
    handle: string | null;
    wallet: string | null;
    email: string | null;
    emailVerifiedAt: string | null;
    createdAt: string | null;
    premium: boolean;
    premiumSource: string | null;
    premiumReason: string | null;
    premiumGrantedBy: string | null;
  };
  solves: Array<{
    puzzleId: number;
    dayNumber: number;
    answer: string;
    serverSolveMs: number | null;
    flag: string | null;
    createdAt: string;
  }>;
  funnelEvents: Array<{ eventName: string; metadata: Record<string, unknown>; createdAt: string }>;
  wordmarks: Array<{ wordmarkId: string; earnedAt: string; puzzleId: number | null }>;
  totalSolves: number;
}

/**
 * Full-history dossier for one user. Opened from UsersTab by clicking
 * any row. Joins solves + funnel events + wordmarks + premium
 * metadata so the operator has a single place to understand "who is
 * this person, what have they done, what converted them" without
 * bouncing between tabs.
 *
 * Accepts either a numeric profile id or a `session:<sessionId>`
 * token — same format the route expects so URL-encoding stays
 * colocated with the modal.
 */
export function UserDossierModal({
  targetId,
  label,
  onClose,
}: {
  targetId: string;
  label: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<DossierData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Double-encode the full targetId so any `%XX` sequences from
        // the caller (e.g. the `%2F` produced if a session id happens
        // to contain '/') become `%25XX` on the wire. Some reverse
        // proxies decode `%2F` before routing and would otherwise
        // split the path segment → 404. Next.js decodes once when
        // populating `params.id`, which restores `targetId` exactly.
        const res = await fetch(`/api/admin/users/${encodeURIComponent(targetId)}/dossier`, { signal: controller.signal });
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        const json = await res.json() as { dossier: DossierData };
        setData(json.dossier);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [targetId]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fade-in" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-tight text-gray-900">Dossier · {label}</h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-4 h-4" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {loading && <div className="flex justify-center py-12"><CircleNotch className="w-6 h-6 animate-spin text-gray-400" weight="bold" /></div>}
          {error && <p className="text-sm text-red-600 text-center py-8">{error}</p>}

          {data && (
            <>
              <SummarySection d={data} />
              <SolvesSection d={data} />
              <FunnelSection d={data} />
              <WordmarksSection d={data} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SummarySection({ d }: { d: DossierData }) {
  const s = d.summary;
  return (
    <section>
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">Summary</h3>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <Kv k="Identity kind" v={s.identityKind} />
        <Kv k="Profile id" v={s.profileId != null ? `#${s.profileId}` : '—'} />
        <Kv k="Handle" v={s.handle ?? '—'} />
        <Kv k="Email" v={s.email ? (
          <span className="inline-flex items-center gap-1">{s.email}{s.emailVerifiedAt && <Check className="w-3 h-3 text-emerald-600" weight="bold" />}</span>
        ) : '—'} />
        <Kv k="Wallet" v={s.wallet ? <code className="text-[11px]">{s.wallet.slice(0, 8)}…{s.wallet.slice(-6)}</code> : '—'} />
        <Kv k="Session" v={s.sessionId ? <code className="text-[11px]">{s.sessionId.slice(0, 12)}…</code> : '—'} />
        <Kv k="Joined" v={s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '—'} />
        <Kv k="Total solves" v={d.totalSolves.toLocaleString()} />
      </div>
      {s.premium && (
        <div className="mt-3 rounded-lg border border-accent/20 bg-accent/5 p-3 text-[12px] flex gap-2 items-start">
          <Crown className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" weight="fill" />
          <div>
            <p className="font-bold text-accent-700">
              Premium · {s.premiumSource ?? 'unknown source'}
            </p>
            {s.premiumReason && <p className="text-gray-600 mt-0.5">“{s.premiumReason}”</p>}
            {s.premiumGrantedBy && <p className="text-[10px] text-gray-400 mt-0.5 font-mono">granted by {s.premiumGrantedBy}</p>}
          </div>
        </div>
      )}
    </section>
  );
}

function SolvesSection({ d }: { d: DossierData }) {
  if (d.solves.length === 0) {
    return <EmptySection title="Solves" body="No solves recorded." />;
  }
  return (
    <section>
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">
        Recent solves ({d.solves.length} of {d.totalSolves})
      </h3>
      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-gray-50 text-gray-500 font-bold uppercase tracking-wider text-[10px]">
            <tr>
              <th className="py-1.5 px-2 text-left">Day</th>
              <th className="py-1.5 px-2 text-left">Answer</th>
              <th className="py-1.5 px-2 text-right">Time</th>
              <th className="py-1.5 px-2 text-left">Flag</th>
              <th className="py-1.5 px-2 text-right">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {d.solves.map((s, i) => (
              <tr key={`${s.puzzleId}-${i}`}>
                <td className="py-1.5 px-2 tabular-nums text-gray-600">#{s.dayNumber}</td>
                <td className="py-1.5 px-2 font-mono tracking-wider text-gray-800"><PuzzlePiece className="inline w-3 h-3 mr-1 text-gray-400" weight="bold" />{s.answer}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{s.serverSolveMs ? formatMs(s.serverSolveMs) : '—'}</td>
                <td className="py-1.5 px-2">
                  {s.flag ? <span className={`text-[10px] font-bold rounded px-1 py-0.5 ${s.flag === 'ineligible' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>{s.flag}</span> : <span className="text-gray-300">—</span>}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums text-gray-500">{new Date(s.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FunnelSection({ d }: { d: DossierData }) {
  if (d.funnelEvents.length === 0) {
    return <EmptySection title="Funnel events" body="No funnel events recorded for this identity." />;
  }
  return (
    <section>
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">Recent funnel events</h3>
      <ul className="space-y-1 text-[12px]">
        {d.funnelEvents.map((e, i) => (
          <li key={i} className="flex items-center gap-2 text-gray-700">
            <span className="font-mono text-[11px] text-gray-400 w-20 flex-shrink-0">{new Date(e.createdAt).toLocaleDateString()}</span>
            <span className="font-semibold">{e.eventName}</span>
            {Object.keys(e.metadata).length > 0 && (
              <span className="text-gray-500 text-[11px]">
                {Object.entries(e.metadata).map(([k, v]) => `${k}=${String(v)}`).join(', ')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function WordmarksSection({ d }: { d: DossierData }) {
  if (d.wordmarks.length === 0) {
    return <EmptySection title="Wordmarks" body="No wordmarks earned yet." />;
  }
  return (
    <section>
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">Wordmarks earned ({d.wordmarks.length})</h3>
      <div className="flex flex-wrap gap-1.5">
        {d.wordmarks.map((w, i) => (
          <span key={i} className="inline-flex items-center gap-1 text-[11px] font-bold rounded-full bg-brand-100 text-brand-800 px-2 py-0.5">
            {w.wordmarkId}
            {w.puzzleId && <span className="text-[9px] text-brand-600/80 font-normal">#{w.puzzleId}</span>}
          </span>
        ))}
      </div>
    </section>
  );
}

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{k}</div>
      <div className="text-gray-800 text-[13px] truncate">{v}</div>
    </div>
  );
}

function EmptySection({ title, body }: { title: string; body: string }) {
  return (
    <section>
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">{title}</h3>
      <p className="text-[12px] text-gray-400">{body}</p>
    </section>
  );
}
