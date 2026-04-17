'use client';

import { useEffect, useState } from 'react';
import { useAccount, usePublicClient, useSignTypedData, useWriteContract } from 'wagmi';
import { Crown, CircleNotch } from '@phosphor-icons/react';
import { griddlePremiumAbi, usdcAbi, wordOracleAbi } from '@/lib/contracts/griddlePremiumAbi';
import {
  getGriddlePremiumAddress,
  getUsdcAddress,
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
  | 'quoting' // fetching oracle price to floor minWordOut
  | 'signing' // waiting for USDC permit signature
  | 'submitting' // waiting for on-chain tx broadcast
  | 'verifying' // waiting for server to verify the tx
  | 'done' // unlock confirmed
  | 'error';

/**
 * Crypto unlock flow (M5-usdc-premium). The user pays $5 USDC — the
 * contract atomically swaps USDC → $WORD via Uniswap Universal Router
 * and burns the $WORD in the same transaction. The player never needs
 * to hold $WORD directly.
 *
 * Steps:
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
 *   4. Verify — POST the tx hash to /api/premium/verify. The server
 *      reads the receipt, parses the UnlockedWithUsdcSwap event, and
 *      upserts the premium_users row with `usdc_amount` + `word_burned`.
 */
export function PremiumCryptoFlow({ onUnlocked, onCancel }: PremiumCryptoFlowProps) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();

  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const premiumAddress = getGriddlePremiumAddress();
  const usdcAddress = getUsdcAddress();
  const contractsReady = !!premiumAddress;

  const handleUnlock = async () => {
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

      const [price] = await publicClient.readContract({
        address: oracleAddress as `0x${string}`,
        abi: wordOracleAbi,
        functionName: 'getWordUsdPrice',
      });

      if (price === 0n) {
        throw new Error('Oracle returned zero price. Try again in a moment.');
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

      // --- Step 4: verify server-side -----------------------------------
      currentPhase = 'verifying';
      setPhase('verifying');

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

  const inProgress = phase !== 'idle' && phase !== 'done' && phase !== 'error';

  return (
    <div className="flex flex-col items-center gap-3 p-4">
      <div className="w-12 h-12 rounded-full bg-accent/15 text-accent flex items-center justify-center">
        {inProgress ? (
          <CircleNotch className="w-6 h-6 animate-spin" weight="bold" aria-hidden />
        ) : (
          <Crown className="w-6 h-6" weight="fill" aria-hidden />
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
