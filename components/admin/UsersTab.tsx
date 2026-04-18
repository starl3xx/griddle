'use client';

import { useEffect, useState } from 'react';
import {
  MagnifyingGlass,
  CircleNotch,
  Crown,
  PencilSimple,
  Trash,
  Check,
  User,
} from '@phosphor-icons/react';
import { UserDossierModal } from './UserDossierModal';

interface RegisteredRow {
  kind: 'registered';
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

interface AnonRow {
  kind: 'anon';
  sessionId: string;
  solves: number;
  firstSeen: string;
  lastActive: string;
}

type UserRow = RegisteredRow | AnonRow;

interface UsersResponse {
  users: UserRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
  counts: { registered: number; anon: number };
}

type TypeFilter = 'all' | 'registered' | 'anon';

/**
 * Admin Users tab — every person who has played, registered or not.
 *
 * Filter toggle selects which kind to show:
 *   - **All**: registered first, then anon sessions
 *   - **Registered**: only `profiles` rows (legacy behavior)
 *   - **Anon**: only session_ids with solves but no profile/wallet
 *
 * Row click opens `UserDossierModal` (full history: solves, funnel
 * events, wordmarks, premium metadata). The Edit button on registered
 * rows opens `EditUserModal` for handle/email/premium changes — now
 * with a free-form reason field that's persisted alongside premium
 * grants for audit parity with the Grant tab.
 */
export function UsersTab() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [type, setType] = useState<TypeFilter>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<UsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingUser, setEditingUser] = useState<RegisteredRow | null>(null);
  const [dossierTarget, setDossierTarget] = useState<{ id: string; label: string } | null>(null);
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

  // Type filter changes are handled in the onClick below (setType +
  // setPage(1) batched in a single event handler) so the fetch effect
  // only fires once with the new filter + page=1, avoiding a
  // wasteful first request at the stale page.

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(page), limit: '50', type });
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
  }, [debouncedQuery, page, type, refreshTick]);

  const users = data?.users ?? [];
  const pagination = data?.pagination;
  const counts = data?.counts;

  // Encoding contract with /api/admin/users/[id]/dossier:
  //   - `targetId` is the raw opaque identifier: either a numeric
  //     profile id or `session:<rawSessionId>` for anon rows.
  //   - Encoding is applied exactly once — by `UserDossierModal`
  //     when it builds the fetch URL (`encodeURIComponent(targetId)`).
  //     Next.js decodes once when populating `params.id`, so the
  //     server receives the raw targetId and slices off the prefix.
  //   - Encoding here as well would be a double-encode: Next.js
  //     un-does the outer level, leaving the inner `%XX` sequences
  //     in the server's sessionId value and breaking DB lookups.
  const openDossier = (row: UserRow) => {
    if (row.kind === 'registered') {
      setDossierTarget({ id: String(row.id), label: rowLabel(row) });
    } else {
      setDossierTarget({
        id: `session:${row.sessionId}`,
        label: `anon:${row.sessionId.slice(0, 8)}`,
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-3 md:items-center">
        <div className="relative flex-1">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" weight="bold" />
          <input
            type="search"
            placeholder="Search wallet, handle, or session…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand bg-white dark:bg-gray-900"
          />
        </div>
        <div className="flex gap-1.5">
          {(['all', 'registered', 'anon'] as TypeFilter[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setType(t); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                type === t
                  ? 'bg-brand text-white'
                  : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {t}
              {counts && t !== 'all' && (
                <span className="ml-1.5 text-[10px] opacity-80">
                  {(t === 'registered' ? counts.registered : counts.anon).toLocaleString()}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {pagination && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {pagination.total.toLocaleString()} {pagination.total === 1 ? 'player' : 'players'}
          {debouncedQuery && ` matching "${debouncedQuery}"`}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><CircleNotch className="w-6 h-6 animate-spin text-gray-400 dark:text-gray-500" weight="bold" /></div>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400 text-center py-8">{error}</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">No players found.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Identity</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Email</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Wallet / Session</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Premium</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Solves / Joined</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white dark:bg-gray-900">
              {users.map((u) => (
                u.kind === 'registered' ? (
                  <RegisteredTr key={`r-${u.id}`} u={u} onEdit={() => setEditingUser(u)} onOpen={() => openDossier(u)} />
                ) : (
                  <AnonTr key={`a-${u.sessionId}`} u={u} onOpen={() => openDossier(u)} />
                )
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
            className="text-sm text-gray-600 dark:text-gray-400 hover:text-brand disabled:opacity-40 transition-colors">
            ← Previous
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">Page {page} of {pagination.pages}</span>
          <button type="button" disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)}
            className="text-sm text-gray-600 dark:text-gray-400 hover:text-brand disabled:opacity-40 transition-colors">
            Next →
          </button>
        </div>
      )}

      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={() => { setEditingUser(null); setRefreshTick((t) => t + 1); }}
          onDeleted={() => { setEditingUser(null); setRefreshTick((t) => t + 1); }}
        />
      )}
      {dossierTarget && (
        <UserDossierModal
          targetId={dossierTarget.id}
          label={dossierTarget.label}
          onClose={() => setDossierTarget(null)}
        />
      )}
    </div>
  );
}

function rowLabel(u: RegisteredRow): string {
  const display = u.handle?.trim();
  if (display) return display;
  if (u.wallet) return `${u.wallet.slice(0, 6)}...${u.wallet.slice(-4)}`;
  return `#${u.id}`;
}

function RegisteredTr({ u, onEdit, onOpen }: { u: RegisteredRow; onEdit: () => void; onOpen: () => void }) {
  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer" onClick={onOpen}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          {u.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={u.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0 text-gray-500 dark:text-gray-400 text-xs font-bold">
              {rowLabel(u)[0].toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">{rowLabel(u)}</p>
            {u.farcasterUsername && <p className="text-[11px] text-purple-600 truncate">@{u.farcasterUsername}</p>}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-xs">
        {u.email ? (
          <span className="text-gray-700 dark:text-gray-300 inline-flex items-center gap-1">
            {u.email}
            {u.emailVerifiedAt && <Check className="w-3 h-3 text-green-600" weight="bold" aria-label="verified" />}
          </span>
        ) : <span className="text-gray-300 dark:text-gray-600">—</span>}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400">
        {u.wallet ? <>{u.wallet.slice(0, 6)}&hellip;{u.wallet.slice(-4)}</> : <span className="text-gray-300 dark:text-gray-600">—</span>}
      </td>
      <td className="px-4 py-3">
        {u.premium ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent">
            <Crown className="w-3 h-3" weight="fill" /> {u.premiumSource ?? 'premium'}
          </span>
        ) : <span className="text-gray-300 dark:text-gray-600 text-[11px]">—</span>}
      </td>
      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
        {new Date(u.createdAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand hover:text-brand-700 transition-colors">
          <PencilSimple className="w-3 h-3" weight="bold" aria-hidden />Edit
        </button>
      </td>
    </tr>
  );
}

function AnonTr({ u, onOpen }: { u: AnonRow; onOpen: () => void }) {
  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer" onClick={onOpen}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0 text-gray-400 dark:text-gray-500">
            <User className="w-4 h-4" weight="bold" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="font-mono text-[12px] text-gray-700 dark:text-gray-300 truncate">anon:{u.sessionId.slice(0, 8)}</p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">no account</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-xs"><span className="text-gray-300 dark:text-gray-600">—</span></td>
      <td className="px-4 py-3 font-mono text-xs text-gray-400 dark:text-gray-500 truncate max-w-[180px]">{u.sessionId.slice(0, 16)}…</td>
      <td className="px-4 py-3"><span className="text-gray-300 dark:text-gray-600 text-[11px]">—</span></td>
      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
        {u.solves} solve{u.solves === 1 ? '' : 's'} · last {new Date(u.lastActive).toLocaleDateString()}
      </td>
      <td className="px-4 py-3 text-right">
        <span className="text-[10px] text-gray-400 dark:text-gray-500 font-semibold uppercase tracking-wider">view →</span>
      </td>
    </tr>
  );
}

/**
 * Inline editor for a single profile. Drives PATCH + DELETE against
 * `/api/admin/users/[id]`. The reason field is forwarded when
 * flipping premium on, giving parity with the Grant tab's audit
 * trail — previously this modal hardcoded reason='admin UI'.
 */
function EditUserModal({
  user, onClose, onSaved, onDeleted,
}: {
  user: RegisteredRow;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [handle, setHandle] = useState(user.handle ?? '');
  const [email, setEmail] = useState(user.email ?? '');
  const [premium, setPremium] = useState(user.premium);
  const [reason, setReason] = useState('');
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
      if ((user.handle ?? '') !== trimmedHandle) {
        patch.handle = trimmedHandle.length > 0 ? trimmedHandle : null;
      }
      if ((user.email ?? '') !== trimmedEmail) {
        patch.email = trimmedEmail.length > 0 ? trimmedEmail : null;
      }
      if (user.premium !== premium) patch.premium = premium;
      // Only send reason when actually granting premium (turning it on).
      // Revoking doesn't accept a reason; an omitted or empty reason
      // falls through to the server's 'admin UI' default.
      if (premium && !user.premium) {
        const trimmedReason = reason.trim();
        if (trimmedReason) patch.reason = trimmedReason;
      }

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

  const showReason = premium && !user.premium;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fade-in" onClick={onClose}>
      <div className="modal-sheet animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100">Edit profile #{user.id}</h2>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 font-mono truncate">{user.wallet ?? 'no wallet'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="w-8 h-8 flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-4 h-4" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <Field label="Username">
            <input type="text" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="(unset)"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
          </Field>
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="(unset)"
              className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
          </Field>

          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={premium} onChange={(e) => setPremium(e.target.checked)} className="w-4 h-4 accent-accent" />
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 inline-flex items-center gap-1.5">
              <Crown className="w-4 h-4 text-accent" weight="fill" aria-hidden />Premium
            </span>
            {user.premium && user.premiumSource && !premium && (
              <span className="text-[10px] text-red-600 dark:text-red-400 font-bold uppercase tracking-wider">will revoke</span>
            )}
          </label>

          {showReason && (
            <Field label="Grant reason (optional)">
              <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. launch contributor, support comp, Farcaster giveaway"
                maxLength={200}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Appears in the Grant tab’s Recent Grants audit list.</p>
            </Field>
          )}

          {error && <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={saving || deleting} className="btn-primary flex-1 text-sm">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" onClick={onClose} disabled={saving || deleting} className="btn-secondary text-sm">
              Cancel
            </button>
          </div>

          <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <p className="flex-1 text-[11px] text-red-700 dark:text-red-400">
                  Delete this profile? Solves and wordmarks will be detached, not removed.
                </p>
                <button type="button" onClick={remove} disabled={deleting}
                  className="py-2 px-3 rounded-btn text-xs font-bold text-white bg-red-600 dark:bg-red-700 hover:bg-red-700 dark:hover:bg-red-600 disabled:opacity-60">
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting}
                  className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 font-semibold">Cancel</button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-400">
                <Trash className="w-3.5 h-3.5" weight="bold" aria-hidden />Delete profile
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
      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}
