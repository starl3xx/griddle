'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useAccount,
  useDisconnect,
  usePublicClient,
  useSignTypedData,
  useWriteContract,
} from 'wagmi';
import { Crown, CircleNotch } from '@phosphor-icons/react';
import { griddlePremiumAbi, usdcAbi, wordOracleAbi } from '@/lib/contracts/griddlePremiumAbi';
import {
  getGriddlePremiumAddress,
  getUsdcAddress,
  CHAIN_ID,
} from '@/lib/contracts/addresses';
import { trackEvent } from '@/lib/funnel/client';
import { validateUsername, suggestUsernameFromWallet } from '@/lib/username';
import { EMAIL_RE } from '@/lib/email';

interface PremiumCryptoFlowProps {
  /** Called once /api/premium/verify confirms the unlock server-side. */
  onUnlocked: (wallet: string) => void;
  /** Called if the user closes / cancels the flow. */
  onCancel: () => void;
}

/**
 * Sentinel for the StaleOraclePrice pre-flight bail. Throwing a typed
 * error lets the top-level catch distinguish "contract would revert
 * because the LHAW market-cap cron has fallen behind" from every other
 * failure, so we can surface a retry-friendly message + fiat nudge
 * instead of dumping the user into the generic "Close" error pane.
 *
 * Matches the semantic of the on-chain check at GriddlePremium.sol:262,
 * performed client-side so we never ask the user for a permit signature
 * for a tx that's guaranteed to revert.
 */
class StaleOracleError extends Error {
  constructor() {
    super('stale-oracle-price');
    this.name = 'StaleOracleError';
  }
}

/** Matches the `MAX_ORACLE_AGE` constant on GriddlePremium. Kept in
 *  sync by hand — the contract reads from the same constant on-chain.
 *  If the contract value ever changes, update here too. */
const MAX_ORACLE_AGE_SECONDS = 5n * 60n;

type Phase =
  | 'identity'  // collecting handle (+ optional email) before tx
  | 'idle'      // waiting for user to click Unlock
  | 'quoting'   // fetching oracle price to floor minWordOut
  | 'signing'   // waiting for USDC permit signature
  | 'submitting' // waiting for on-chain tx broadcast
  | 'verifying' // waiting for server to verify the tx
  | 'done'      // unlock confirmed
  | 'error';

interface IdentityDraft {
  /** null when the client's /api/profile lookup says the profile
   *  already carries a handle — we hide the form + pass null so the
   *  server keeps the existing value. */
  handle: string | null;
  email: string | null;
}

/**
 * Crypto unlock flow (M5-usdc-premium + M6-premium-email-anchor).
 *
 * The user pays $5 USDC — the contract atomically swaps USDC → $WORD
 * via Uniswap Universal Router and burns the $WORD in the same
 * transaction. Premium is bound to the wallet via `premium_users`.
 *
 * Identity phase (M6): before the unlock tx fires, the user picks a
 * handle. This gives us a second durable anchor alongside the wallet
 * so the player still has an identity if they later lose the wallet
 * key. Email is collected optionally in the same form — when provided
 * it becomes a cross-device claim anchor for a later magic-link
 * sign-in. Users who are already signed in (profile with a handle
 * exists) skip straight to the tx.
 *
 * Tx steps:
 *   1. Quote — read WordOracle.getWordUsdPrice() client-side and floor
 *      `minWordOut` at 95% of the oracle-derived expected $WORD. The
 *      contract enforces the same 5% floor on-chain so the client only
 *      needs to stay inside it.
 *   2. Sign USDC permit — ERC-2612 EIP-712 signature over native Base
 *      USDC's domain (`name: "USD Coin"`, `version: "2"`). Authorizes
 *      GriddlePremium to pull exactly $5 USDC for one hour.
 *   3. Submit — call `unlockWithUsdc(deadline, v, r, s, minWordOut)`.
 *      Contract pulls USDC, swaps to $WORD, burns the proceeds, flips
 *      isPremium.
 *   4. Verify — POST `{txHash, handle, email}` to /api/premium/verify.
 *      The server reads the receipt, parses UnlockedWithUsdcSwap,
 *      validates the handle (profanity + shape), and upserts the
 *      premium_users row + the profile with the new identity anchors.
 */
export function PremiumCryptoFlow({ onUnlocked, onCancel }: PremiumCryptoFlowProps) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const publicClient = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();

  const [phase, setPhase] = useState<Phase>('identity');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // 'stale_oracle' flags the specific StaleOraclePrice revert case so
  // the error pane can render a retry button + a fiat nudge instead
  // of the generic "Close" CTA. Any other error (user reject, RPC
  // flake, handle collision) stays on 'generic'.
  const [errorKind, setErrorKind] = useState<'generic' | 'stale_oracle'>('generic');

  // Identity form state. `handle` is the input value; `identityDraft`
  // is the submitted-to-unlock snapshot the tx path reads.
  const [handleInput, setHandleInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [handleError, setHandleError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [identityDraft, setIdentityDraft] = useState<IdentityDraft | null>(null);
  const [identityLoading, setIdentityLoading] = useState(true);

  const premiumAddress = getGriddlePremiumAddress();
  const usdcAddress = getUsdcAddress();
  const contractsReady = !!premiumAddress;

  // Guard against kicking off the unlock twice — StrictMode re-runs
  // the identity-to-idle effect, and a network hiccup could re-trigger
  // handleUnlock if we watched phase directly.
  const unlockStartedRef = useRef(false);

  // Captures the on-chain txHash the moment `writeContractAsync`
  // resolves. If `/api/premium/verify` later returns 409 (handle
  // collision) we MUST NOT re-run the permit + swap + burn path —
  // the contract has no double-unlock guard, so the buyer would pay
  // $5 USDC twice. On 409 we bounce to the identity form but keep
  // this ref, and the retry path only re-calls the verify endpoint
  // with the new handle. A useRef (rather than useState) so a rapid
  // re-render after 409 doesn't briefly read an old snapshot.
  const paidTxHashRef = useRef<string | null>(null);

  // Signals the user that the optional email they typed collided with
  // an existing profile — premium is still active, but the email
  // wasn't saved to their profile. Populated by the verify response;
  // rendered in the success pane.
  const [emailTakenNotice, setEmailTakenNotice] = useState(false);

  // ────────────────────────────────────────────────────────────────
  // Identity preflight: see if the user already has a handle.
  // ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isConnected || !address) return;
    let cancelled = false;
    setIdentityLoading(true);
    (async () => {
      try {
        const res = await fetch('/api/profile');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          profile: { handle: string | null; email: string | null } | null;
        };
        if (cancelled) return;
        const existingHandle = data.profile?.handle?.trim() ?? null;
        const existingEmail = data.profile?.email?.trim() ?? null;
        if (existingHandle) {
          // Already has a handle — skip the form.
          setIdentityDraft({ handle: null, email: null });
          setPhase('idle');
        } else {
          // Seed the handle suggestion from the wallet + prefill any
          // email we already know about (signed-in-but-no-handle case).
          setHandleInput(suggestUsernameFromWallet(address));
          if (existingEmail) setEmailInput(existingEmail);
          setPhase('identity');
        }
      } catch (err) {
        if (cancelled) return;
        // Profile lookup failure shouldn't block the unlock — fall
        // through to the identity form with a wallet-derived handle
        // suggestion. The server will validate it on submit.
        console.warn('[PremiumCryptoFlow] /api/profile failed — falling back to identity form', err);
        setHandleInput(suggestUsernameFromWallet(address));
        setPhase('identity');
      } finally {
        if (!cancelled) setIdentityLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isConnected, address]);

  // ────────────────────────────────────────────────────────────────
  // Server-side verify, with the 404-retry loop and 409 short-circuit.
  // Shared between:
  //   (a) initial unlock — called with a fresh txHash from the just-
  //       landed on-chain payment
  //   (b) 409 recovery — called with the cached `paidTxHashRef` txHash
  //       after the user picks a new handle; does NOT re-run the
  //       payment flow (the burn already settled on the first pass).
  // Returns a discriminated result so the caller can branch on
  // handle-taken vs. success vs. generic failure without re-parsing
  // the Response.
  // ────────────────────────────────────────────────────────────────
  const callVerify = useCallback(
    async (
      txHash: string,
      draft: IdentityDraft,
    ): Promise<
      | { kind: 'ok'; wallet: string; emailTaken: boolean }
      | { kind: 'handle_taken'; error: string }
      | { kind: 'error'; error: string }
    > => {
      let verifyResult: Response | null = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        verifyResult = await fetch('/api/premium/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            txHash,
            ...(draft.handle ? { handle: draft.handle } : {}),
            ...(draft.email ? { email: draft.email } : {}),
          }),
        });
        if (verifyResult.ok) break;
        if (verifyResult.status === 409) break;
        if (verifyResult.status !== 404) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      if (!verifyResult) {
        return { kind: 'error', error: 'no response' };
      }

      if (verifyResult.status === 409) {
        const body = (await verifyResult.json().catch(() => ({}))) as {
          error?: string; code?: string;
        };
        if (body.code === 'handle_taken') {
          return { kind: 'handle_taken', error: body.error ?? 'That username is taken.' };
        }
        return { kind: 'error', error: body.error ?? 'Conflict during verify.' };
      }

      if (!verifyResult.ok) {
        const text = await verifyResult.text().catch(() => 'verify failed');
        return { kind: 'error', error: text };
      }

      const body = (await verifyResult.json()) as { wallet: string; emailTaken?: boolean };
      return { kind: 'ok', wallet: body.wallet, emailTaken: !!body.emailTaken };
    },
    [],
  );

  // ────────────────────────────────────────────────────────────────
  // 409 recovery — user picked a new handle after a collision. The
  // payment has already landed on-chain (txHash is cached in
  // paidTxHashRef), so we only need to re-hit the verify endpoint.
  // ────────────────────────────────────────────────────────────────
  const retryVerify = useCallback(async (draft: IdentityDraft) => {
    const txHash = paidTxHashRef.current;
    if (!txHash) {
      // Shouldn't happen — the identity submit handler guards this —
      // but defend against a rogue state by bailing loudly.
      setErrorMessage('Lost track of the payment. Refresh to retry.');
      setPhase('error');
      return;
    }
    setPhase('verifying');
    const result = await callVerify(txHash, draft);
    if (result.kind === 'ok') {
      setEmailTakenNotice(result.emailTaken);
      paidTxHashRef.current = null;
      setPhase('done');
      onUnlocked(result.wallet);
      return;
    }
    if (result.kind === 'handle_taken') {
      setHandleError(result.error);
      // unlockStartedRef stays true — the on-chain tx is non-repeatable;
      // this flag's only job was to gate the effect from calling
      // handleUnlock again, and we never want it to do that anyway
      // now that paidTxHashRef is set.
      setPhase('identity');
      return;
    }
    setErrorMessage(result.error);
    setPhase('error');
    trackEvent({ name: 'checkout_failed', method: 'crypto', reason: 'verify_failed' });
  }, [callVerify, onUnlocked]);

  // ────────────────────────────────────────────────────────────────
  // Unlock tx — runs once phase transitions to 'idle' with a draft.
  // ────────────────────────────────────────────────────────────────
  const handleUnlock = useCallback(async (draft: IdentityDraft) => {
    setErrorMessage(null);

    if (!isConnected || !address) {
      setErrorMessage('Connect a wallet first.');
      setPhase('error');
      return;
    }
    if (!premiumAddress || !publicClient) {
      setErrorMessage('Crypto checkout is not configured yet.');
      setPhase('error');
      return;
    }

    // Phase mirror that the catch can read synchronously — setPhase is
    // async and `phase` from useState would be stale on the first throw.
    let currentPhase: Phase = 'idle';

    try {
      // --- Step 1: quote + floor minWordOut ------------------------------
      currentPhase = 'quoting';
      setPhase('quoting');

      const [oracleAddress, unlockUsd, usdcAmount] = await Promise.all([
        publicClient.readContract({
          address: premiumAddress,
          abi: griddlePremiumAbi,
          functionName: 'oracle',
        }),
        publicClient.readContract({
          address: premiumAddress,
          abi: griddlePremiumAbi,
          functionName: 'UNLOCK_USD',
        }),
        publicClient.readContract({
          address: premiumAddress,
          abi: griddlePremiumAbi,
          functionName: 'USDC_UNLOCK_AMOUNT',
        }),
      ]);

      const [price, updatedAt] = await publicClient.readContract({
        address: oracleAddress as `0x${string}`,
        abi: wordOracleAbi,
        functionName: 'getWordUsdPrice',
      });

      if (price === 0n) {
        throw new Error('Oracle returned zero price. Try again in a moment.');
      }

      // Pre-flight the staleness check that GriddlePremium runs on-chain
      // at `unlockWithUsdc`. Without this, if the LHAW market-cap cron
      // falls behind >5 minutes, the user signs a permit and then the
      // tx reverts — they see a cryptic wallet-level error and no money
      // moved. Checking client-side means we bail before the signature
      // prompt and can show a retry-friendly message. Uses the latest
      // block's timestamp (matches what the contract sees) rather than
      // Date.now() to avoid clock-skew false positives.
      const latestBlock = await publicClient.getBlock();
      if (latestBlock.timestamp - updatedAt > MAX_ORACLE_AGE_SECONDS) {
        throw new StaleOracleError();
      }

      // Mirror the contract's floor:
      //     expected   = (UNLOCK_USD * 1e18) / price      (18-dec $WORD wei)
      //     minWordOut = expected * 95 / 100              (5% slippage floor)
      // Client can send any value >= minWordOut; contract reverts otherwise.
      const expected = (unlockUsd * 10n ** 18n) / price;
      const minWordOut = (expected * 95n) / 100n;

      // --- Step 2: sign USDC permit --------------------------------------
      currentPhase = 'signing';
      setPhase('signing');

      const [nonce, tokenName, tokenVersion] = await Promise.all([
        publicClient.readContract({
          address: usdcAddress,
          abi: usdcAbi,
          functionName: 'nonces',
          args: [address],
        }),
        publicClient.readContract({
          address: usdcAddress,
          abi: usdcAbi,
          functionName: 'name',
        }),
        publicClient
          .readContract({
            address: usdcAddress,
            abi: usdcAbi,
            functionName: 'version',
          })
          .catch(() => '2'), // native Base USDC's EIP-712 domain version is "2"
      ]);

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

      const signature = await signTypedDataAsync({
        domain: {
          name: tokenName,
          version: tokenVersion,
          chainId: CHAIN_ID,
          verifyingContract: usdcAddress,
        },
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Permit',
        message: {
          owner: address,
          spender: premiumAddress,
          value: usdcAmount,
          nonce,
          deadline,
        },
      });

      const sig = signature.slice(2);
      const r = (`0x${sig.slice(0, 64)}`) as `0x${string}`;
      const s = (`0x${sig.slice(64, 128)}`) as `0x${string}`;
      const v = parseInt(sig.slice(128, 130), 16);

      // --- Step 3: submit tx --------------------------------------------
      currentPhase = 'submitting';
      setPhase('submitting');

      trackEvent({ name: 'checkout_started', method: 'crypto' });

      const txHash = await writeContractAsync({
        address: premiumAddress,
        abi: griddlePremiumAbi,
        functionName: 'unlockWithUsdc',
        args: [deadline, v, r, s, minWordOut],
      });

      // Cache the hash BEFORE the verify call so a 409 never loses it.
      // From this point on any re-submit from the identity form takes
      // the retryVerify path — handleUnlock will never run again for
      // this component instance (guarded by the paidTxHashRef check
      // in the phase effect below).
      paidTxHashRef.current = txHash;

      // --- Step 4: verify server-side -----------------------------------
      currentPhase = 'verifying';
      setPhase('verifying');

      const result = await callVerify(txHash, draft);

      if (result.kind === 'handle_taken') {
        setHandleError(result.error);
        setPhase('identity');
        return;
      }

      if (result.kind === 'error') {
        throw new Error(`Server verify failed: ${result.error}`);
      }

      setEmailTakenNotice(result.emailTaken);
      paidTxHashRef.current = null;
      setPhase('done');
      onUnlocked(result.wallet);
    } catch (err) {
      let reason: string = 'unknown';
      if (err instanceof StaleOracleError) {
        setErrorKind('stale_oracle');
        setErrorMessage(
          'The $WORD price feed is catching up. This usually clears within a minute — try again, or pay with card instead.',
        );
        reason = 'stale_oracle';
      } else {
        const message = err instanceof Error ? err.message : 'unlock failed';
        // Zombie wagmi connector from stale cookie storage — see the
        // rationale in AutoConnectMiniapp. Forcing disconnect here lets
        // the auto-reconnect effect re-fire with a real Farcaster
        // connector on next tick; showing a targeted "try again"
        // message instead of the raw stack keeps the user moving.
        const isZombieConnector =
          err instanceof Error && /getChainId is not a function/i.test(err.message);
        setErrorKind('generic');
        if (isZombieConnector) {
          disconnect();
          setErrorMessage('Wallet connection hiccup — tap Unlock again in a moment.');
          reason = 'zombie_connector';
        } else {
          setErrorMessage(message);
          const isUserReject =
            err instanceof Error &&
            (err.name === 'UserRejectedRequestError' || /rejected|denied|user rejected/i.test(err.message));
          if (isUserReject) reason = 'user_rejected';
          else if (currentPhase === 'quoting') reason = 'quote_failed';
          else if (currentPhase === 'signing') reason = 'sign_failed';
          else if (currentPhase === 'submitting') reason = 'submit_failed';
          else if (currentPhase === 'verifying') reason = 'verify_failed';
        }
      }
      trackEvent({ name: 'checkout_failed', method: 'crypto', reason });
      setPhase('error');
    }
  }, [address, disconnect, isConnected, onUnlocked, premiumAddress, publicClient, signTypedDataAsync, usdcAddress, writeContractAsync, callVerify]);

  // Effect that reacts to phase='idle' with an identity draft:
  //
  //   - First submit: no txHash cached → run the full handleUnlock
  //     (quote → permit → swap → verify). unlockStartedRef prevents
  //     StrictMode's double-invoke from submitting twice.
  //
  //   - After 409: paidTxHashRef already holds the on-chain hash →
  //     retryVerify only. This is the invariant that prevents the
  //     double-charge: handleUnlock is NEVER called once paidTxHashRef
  //     is set.
  useEffect(() => {
    if (phase !== 'idle') return;
    if (!identityDraft) return;
    if (!isConnected || !contractsReady) return;
    if (paidTxHashRef.current) {
      // Retry path — the payment already landed. Fire and forget;
      // retryVerify manages its own phase transitions.
      retryVerify(identityDraft);
      return;
    }
    if (unlockStartedRef.current) return;
    unlockStartedRef.current = true;
    handleUnlock(identityDraft);
  }, [phase, identityDraft, isConnected, contractsReady, handleUnlock, retryVerify]);

  // Retry entry point from the stale-oracle error pane. Safe because
  // the staleness check lives in the quoting phase — we throw BEFORE
  // signing the permit and BEFORE writeContractAsync fires, so
  // paidTxHashRef is still null and handleUnlock is re-entrant. Reset
  // the unlock-started ref and bounce phase through 'idle' so the
  // existing phase effect re-invokes handleUnlock with the same draft.
  const retryQuote = useCallback(() => {
    if (!identityDraft) return;
    setErrorMessage(null);
    setErrorKind('generic');
    unlockStartedRef.current = false;
    setPhase('idle');
  }, [identityDraft]);

  const handleIdentitySubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    setHandleError(null);
    setEmailError(null);

    const handle = handleInput.trim().toLowerCase();
    const validation = validateUsername(handle);
    if (!validation.valid) {
      setHandleError(validation.error ?? 'invalid username');
      return;
    }

    const email = emailInput.trim();
    if (email.length > 0 && !EMAIL_RE.test(email)) {
      setEmailError('That email doesn’t look right.');
      return;
    }

    setIdentityDraft({ handle, email: email.length > 0 ? email.toLowerCase() : null });
    setPhase('idle');
  };

  const statusText = (() => {
    switch (phase) {
      case 'identity':
        return 'Pick a username';
      case 'idle':
        return 'Preparing…';
      case 'quoting':
        return 'Getting today’s $WORD price…';
      case 'signing':
        return 'Sign the $5 USDC permit in your wallet';
      case 'submitting':
        return 'Swapping USDC → $WORD and burning…';
      case 'verifying':
        return 'Confirming the burn…';
      case 'done':
        return 'Premium unlocked!';
      case 'error':
        return errorMessage ?? 'Something went wrong.';
    }
  })();

  const inProgress =
    phase !== 'identity' && phase !== 'idle' && phase !== 'done' && phase !== 'error';

  if (phase === 'identity') {
    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 rounded-full bg-accent/15 text-accent flex items-center justify-center">
            <Crown className="w-6 h-6" weight="fill" aria-hidden />
          </div>
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
            Choose your username
          </h3>
          <p className="text-xs font-medium text-gray-500 text-center">
            Locks in your leaderboard identity before you pay. Add an email to claim premium on any device.
          </p>
        </div>

        {identityLoading ? (
          <div className="flex items-center justify-center py-4">
            <CircleNotch className="w-5 h-5 animate-spin text-gray-400" weight="bold" aria-hidden />
          </div>
        ) : (
          <form onSubmit={handleIdentitySubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                Username
              </span>
              <input
                type="text"
                value={handleInput}
                onChange={(e) => {
                  setHandleInput(e.target.value);
                  setHandleError(null);
                }}
                required
                autoFocus
                inputMode="text"
                autoCapitalize="none"
                autoComplete="username"
                spellCheck={false}
                maxLength={32}
                placeholder="griddle_pro"
                className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              {handleError && (
                <span className="text-[11px] font-semibold text-error-700">{handleError}</span>
              )}
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
                Email <span className="font-medium normal-case text-gray-400">(optional)</span>
              </span>
              <input
                type="email"
                value={emailInput}
                onChange={(e) => {
                  setEmailInput(e.target.value);
                  setEmailError(null);
                }}
                autoComplete="email"
                spellCheck={false}
                maxLength={254}
                placeholder="you@example.com"
                className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              {emailError && (
                <span className="text-[11px] font-semibold text-error-700">{emailError}</span>
              )}
            </label>

            <div className="flex gap-2 mt-1">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 rounded-md bg-accent text-white px-3 py-2 text-sm font-bold hover:bg-accent/90 transition-colors"
              >
                Continue to pay
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 p-4">
      <div className="w-12 h-12 rounded-full bg-accent/15 text-accent flex items-center justify-center">
        {inProgress ? (
          <CircleNotch className="w-6 h-6 animate-spin" weight="bold" aria-hidden />
        ) : (
          <Crown className="w-6 h-6" weight="fill" aria-hidden />
        )}
      </div>
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 text-center">{statusText}</p>
      {phase === 'done' && emailTakenNotice && (
        <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 text-center max-w-xs">
          Your email was already on another Griddle account, so we didn’t save it to this profile. You can still claim premium here.
        </p>
      )}
      {phase === 'error' && errorKind === 'stale_oracle' && (
        <div className="flex flex-col items-stretch gap-2 w-full max-w-xs">
          <button
            type="button"
            onClick={retryQuote}
            className="rounded-md bg-accent text-white px-3 py-2 text-sm font-bold hover:bg-accent/90 transition-colors"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-[12px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            Pay with card instead
          </button>
        </div>
      )}
      {phase === 'error' && errorKind === 'generic' && (
        <button type="button" onClick={onCancel} className="btn-secondary text-sm">
          Close
        </button>
      )}
    </div>
  );
}
