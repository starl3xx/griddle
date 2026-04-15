'use client';

import { useEffect, useState } from 'react';
import { useAccount, usePublicClient, useSignTypedData, useWriteContract } from 'wagmi';
import { Diamond, CircleNotch } from '@phosphor-icons/react';
import { griddlePremiumAbi, wordOracleAbi } from '@/lib/contracts/griddlePremiumAbi';
import { wordTokenAbi } from '@/lib/contracts/wordTokenAbi';
import {
  getGriddlePremiumAddress,
  getWordTokenAddress,
  CHAIN_ID,
} from '@/lib/contracts/addresses';
import { trackEvent } from '@/lib/funnel/client';

interface PremiumCryptoFlowProps {
  /** Called once /api/premium/verify confirms the unlock server-side. */
  onUnlocked: (wallet: string) => void;
  /** Called if the user closes / cancels the flow. */
  onCancel: () => void;
}

type Phase =
  | 'idle' // waiting for user to click Unlock
  | 'quoting' // fetching oracle price + token amount
  | 'signing' // waiting for permit signature
  | 'submitting' // waiting for on-chain tx broadcast
  | 'verifying' // waiting for server to verify the tx
  | 'done' // unlock confirmed
  | 'error';

/**
 * The real crypto unlock flow. Lives inside WalletProvider so it can use
 * wagmi hooks (`useAccount`, `useSignTypedData`, `useWriteContract`).
 * Lazy-imported via `LazyPremiumCryptoFlow` so the wagmi bundle only
 * loads when the user actually clicks "Pay with crypto".
 *
 * Steps:
 *   1. Quote — read WordOracle.getWordUsdPrice() + UNLOCK_USD + SLIPPAGE_PCT
 *      from the contract to compute the target $WORD amount. We send the
 *      midpoint so the contract's symmetric ±15% band is centered on it.
 *   2. Sign permit — ERC-2612 EIP-712 signTypedData over the $WORD
 *      permit domain. The signature authorizes GriddlePremium to pull
 *      exactly `tokenAmount` $WORD for one hour.
 *   3. Submit — call `unlockWithPermit(tokenAmount, deadline, v, r, s)`.
 *      Contract verifies the permit, burns the tokens, flips isPremium.
 *   4. Verify — POST the tx hash to /api/premium/verify. The server
 *      reads the receipt, parses the UnlockedWithBurn event, and
 *      upserts the premium_users row. On success it echoes back the
 *      wallet that paid, which we hand to `onUnlocked`.
 */
export function PremiumCryptoFlow({ onUnlocked, onCancel }: PremiumCryptoFlowProps) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();

  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const premiumAddress = getGriddlePremiumAddress();
  const wordAddress = getWordTokenAddress();
  const contractsReady = !!premiumAddress && !!wordAddress;

  const handleUnlock = async () => {
    setErrorMessage(null);

    if (!isConnected || !address) {
      setErrorMessage('Connect a wallet first.');
      setPhase('error');
      return;
    }
    if (!premiumAddress || !wordAddress || !publicClient) {
      setErrorMessage('Crypto checkout is not configured yet.');
      setPhase('error');
      return;
    }

    // Track the current phase in a local variable so the catch block
    // can read it synchronously. `phase` from useState is closed over
    // at render time and `setPhase` schedules updates for the next
    // render — the catch block on the first attempt would otherwise
    // always see 'idle', collapsing every failure into reason='unknown'.
    // Assignments are inlined (not hidden behind a helper) so TypeScript
    // can see every write and not narrow the type to the initial literal.
    let currentPhase: Phase = 'idle';

    try {
      // --- Step 1: quote --------------------------------------------------
      currentPhase = 'quoting';
      setPhase('quoting');

      // SLIPPAGE_PCT is not fetched — the client sends the oracle midpoint
      // and the contract's symmetric ±15% band handles drift without us
      // needing to know the exact tolerance value here.
      const [oracleAddress, unlockUsd] = await Promise.all([
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
      ]);

      const [price] = await publicClient.readContract({
        address: oracleAddress as `0x${string}`,
        abi: wordOracleAbi,
        functionName: 'getWordUsdPrice',
      });

      if (price === 0n) {
        throw new Error('Oracle returned zero price. Try again in a moment.');
      }

      // Mirror the contract's math so the amount we sign maps 1:1 to
      // what `unlockWithPermit` expects:
      //     expected   = (UNLOCK_USD * 1e18) / price
      //     minTokens  = expected * (100 - SLIPPAGE_PCT) / 100
      //     maxTokens  = expected * (100 + SLIPPAGE_PCT) / 100
      // We send the midpoint — the contract's symmetric band gives us
      // ±15% headroom on either side, so a small oracle drift between
      // quote and submit doesn't revert the tx.
      const expected = (unlockUsd * 10n ** 18n) / price;
      const tokenAmount = expected;

      // --- Step 2: sign permit -------------------------------------------
      currentPhase = 'signing';
      setPhase('signing');

      const [nonce, tokenName, tokenVersion] = await Promise.all([
        publicClient.readContract({
          address: wordAddress,
          abi: wordTokenAbi,
          functionName: 'nonces',
          args: [address],
        }),
        publicClient.readContract({
          address: wordAddress,
          abi: wordTokenAbi,
          functionName: 'name',
        }),
        publicClient
          .readContract({
            address: wordAddress,
            abi: wordTokenAbi,
            functionName: 'version',
          })
          .catch(() => '1'), // some ERC-2612 tokens omit version() and default to '1'
      ]);

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

      const signature = await signTypedDataAsync({
        domain: {
          name: tokenName,
          version: tokenVersion,
          chainId: CHAIN_ID,
          verifyingContract: wordAddress,
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
          value: tokenAmount,
          nonce,
          deadline,
        },
      });

      const sig = signature.slice(2);
      const r = (`0x${sig.slice(0, 64)}`) as `0x${string}`;
      const s = (`0x${sig.slice(64, 128)}`) as `0x${string}`;
      const v = parseInt(sig.slice(128, 130), 16);

      // --- Step 3: submit tx ---------------------------------------------
      currentPhase = 'submitting';
      setPhase('submitting');

      // checkout_started fires here (after the permit is signed, just
      // before the on-chain write) so the crypto path has a meaningful
      // intermediate stage — clicking "Pay with crypto" no longer maps
      // 1:1 to started, which matched fiat and skewed the funnel.
      trackEvent({ name: 'checkout_started', method: 'crypto' });

      const txHash = await writeContractAsync({
        address: premiumAddress,
        abi: griddlePremiumAbi,
        functionName: 'unlockWithPermit',
        args: [tokenAmount, deadline, v, r, s],
      });

      // --- Step 4: verify server-side ------------------------------------
      currentPhase = 'verifying';
      setPhase('verifying');

      // Server-verify independently reads the receipt and parses the
      // UnlockedWithBurn event before granting premium. Retry once on
      // "tx not yet indexed" (404) — a quick sequencer can beat our
      // provider to the receipt by a few seconds.
      let verifyResult: Response | null = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        verifyResult = await fetch('/api/premium/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ txHash }),
        });
        if (verifyResult.ok) break;
        if (verifyResult.status !== 404) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      if (!verifyResult || !verifyResult.ok) {
        const errBody = verifyResult ? await verifyResult.text() : 'no response';
        throw new Error(`Server verify failed: ${errBody}`);
      }

      const verified = (await verifyResult.json()) as { wallet: string };
      setPhase('done');
      onUnlocked(verified.wallet);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unlock failed';
      setErrorMessage(message);
      // Bucket the failure into a reason tag matching the telemetry
      // endpoint's [a-z0-9_]{1,32} pattern. `currentPhase` is the
      // local mirror of setPhase — reading `phase` directly here would
      // see the stale closure value ('idle') because state updates
      // scheduled inside handleUnlock don't land until next render.
      // User rejection is detected by the wagmi/viem-standard error
      // name so cancellations don't inflate the sign_failed bucket.
      const isUserReject =
        err instanceof Error &&
        (err.name === 'UserRejectedRequestError' || /rejected|denied|user rejected/i.test(err.message));
      let reason: string = 'unknown';
      if (isUserReject) reason = 'user_rejected';
      else if (currentPhase === 'quoting') reason = 'quote_failed';
      else if (currentPhase === 'signing') reason = 'sign_failed';
      else if (currentPhase === 'submitting') reason = 'submit_failed';
      else if (currentPhase === 'verifying') reason = 'verify_failed';
      trackEvent({ name: 'checkout_failed', method: 'crypto', reason });
      setPhase('error');
    }
  };

  // Auto-start the flow on mount / connect. If the wallet isn't connected
  // or the contracts aren't configured, handleUnlock's own guards set
  // phase='error' with a helpful message and surface the Close button —
  // without this effect invoking it, the component would hang on
  // "Preparing…" forever with no way to dismiss (since the Close button
  // only renders on error state).
  useEffect(() => {
    if (phase === 'idle') {
      handleUnlock();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, contractsReady]);

  const statusText = (() => {
    switch (phase) {
      case 'idle':
        return 'Preparing…';
      case 'quoting':
        return 'Getting today’s $WORD price…';
      case 'signing':
        return 'Sign the permit in your wallet';
      case 'submitting':
        return 'Burning $WORD on-chain…';
      case 'verifying':
        return 'Confirming the burn…';
      case 'done':
        return 'Premium unlocked!';
      case 'error':
        return errorMessage ?? 'Something went wrong.';
    }
  })();

  const inProgress = phase !== 'idle' && phase !== 'done' && phase !== 'error';

  return (
    <div className="flex flex-col items-center gap-3 p-4">
      <div className="w-12 h-12 rounded-full bg-accent/15 text-accent flex items-center justify-center">
        {inProgress ? (
          <CircleNotch className="w-6 h-6 animate-spin" weight="bold" aria-hidden />
        ) : (
          <Diamond className="w-6 h-6" weight="fill" aria-hidden />
        )}
      </div>
      <p className="text-sm font-medium text-gray-700 text-center">{statusText}</p>
      {phase === 'error' && (
        <button type="button" onClick={onCancel} className="btn-secondary text-sm">
          Close
        </button>
      )}
    </div>
  );
}
