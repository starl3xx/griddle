'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CircleNotch, ArrowClockwise, CheckCircle, Warning, Copy, Rocket } from '@phosphor-icons/react';

interface OracleStatus {
  /** True when the oracle_config table doesn't exist yet (0022 migration
   *  not applied). UI shows the "Apply DB migration" button in this
   *  state instead of the normal config form. */
  needsMigration?: boolean;
  config: {
    poolId: string;
    cronEnabled: boolean;
    updatedAt: string;
    updatedBy: string | null;
  } | null;
  oracleAddress: string | null;
  updaterAddress: string | null;
  onChain: {
    price: string | null;
    updatedAt: number | null;
    stalenessSec: number | null;
    expectedUpdater: string | null;
    updaterBalanceEth: string | null;
    error: string | null;
  };
}

/**
 * Oracle tab — operator console for the PushedWordOracle pipeline.
 *
 * Shows a live status card (contract address, updater EOA address +
 * balance, last on-chain price + timestamp + derived staleness) so the
 * operator can spot a silent cron failure without digging into Vercel
 * logs. Editable config (pool id, cron enabled toggle) persists to
 * `oracle_config` and takes effect on the next cron tick — the cron
 * route re-reads config per invocation. "Force update now" runs a
 * one-off push regardless of the enabled toggle, for pipeline
 * verification before flipping the cron on.
 *
 * Private keys are NOT managed here. `ORACLE_UPDATER_PRIVATE_KEY`
 * lives in Vercel env; this tab shows only the derived address + its
 * current ETH balance. Rotate via Vercel dashboard if ever needed.
 */
export function OracleTab() {
  const [status, setStatus] = useState<OracleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [poolIdDraft, setPoolIdDraft] = useState('');
  const [cronEnabledDraft, setCronEnabledDraft] = useState(true);
  const [saving, setSaving] = useState(false);
  const [forcing, setForcing] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<
    { oracleAddress: string; txHash: string } | null
  >(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrateError, setMigrateError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/oracle', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const json = (await res.json()) as OracleStatus;
      setStatus(json);
      if (json.config) {
        setPoolIdDraft(json.config.poolId);
        setCronEnabledDraft(json.config.cronEnabled);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchStatus();
  }, []);

  const saveConfig = async () => {
    setSaving(true);
    setActionResult(null);
    try {
      const res = await fetch('/api/admin/oracle', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ poolId: poolIdDraft, cronEnabled: cronEnabledDraft }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Save failed (${res.status})`);
      }
      setActionResult('Config saved.');
      await fetchStatus();
    } catch (err) {
      setActionResult(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const applyMigration = async () => {
    if (migrating) return;
    setMigrating(true);
    setMigrateError(null);
    try {
      const res = await fetch('/api/admin/deploy/migrate-oracle-config', {
        method: 'POST',
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean; error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? `Migration failed (${res.status})`);
      }
      // Re-fetch status to flip out of the needsMigration state.
      await fetchStatus();
    } catch (err) {
      setMigrateError(err instanceof Error ? err.message : 'Migration failed');
    } finally {
      setMigrating(false);
    }
  };

  const deployOracle = async () => {
    if (deploying) return;
    setDeploying(true);
    setDeployError(null);
    setDeployResult(null);
    try {
      const res = await fetch('/api/admin/oracle/deploy', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        oracleAddress?: string;
        txHash?: string;
        error?: string;
      };
      if (!res.ok || !body.ok || !body.oracleAddress || !body.txHash) {
        throw new Error(body.error ?? `Deploy failed (${res.status})`);
      }
      setDeployResult({ oracleAddress: body.oracleAddress, txHash: body.txHash });
      // Address is live in DB now; refetch so the status card shows it
      // and the cron path picks it up immediately.
      setTimeout(() => void fetchStatus(), 1500);
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : 'Deploy failed');
    } finally {
      setDeploying(false);
    }
  };

  const forceUpdate = async () => {
    setForcing(true);
    setActionResult(null);
    try {
      const res = await fetch('/api/admin/oracle/force-update', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean; txHash?: string; priceUsd?: number; error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? `Force update failed (${res.status})`);
      }
      setActionResult(
        `Pushed $${body.priceUsd?.toFixed(8)} — tx ${body.txHash?.slice(0, 10)}…`,
      );
      // Give the chain a beat to register before refetching status.
      setTimeout(() => void fetchStatus(), 2500);
    } catch (err) {
      setActionResult(err instanceof Error ? err.message : 'Force update failed');
    } finally {
      setForcing(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center py-12">
        <CircleNotch className="w-6 h-6 animate-spin text-gray-400" weight="bold" />
      </div>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-semibold text-error-700">{error}</p>
        </CardContent>
      </Card>
    );
  }
  if (!status) return null;

  const { config, oracleAddress, updaterAddress, onChain } = status;

  // Staleness interpretation: GriddlePremium enforces a 5-minute window.
  // Anything over 4 minutes is a warning (approaching stale); under 2
  // minutes is healthy; between is yellow.
  const stale = onChain.stalenessSec ?? null;
  const staleColor =
    stale === null ? 'text-gray-500'
    : stale > 240 ? 'text-error-700'
    : stale > 120 ? 'text-amber-600 dark:text-amber-400'
    : 'text-emerald-700 dark:text-emerald-400';

  // Mismatch detection: the oracle's on-chain `updater` should equal
  // the address derived from our private key. Surfaces key rotation
  // drift (key updated in Vercel but oracle still points at old EOA).
  const updaterMismatch =
    onChain.expectedUpdater && updaterAddress &&
    onChain.expectedUpdater.toLowerCase() !== updaterAddress.toLowerCase();

  // Premium contract address for the setOracle command — shown after
  // a successful deploy. Read from the same public env the wallet-side
  // code uses; the admin dashboard isn't surfacing other contract
  // addresses yet so there's no shared helper to reuse.
  const premiumAddress = process.env.NEXT_PUBLIC_GRIDDLE_PREMIUM_ADDRESS ?? '$GRIDDLE_PREMIUM_ADDRESS';
  const castCommand = deployResult
    ? `cast send ${premiumAddress} "setOracle(address)" ${deployResult.oracleAddress} --rpc-url $BASE_RPC_URL --private-key $PRIVATE_KEY`
    : '';

  return (
    <div className="space-y-6">
      {/* Migration — only shown on first visit to an env that's never run 0022 */}
      {status.needsMigration && (
        <Card>
          <CardContent className="p-4 space-y-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <div className="flex items-start gap-2">
              <Warning className="w-5 h-5 mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" weight="fill" />
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                  Database migration needed
                </h3>
                <p className="text-[12px] text-amber-800 dark:text-amber-300 mt-1 leading-relaxed">
                  The <code>oracle_config</code> table hasn't been created yet.
                  Click below to apply the 0022 migration to this environment's
                  Neon database. One-time per environment; safe to retry.
                </p>
              </div>
            </div>
            <Button variant="default" size="sm" onClick={applyMigration} disabled={migrating}>
              {migrating ? <CircleNotch className="w-4 h-4 animate-spin" weight="bold" /> : <CheckCircle className="w-4 h-4" weight="bold" />}
              Apply DB migration
            </Button>
            {migrateError && (
              <p className="text-[12px] font-semibold text-error-700 dark:text-error-300">{migrateError}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Deploy */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500">
            Deploy PushedWordOracle
          </h3>
          <p className="text-[12px] text-gray-600 dark:text-gray-400 leading-relaxed">
            {oracleAddress ? (
              <>
                Already deployed at <code className="font-mono">{oracleAddress}</code>. Redeploy only
                if the contract source has changed or you need to rotate the updater EOA —
                you'd have to rerun <code>setOracle</code> on GriddlePremium after.
              </>
            ) : (
              <>
                Deploys the oracle contract from the server using the
                funded updater EOA. No CLI or local Foundry needed. After
                the tx lands you'll get a <code>cast send setOracle(…)</code> command
                to run from your owner wallet — that last step can't be
                server-side because GriddlePremium's owner gate requires
                your signature.
              </>
            )}
          </p>

          <Button variant="default" size="sm" onClick={deployOracle} disabled={deploying}>
            {deploying ? <CircleNotch className="w-4 h-4 animate-spin" weight="bold" /> : <Rocket className="w-4 h-4" weight="bold" />}
            {oracleAddress ? 'Redeploy oracle' : 'Deploy oracle'}
          </Button>

          {deployError && (
            <div className="flex items-start gap-2 rounded-md bg-error-50 dark:bg-error-900/30 border border-error-200 dark:border-error-800 px-3 py-2 text-[12px] text-error-700 dark:text-error-300">
              <Warning className="w-4 h-4 mt-0.5 shrink-0" weight="bold" />
              <div>{deployError}</div>
            </div>
          )}

          {deployResult && (
            <div className="space-y-2 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2.5">
              <div className="flex items-start gap-2 text-[12px] text-emerald-800 dark:text-emerald-200">
                <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" weight="fill" />
                <div>
                  Deployed to{' '}
                  <a
                    href={`https://basescan.org/address/${deployResult.oracleAddress}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono underline"
                  >
                    {deployResult.oracleAddress}
                  </a>
                  {' '}(tx{' '}
                  <a
                    href={`https://basescan.org/tx/${deployResult.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono underline"
                  >
                    {deployResult.txHash.slice(0, 10)}…
                  </a>
                  ). Now run this from your owner wallet to point GriddlePremium at it:
                </div>
              </div>
              <div className="relative">
                <pre className="overflow-x-auto rounded bg-gray-900 text-gray-100 text-[11px] font-mono p-2.5 pr-9">
                  {castCommand}
                </pre>
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard.writeText(castCommand); }}
                  title="Copy"
                  className="absolute top-2 right-2 text-gray-400 hover:text-white"
                >
                  <Copy className="w-3.5 h-3.5" weight="bold" />
                </button>
              </div>
              {premiumAddress.startsWith('$') && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  <code>NEXT_PUBLIC_GRIDDLE_PREMIUM_ADDRESS</code> isn't set in env — replace the placeholder in the command with your deployed GriddlePremium address.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Live status */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500">
              Live status
            </h3>
            <Button variant="outline" size="sm" onClick={fetchStatus} disabled={loading}>
              <ArrowClockwise className={loading ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} weight="bold" />
              Refresh
            </Button>
          </div>

          <StatusRow label="Oracle contract">
            <AddressLink address={oracleAddress} />
          </StatusRow>

          <StatusRow label="Updater EOA (cron signer)">
            <AddressLink address={updaterAddress} />
            {onChain.updaterBalanceEth !== null && (
              <span className="ml-2 text-[11px] font-mono text-gray-500">
                {parseFloat(onChain.updaterBalanceEth).toFixed(5)} ETH
              </span>
            )}
          </StatusRow>

          {updaterMismatch && (
            <div className="flex items-start gap-2 rounded-md bg-error-50 dark:bg-error-900/30 border border-error-200 dark:border-error-800 px-3 py-2 text-[12px] text-error-700 dark:text-error-300">
              <Warning className="w-4 h-4 mt-0.5 shrink-0" weight="bold" />
              <div>
                On-chain <code>updater</code> ({onChain.expectedUpdater}) ≠ the
                address derived from <code>ORACLE_UPDATER_PRIVATE_KEY</code>{' '}
                ({updaterAddress}). The cron will fail with NotUpdater until
                the key is rotated or the oracle is replaced.
              </div>
            </div>
          )}

          <StatusRow label="Last price">
            {onChain.price ? (
              <span className="font-mono text-sm text-gray-900 dark:text-gray-100">
                ${formatPrice18(onChain.price)}
                <span className="ml-2 text-[11px] text-gray-400">({onChain.price} wei)</span>
              </span>
            ) : (
              <span className="text-gray-400 italic">never set</span>
            )}
          </StatusRow>

          <StatusRow label="Last updated">
            {onChain.updatedAt ? (
              <span className={`font-mono text-sm ${staleColor}`}>
                {formatRelative(stale)} ({new Date(onChain.updatedAt * 1000).toISOString()})
              </span>
            ) : (
              <span className="text-gray-400 italic">never</span>
            )}
          </StatusRow>

          {onChain.error && (
            <div className="flex items-start gap-2 rounded-md bg-error-50 dark:bg-error-900/30 border border-error-200 dark:border-error-800 px-3 py-2 text-[12px] text-error-700 dark:text-error-300">
              <Warning className="w-4 h-4 mt-0.5 shrink-0" weight="bold" />
              <div>On-chain read failed: {onChain.error}</div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Config */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500">Config</h3>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
              GeckoTerminal pool id
            </span>
            <input
              type="text"
              value={poolIdDraft}
              onChange={(e) => setPoolIdDraft(e.target.value)}
              placeholder="0x..."
              spellCheck={false}
              className="font-mono text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand"
            />
            <span className="text-[11px] text-gray-500">
              0x-prefixed hex. v4 pools are 64 hex chars; v3 pools are 40. Changes take effect on the next cron tick.
            </span>
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={cronEnabledDraft}
              onChange={(e) => setCronEnabledDraft(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Cron enabled
            </span>
            <span className="text-[11px] text-gray-500 ml-auto">
              (Force-update below works regardless of this toggle.)
            </span>
          </label>

          <div className="flex gap-2 pt-2">
            <Button variant="default" size="sm" onClick={saveConfig} disabled={saving}>
              {saving ? <CircleNotch className="w-4 h-4 animate-spin" weight="bold" /> : <CheckCircle className="w-4 h-4" weight="bold" />}
              Save config
            </Button>
            <Button variant="outline" size="sm" onClick={forceUpdate} disabled={forcing}>
              {forcing ? <CircleNotch className="w-4 h-4 animate-spin" weight="bold" /> : <ArrowClockwise className="w-4 h-4" weight="bold" />}
              Force update now
            </Button>
          </div>

          {actionResult && (
            <p className="text-[12px] font-semibold text-gray-700 dark:text-gray-300">{actionResult}</p>
          )}

          {config?.updatedBy && (
            <p className="text-[11px] text-gray-400">
              Last config edit by {config.updatedBy.slice(0, 6)}…{config.updatedBy.slice(-4)} at{' '}
              {new Date(config.updatedAt).toLocaleString()}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 w-48 shrink-0">
        {label}
      </span>
      <div className="flex items-center flex-wrap gap-1 min-w-0">{children}</div>
    </div>
  );
}

function AddressLink({ address }: { address: string | null }) {
  if (!address) return <span className="text-gray-400 italic">not configured</span>;
  return (
    <>
      <a
        href={`https://basescan.org/address/${address}`}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-xs text-brand hover:underline truncate"
      >
        {address}
      </a>
      <button
        type="button"
        onClick={() => { void navigator.clipboard.writeText(address); }}
        title="Copy"
        className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
      >
        <Copy className="w-3.5 h-3.5" weight="bold" />
      </button>
    </>
  );
}

/**
 * Format a bigint-wei 18-decimal price as a human dollar string.
 * We need up to ~8 decimals of precision for small-cap tokens
 * ($WORD is ~$0.00000035 range at current market cap).
 */
function formatPrice18(wei: string): string {
  const n = BigInt(wei);
  const whole = n / 10n ** 18n;
  const frac = n % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, '0').slice(0, 10).replace(/0+$/, '');
  return fracStr.length > 0 ? `${whole}.${fracStr}` : whole.toString();
}

function formatRelative(sec: number | null): string {
  if (sec === null) return '—';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s ago`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m ago`;
}
