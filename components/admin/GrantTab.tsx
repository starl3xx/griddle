'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Crown, Gift, Loader2, RefreshCw } from 'lucide-react';

interface PremiumGrantRow {
  wallet: string;
  unlockedAt: string;
  source: string;
  grantedBy: string | null;
  reason: string | null;
}

type IdentityMode = 'wallet' | 'handle';

/**
 * Grant-premium tab — operator-facing form to comp Griddle Premium to
 * any wallet or handle from inside /admin. Posts to the admin-gated
 * `/api/admin/grant-premium` endpoint, which records the grant in the
 * audit log (`granted_by` = current admin wallet).
 *
 * Intentionally restrictive: one identity per grant (wallet XOR handle),
 * validated client-side before the POST. The server re-validates.
 */
export function GrantTab() {
  const [mode, setMode] = useState<IdentityMode>('wallet');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'success'; message: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const [grants, setGrants] = useState<PremiumGrantRow[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(true);

  const fetchGrants = useCallback(async () => {
    setGrantsLoading(true);
    try {
      const res = await fetch('/api/admin/grant-premium', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = (await res.json()) as { grants: PremiumGrantRow[] };
      setGrants(json.grants ?? []);
    } catch {
      setGrants([]);
    } finally {
      setGrantsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchGrants();
  }, [fetchGrants]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        setStatus({ kind: 'error', message: 'Enter a wallet or handle' });
        return;
      }
      if (mode === 'wallet' && !/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
        setStatus({ kind: 'error', message: 'Invalid wallet address' });
        return;
      }
      if (mode === 'handle' && (trimmed.length < 1 || trimmed.length > 32)) {
        setStatus({ kind: 'error', message: 'Handle must be 1–32 characters' });
        return;
      }

      setSubmitting(true);
      setStatus({ kind: 'idle' });
      try {
        const res = await fetch('/api/admin/grant-premium', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            [mode]: trimmed,
            reason: reason.trim() || undefined,
          }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          error?: string;
          result?: unknown;
        };
        if (!res.ok || !json.ok) {
          throw new Error(json.error ?? `Failed (${res.status})`);
        }
        setStatus({
          kind: 'success',
          message:
            mode === 'wallet'
              ? `Premium granted to ${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`
              : `Premium granted to @${trimmed}`,
        });
        setValue('');
        setReason('');
        void fetchGrants();
      } catch (err) {
        setStatus({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Grant failed',
        });
      } finally {
        setSubmitting(false);
      }
    },
    [mode, value, reason, fetchGrants],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-accent" />
            Grant premium
          </CardTitle>
          <CardDescription>
            Comp Griddle Premium to a wallet or handle. No burn, no tx — just a flag
            flip recorded in the audit log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={mode === 'wallet' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setMode('wallet');
                  setValue('');
                  setStatus({ kind: 'idle' });
                }}
              >
                By wallet
              </Button>
              <Button
                type="button"
                variant={mode === 'handle' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setMode('handle');
                  setValue('');
                  setStatus({ kind: 'idle' });
                }}
              >
                By handle
              </Button>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                {mode === 'wallet' ? 'Wallet address' : 'Handle'}
              </label>
              <Input
                type="text"
                placeholder={
                  mode === 'wallet'
                    ? '0x1234567890abcdef1234567890abcdef12345678'
                    : 'alice'
                }
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="font-mono text-xs"
                spellCheck={false}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                Reason (optional)
              </label>
              <Input
                type="text"
                placeholder="e.g. launch contributor, support comp, Farcaster giveaway"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={200}
              />
            </div>

            {status.kind === 'success' && (
              <p className="text-sm text-success-700 bg-success-50 border border-success-200 rounded-md px-3 py-2">
                ✓ {status.message}
              </p>
            )}
            {status.kind === 'error' && (
              <p className="text-sm text-error-700 bg-error-50 border border-error-200 rounded-md px-3 py-2">
                {status.message}
              </p>
            )}

            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Granting…
                </>
              ) : (
                <>
                  <Crown className="h-4 w-4" />
                  Grant premium
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Recent grants</CardTitle>
            <CardDescription>
              {grants.length} comped unlocks · newest first
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchGrants}
            disabled={grantsLoading}
          >
            {grantsLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </CardHeader>
        <CardContent>
          {grantsLoading && grants.length === 0 ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : grants.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-8">
              No grants yet. Comp one above to get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Wallet</TableHead>
                  <TableHead>Granted by</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grants.map((g) => (
                  <TableRow key={`${g.wallet}-${g.unlockedAt}`}>
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {new Date(g.unlockedAt).toISOString().replace('T', ' ').slice(0, 19)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {g.wallet.slice(0, 6)}…{g.wallet.slice(-4)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-gray-500">
                      {g.grantedBy
                        ? `${g.grantedBy.slice(0, 6)}…${g.grantedBy.slice(-4)}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-gray-600 max-w-xs truncate">
                      {g.reason ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
