'use client';

import { useEffect, useState } from 'react';
import { MagnifyingGlass, CircleNotch, Crown } from '@phosphor-icons/react';

interface UserRow {
  id: number;
  handle: string | null;
  wallet: string | null;
  premium: boolean;
  premiumSource: string | null;
  createdAt: string;
  // Extended by M6-email-auth post-merge:
  email?: string | null;
  avatarUrl?: string | null;
  farcasterFid?: number | null;
  farcasterUsername?: string | null;
  emailVerifiedAt?: string | null;
}

interface UsersResponse {
  users: UserRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

/**
 * Admin Users tab — searchable, paginated view of all profile rows.
 * Displays wallet, handle, and premium status. Email, display name,
 * Farcaster FID, and avatar columns arrive after M6-email-auth merges.
 */
export function UsersTab() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<UsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce the query and reset to page 1 only when the effective query
  // actually changes — typing "a" then deleting it shouldn't kick the user
  // off page 3 just because the timeout fired.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery((prev) => {
        if (prev !== query) setPage(1);
        return query;
      });
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // AbortController cancels in-flight requests so a slow earlier response
  // can't overwrite a newer one when debouncedQuery/page change quickly.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(page), limit: '50' });
        if (debouncedQuery) params.set('q', debouncedQuery);
        const res = await fetch(`/api/admin/users?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error('Failed to load users');
        setData(await res.json() as UsersResponse);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Error');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [debouncedQuery, page]);

  const { users = [], pagination } = data ?? {};
  // Treat empty strings as missing so label never returns "" (which would
  // crash `label(u)[0].toUpperCase()` on the avatar initial).
  const label = (u: UserRow) => {
    const display = u.handle?.trim();
    if (display) return display;
    if (u.wallet) return `${u.wallet.slice(0, 6)}...${u.wallet.slice(-4)}`;
    return `#${u.id}`;
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" weight="bold" />
        <input
          type="search"
          placeholder="Search wallet or handle…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand bg-white"
        />
      </div>

      {pagination && (
        <p className="text-xs text-gray-500">
          {pagination.total.toLocaleString()} {pagination.total === 1 ? 'profile' : 'profiles'}
          {debouncedQuery && ` matching "${debouncedQuery}"`}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <CircleNotch className="w-6 h-6 animate-spin text-gray-400" weight="bold" />
        </div>
      ) : error ? (
        <p className="text-sm text-red-600 text-center py-8">{error}</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">No profiles found.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Identity</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Wallet</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Premium</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      {u.avatarUrl ? (
                        <img
                          src={u.avatarUrl}
                          alt=""
                          className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 text-gray-500 text-xs font-bold">
                          {label(u)[0].toUpperCase()}
                        </div>
                      )}
                      <div>
                        <p className="font-semibold text-gray-900">{label(u)}</p>
                        {/* Only show handle sub-line when it isn't already the primary label */}
                        {u.handle && label(u) !== u.handle && (
                          <p className="text-[11px] text-gray-400">/{u.handle}</p>
                        )}
                        {u.email && (
                          <p className="text-[11px] text-gray-500">{u.email}</p>
                        )}
                        {u.farcasterUsername && (
                          <p className="text-[11px] text-purple-600">@{u.farcasterUsername}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">
                    {u.wallet ? <>{u.wallet.slice(0, 6)}&hellip;{u.wallet.slice(-4)}</> : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {u.premium ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent">
                        <Crown className="w-3 h-3" weight="fill" /> {u.premiumSource ?? 'premium'}
                      </span>
                    ) : <span className="text-gray-300 text-[11px]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
            className="text-sm text-gray-600 hover:text-brand disabled:opacity-40 transition-colors">
            ← Previous
          </button>
          <span className="text-xs text-gray-500">Page {page} of {pagination.pages}</span>
          <button type="button" disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)}
            className="text-sm text-gray-600 hover:text-brand disabled:opacity-40 transition-colors">
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
