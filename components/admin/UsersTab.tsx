'use client';

import { useEffect, useState } from 'react';
import {
  MagnifyingGlass,
  CircleNotch,
  Crown,
  PencilSimple,
  Trash,
  Check,
} from '@phosphor-icons/react';

interface UserRow {
  id: number;
  handle: string | null;
  wallet: string | null;
  email: string | null;
  emailVerifiedAt: string | null;
  avatarUrl: string | null;
  premium: boolean;
  premiumSource: string | null;
  createdAt: string;
  farcasterFid?: number | null;
  farcasterUsername?: string | null;
}

interface UsersResponse {
  users: UserRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

/**
 * Admin Users tab — searchable, paginated, editable view of every
 * profile row. Columns: Username (the primary display label), Email,
 * Wallet, Premium, Joined. Clicking a row opens an inline editor for
 * full CRUD (edit username/email, toggle premium, delete the
 * profile).
 *
 * The previous "Identity" column read as the catch-all "whatever we
 * can display" label, which admins couldn't act on directly. The
 * rename + dedicated Email column + editor modal make the table
 * actually useful for ops work (support requests, comps, bans).
 */
export function UsersTab() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<UsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editor state — the user currently being edited in the inline modal.
  // Null means no modal open. We snapshot the row when the edit button
  // is clicked so further list refreshes don't blow away in-flight edits.
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);

  // Counter that bumps after every successful mutation so the list-
  // fetch effect re-runs and picks up the server's new state.
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery((prev) => {
        if (prev !== query) setPage(1);
        return query;
      });
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

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
  }, [debouncedQuery, page, refreshTick]);

  const { users = [], pagination } = data ?? {};

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
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Username</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Email</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Wallet</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Premium</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Joined</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      {u.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
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
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 truncate">{label(u)}</p>
                        {u.farcasterUsername && (
                          <p className="text-[11px] text-purple-600 truncate">@{u.farcasterUsername}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {u.email ? (
                      <span className="text-gray-700 inline-flex items-center gap-1">
                        {u.email}
                        {u.emailVerifiedAt && (
                          <Check
                            className="w-3 h-3 text-green-600"
                            weight="bold"
                            aria-label="verified"
                          />
                        )}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
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
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setEditingUser(u)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand hover:text-brand-700 transition-colors"
                    >
                      <PencilSimple className="w-3 h-3" weight="bold" aria-hidden />
                      Edit
                    </button>
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

      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={() => {
            setEditingUser(null);
            setRefreshTick((t) => t + 1);
          }}
          onDeleted={() => {
            setEditingUser(null);
            setRefreshTick((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}

/**
 * Inline editor for a single profile row. Drives PATCH + DELETE
 * against `/api/admin/users/[id]`. Deliberately kept modal-sized
 * rather than a drawer because the editable surface is small (3
 * fields + one toggle + one dangerous action) and admins move
 * between rows quickly.
 *
 * Delete requires a confirmation step — mis-click guard — because
 * the server-side delete nulls out attribution on solves/wordmarks
 * and is not transparently reversible.
 */
function EditUserModal({
  user,
  onClose,
  onSaved,
  onDeleted,
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [handle, setHandle] = useState(user.handle ?? '');
  const [email, setEmail] = useState(user.email ?? '');
  const [premium, setPremium] = useState(user.premium);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const patch: Record<string, string | null | boolean> = {};
      const trimmedHandle = handle.trim();
      const trimmedEmail = email.trim();
      // Null clears; empty string maps to null. Omitting the key
      // leaves the field untouched on the server.
      if ((user.handle ?? '') !== trimmedHandle) {
        patch.handle = trimmedHandle.length > 0 ? trimmedHandle : null;
      }
      if ((user.email ?? '') !== trimmedEmail) {
        patch.email = trimmedEmail.length > 0 ? trimmedEmail : null;
      }
      if (user.premium !== premium) patch.premium = premium;

      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Save failed (${res.status})`);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Delete failed (${res.status})`);
      }
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="modal-sheet animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold tracking-tight text-gray-900">
              Edit profile #{user.id}
            </h2>
            <p className="text-[11px] text-gray-500 font-mono truncate">
              {user.wallet ?? 'no wallet'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-4 h-4" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <Field label="Username">
            <input
              type="text"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="(unset)"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="(unset)"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </Field>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={premium}
              onChange={(e) => setPremium(e.target.checked)}
              className="w-4 h-4 accent-accent"
            />
            <span className="text-sm font-semibold text-gray-800 inline-flex items-center gap-1.5">
              <Crown className="w-4 h-4 text-accent" weight="fill" aria-hidden />
              Premium
            </span>
            {user.premium && user.premiumSource && !premium && (
              <span className="text-[10px] text-red-600 font-bold uppercase tracking-wider">
                will revoke
              </span>
            )}
          </label>

          {error && (
            <p className="text-[12px] text-red-600">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving || deleting}
              className="btn-primary flex-1 text-sm"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving || deleting}
              className="btn-secondary text-sm"
            >
              Cancel
            </button>
          </div>

          <div className="border-t border-gray-100 pt-4">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <p className="flex-1 text-[11px] text-red-700">
                  Delete this profile? Solves and wordmarks will be detached,
                  not removed.
                </p>
                <button
                  type="button"
                  onClick={remove}
                  disabled={deleting}
                  className="py-2 px-3 rounded-btn text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60"
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                  className="text-xs text-gray-500 hover:text-gray-800 font-semibold"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-700"
              >
                <Trash className="w-3.5 h-3.5" weight="bold" aria-hidden />
                Delete profile
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
