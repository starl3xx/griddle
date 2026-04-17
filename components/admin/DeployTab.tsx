'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useAccount,
  useChainId,
  useDeployContract,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from 'wagmi';
import { CheckCircle, CircleNotch, Rocket, Warning } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { griddlePremiumArtifact, wordOracleArtifact } from '@/lib/contracts/deploy/artifacts';
import { SWAP_RECIPE } from '@/lib/contracts/deploy/swap-recipe';
import type { Abi, Address, Hex } from 'viem';

// Base mainnet constants — match Deploy.s.sol.
const BASE_CHAIN_ID = 8453;
const JACKPOT_MANAGER_ADDRESS = '0xfcb0D07a5BB5B004A1580D5Ae903E33c4A79EdB5' as Address;
const ESCROW_MANAGER_ADDRESS = '0x2097D2C5127DF3f96876A360F4cbDAcfF82b9080' as Address;
const MAINNET_WORD    = '0x304e649e69979298BD1AEE63e175ADf07885fb4b' as Address;
const MAINNET_USDC    = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
const MAINNET_UR      = '0x6fF5693b99212Da76ad316178A184AB56D299b43' as Address;
const MAINNET_PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address;

type StepState = 'idle' | 'running' | 'done' | 'error';

interface DeployState {
  oracleAddress: Address | null;
  premiumAddress: Address | null;
  setSwapTx: Hex | null;
  approveEscrow: { txHash: Hex | null; noop: boolean; eoa: Address | null } | null;
  migration: { columns: string[] } | null;
}

/**
 * Admin Deploy tab — walks through the post-M5-usdc-premium rollout
 * with buttons instead of shell commands. The connected wallet
 * becomes the deployer + owner (signs the two on-chain txs in-browser
 * via wagmi). The server-side steps (escrow approve, DB migration)
 * hit admin-gated endpoints that use the Vercel env secrets directly.
 * No private keys ever leave your wallet or Vercel.
 */
export function DeployTab() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: BASE_CHAIN_ID });
  const { deployContractAsync } = useDeployContract();
  const { writeContractAsync } = useWriteContract();

  const [state, setState] = useState<DeployState>({
    oracleAddress: null,
    premiumAddress: null,
    setSwapTx: null,
    approveEscrow: null,
    migration: null,
  });
  const [steps, setSteps] = useState<Record<string, StepState>>({
    deploy: 'idle',
    recipe: 'idle',
    escrow: 'idle',
    migrate: 'idle',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const chainOk = chainId === BASE_CHAIN_ID;

  // ─── Step 1: deploy both contracts ─────────────────────────────
  const runDeploy = async () => {
    if (!publicClient || !address) return;
    if (!chainOk) {
      await switchChainAsync({ chainId: BASE_CHAIN_ID });
    }
    setSteps((s) => ({ ...s, deploy: 'running' }));
    setErrors((e) => ({ ...e, deploy: '' }));
    try {
      // 1a) deploy WordOracle
      const oracleHash = await deployContractAsync({
        abi: wordOracleArtifact.abi as Abi,
        bytecode: wordOracleArtifact.bytecode,
        args: [JACKPOT_MANAGER_ADDRESS],
      });
      const oracleReceipt = await publicClient.waitForTransactionReceipt({ hash: oracleHash });
      const oracleAddress = oracleReceipt.contractAddress;
      if (!oracleAddress) throw new Error('WordOracle deploy succeeded but receipt has no contractAddress');

      // 1b) deploy GriddlePremium
      const premiumHash = await deployContractAsync({
        abi: griddlePremiumArtifact.abi as Abi,
        bytecode: griddlePremiumArtifact.bytecode,
        args: [
          MAINNET_WORD,
          MAINNET_USDC,
          MAINNET_UR,
          MAINNET_PERMIT2,
          oracleAddress,
          ESCROW_MANAGER_ADDRESS,
          address, // owner = connected admin wallet
        ],
      });
      const premiumReceipt = await publicClient.waitForTransactionReceipt({ hash: premiumHash });
      const premiumAddress = premiumReceipt.contractAddress;
      if (!premiumAddress) throw new Error('GriddlePremium deploy succeeded but receipt has no contractAddress');

      setState((s) => ({ ...s, oracleAddress, premiumAddress }));
      setSteps((s) => ({ ...s, deploy: 'done' }));
    } catch (err) {
      setErrors((e) => ({ ...e, deploy: (err as Error).message }));
      setSteps((s) => ({ ...s, deploy: 'error' }));
    }
  };

  // ─── Step 2: commit swap recipe ───────────────────────────────
  const runSetSwap = async () => {
    if (!state.premiumAddress) return;
    if (!chainOk) {
      await switchChainAsync({ chainId: BASE_CHAIN_ID });
    }
    setSteps((s) => ({ ...s, recipe: 'running' }));
    setErrors((e) => ({ ...e, recipe: '' }));
    try {
      const hash = await writeContractAsync({
        address: state.premiumAddress,
        abi: griddlePremiumArtifact.abi as Abi,
        functionName: 'setSwapConfig',
        args: [SWAP_RECIPE.commands, SWAP_RECIPE.inputs],
      });
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash });
      }
      setState((s) => ({ ...s, setSwapTx: hash }));
      setSteps((s) => ({ ...s, recipe: 'done' }));
    } catch (err) {
      setErrors((e) => ({ ...e, recipe: (err as Error).message }));
      setSteps((s) => ({ ...s, recipe: 'error' }));
    }
  };

  // ─── Step 3: escrow approve (server) ──────────────────────────
  const runApprove = async () => {
    if (!state.premiumAddress) return;
    setSteps((s) => ({ ...s, escrow: 'running' }));
    setErrors((e) => ({ ...e, escrow: '' }));
    try {
      const res = await fetch('/api/admin/deploy/approve-escrow', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ premium: state.premiumAddress }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as {
        ok: boolean;
        noop: boolean;
        escrowEOA: Address;
        txHash?: Hex;
      };
      setState((s) => ({
        ...s,
        approveEscrow: { txHash: json.txHash ?? null, noop: json.noop, eoa: json.escrowEOA },
      }));
      setSteps((s) => ({ ...s, escrow: 'done' }));
    } catch (err) {
      setErrors((e) => ({ ...e, escrow: (err as Error).message }));
      setSteps((s) => ({ ...s, escrow: 'error' }));
    }
  };

  // ─── Step 4: DB migration (server) ────────────────────────────
  const runMigrate = async () => {
    setSteps((s) => ({ ...s, migrate: 'running' }));
    setErrors((e) => ({ ...e, migrate: '' }));
    try {
      const res = await fetch('/api/admin/deploy/migrate-db', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { ok: boolean; columnsPresent: string[] };
      setState((s) => ({ ...s, migration: { columns: json.columnsPresent } }));
      setSteps((s) => ({ ...s, migrate: 'done' }));
    } catch (err) {
      setErrors((e) => ({ ...e, migrate: (err as Error).message }));
      setSteps((s) => ({ ...s, migrate: 'error' }));
    }
  };

  const allDone = useMemo(
    () => Object.values(steps).every((s) => s === 'done'),
    [steps],
  );

  if (!isConnected || !address) {
    return (
      <Card>
        <Row label="Connect a wallet">
          Wallet is the deployer + owner of the new GriddlePremium. Its
          signature creates the contracts on-chain.
        </Row>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-accent/10 text-accent flex items-center justify-center">
            <Rocket className="h-5 w-5" weight="fill" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-gray-900">Deploy Griddle Premium (M5-usdc-premium)</div>
            <div className="text-xs text-gray-500 font-mono">
              Owner: {address.slice(0, 6)}…{address.slice(-4)}
              {' · '}
              Chain: {chainOk ? 'Base ✓' : <span className="text-rose-600">wrong chain — click any button to switch</span>}
            </div>
          </div>
        </div>
      </Card>

      <StepCard
        num={1}
        title="Deploy WordOracle + GriddlePremium"
        subtitle="Two on-chain txs from your wallet. Constructor wires Base USDC, Universal Router, Permit2, and the oracle."
        state={steps.deploy}
        error={errors.deploy}
        action={{ label: steps.deploy === 'done' ? 'Re-deploy (overwrites)' : 'Deploy', onClick: runDeploy }}
      >
        {state.oracleAddress && (
          <Row label="WordOracle">
            <Mono>{state.oracleAddress}</Mono>
            <Scan addr={state.oracleAddress} />
          </Row>
        )}
        {state.premiumAddress && (
          <Row label="GriddlePremium">
            <Mono>{state.premiumAddress}</Mono>
            <Scan addr={state.premiumAddress} />
          </Row>
        )}
      </StepCard>

      <StepCard
        num={2}
        title="Commit swap recipe"
        subtitle="One on-chain tx from owner wallet. Sets the Universal Router commands + inputs that drive the USDC → $WORD atomic swap."
        state={steps.recipe}
        error={errors.recipe}
        disabled={!state.premiumAddress}
        action={{ label: steps.recipe === 'done' ? 'Re-commit' : 'Set recipe', onClick: runSetSwap }}
      >
        {state.setSwapTx && (
          <Row label="setSwapConfig tx">
            <Mono>{state.setSwapTx}</Mono>
            <ScanTx hash={state.setSwapTx} />
          </Row>
        )}
      </StepCard>

      <StepCard
        num={3}
        title="Approve WORD allowance from escrow EOA"
        subtitle="Server-side — uses the ESCROW_MANAGER_PRIVATE_KEY already in Vercel. One tx from the escrow wallet granting the new contract permission to pull WORD from the stockpile for fiat unlocks."
        state={steps.escrow}
        error={errors.escrow}
        disabled={!state.premiumAddress}
        action={{ label: steps.escrow === 'done' ? 'Re-run' : 'Approve', onClick: runApprove }}
      >
        {state.approveEscrow && (
          <>
            <Row label="Escrow EOA">
              <Mono>{state.approveEscrow.eoa}</Mono>
            </Row>
            {state.approveEscrow.noop ? (
              <Row label="Allowance">Already at max — no tx needed.</Row>
            ) : state.approveEscrow.txHash ? (
              <Row label="Approve tx">
                <Mono>{state.approveEscrow.txHash}</Mono>
                <ScanTx hash={state.approveEscrow.txHash} />
              </Row>
            ) : null}
          </>
        )}
      </StepCard>

      <StepCard
        num={4}
        title="Run DB migration"
        subtitle="Server-side — adds the 6 payment telemetry columns to premium_users (usdc_amount, word_burned, escrow_status, escrow_open_tx, escrow_burn_tx, external_id). Idempotent via ADD COLUMN IF NOT EXISTS."
        state={steps.migrate}
        error={errors.migrate}
        action={{ label: steps.migrate === 'done' ? 'Re-run' : 'Migrate', onClick: runMigrate }}
      >
        {state.migration && (
          <Row label="Columns present">
            <span className="text-xs font-mono text-emerald-700">
              {state.migration.columns.join(', ')}
            </span>
          </Row>
        )}
      </StepCard>

      {allDone && state.premiumAddress && (
        <Card className="border-emerald-200 bg-emerald-50">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-emerald-700 flex-shrink-0 mt-0.5" weight="fill" />
            <div className="flex-1">
              <div className="font-semibold text-emerald-900">Deploy complete</div>
              <div className="text-sm text-emerald-900 mt-2">
                Next: add these env vars in Vercel (Production + Preview), then redeploy the web app.
              </div>
              <pre className="mt-3 p-3 rounded-md bg-white border border-emerald-200 text-xs font-mono overflow-x-auto">
{`NEXT_PUBLIC_GRIDDLE_PREMIUM_ADDRESS=${state.premiumAddress}
NEXT_PUBLIC_USDC_ADDRESS=${MAINNET_USDC}
BASE_RPC_URL=<server-only; your Alchemy URL>
CRON_SECRET=<any long random string; for sync-escrow-burns>`}
              </pre>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Small presentational pieces ──────────────────────────────────

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`border rounded-md bg-white p-4 ${className}`}>{children}</div>
  );
}

function StepCard({
  num,
  title,
  subtitle,
  state,
  error,
  action,
  disabled,
  children,
}: {
  num: number;
  title: string;
  subtitle: string;
  state: StepState;
  error?: string;
  action: { label: string; onClick: () => void };
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const statusColor =
    state === 'done' ? 'bg-emerald-100 text-emerald-800' :
    state === 'error' ? 'bg-rose-100 text-rose-800' :
    state === 'running' ? 'bg-amber-100 text-amber-800' :
    'bg-gray-100 text-gray-600';

  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-full font-bold text-sm flex items-center justify-center ${statusColor}`}>
          {state === 'running' ? <CircleNotch className="h-4 w-4 animate-spin" weight="bold" /> :
           state === 'done' ? <CheckCircle className="h-4 w-4" weight="fill" /> :
           state === 'error' ? <Warning className="h-4 w-4" weight="fill" /> :
           num}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900">{title}</div>
          <div className="text-xs text-gray-600 mt-0.5 leading-relaxed">{subtitle}</div>
          {children && <div className="mt-3 space-y-1">{children}</div>}
          {error && (
            <div className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5 break-all">
              {error}
            </div>
          )}
        </div>
        <div className="flex-shrink-0">
          <Button
            size="sm"
            onClick={action.onClick}
            disabled={disabled || state === 'running'}
            variant={state === 'done' ? 'outline' : 'default'}
          >
            {state === 'running' ? 'Running…' : action.label}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-xs text-gray-700 items-start">
      <div className="w-32 flex-shrink-0 font-medium text-gray-500">{label}</div>
      <div className="flex-1 min-w-0 break-all">{children}</div>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono">{children}</span>;
}

function Scan({ addr }: { addr: Address }) {
  return (
    <a
      href={`https://basescan.org/address/${addr}`}
      target="_blank"
      rel="noopener noreferrer"
      className="ml-2 text-blue-700 hover:underline"
    >
      basescan ↗
    </a>
  );
}

function ScanTx({ hash }: { hash: Hex }) {
  return (
    <a
      href={`https://basescan.org/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="ml-2 text-blue-700 hover:underline"
    >
      basescan ↗
    </a>
  );
}
