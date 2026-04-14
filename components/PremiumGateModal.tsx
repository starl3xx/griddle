'use client';

import { useState } from 'react';
import { Diamond } from '@phosphor-icons/react';

interface PremiumGateModalProps {
  /** What the user tried to open  -  shapes the modal headline. */
  feature: 'leaderboard' | 'archive' | 'premium';
  /**
   * Wallet address currently bound to this session, or null. Both
   * paths require a wallet in M4f: crypto for permit signing, fiat
   * because the premium-read path keys on wallet. Handle-only fiat
   * lands in M4g alongside the profile/identity rework.
   */
  sessionWallet: string | null;
  onClose: () => void;
  /** Fires when the user clicks "Pay with crypto"  -  parent opens the flow. */
  onUnlockCrypto: () => void;
  /**
   * Fires when the user clicks "Pay with cash". The parent POSTs to
   * /api/stripe/checkout with the connected wallet and redirects to
   * the returned session URL. A rejected promise surfaces the error
   * inline inside the modal.
   */
  onUnlockFiat: () => Promise<void> | void;

}

/**
 * Premium-gate modal. Two unlock paths, both require a connected wallet
 * in M4f:
 *
 *  - **Crypto ($5)**  -  Lazy-loaded PremiumCryptoFlow signs an ERC-2612
 *    permit, calls `unlockWithPermit`, server verifies the burn.
 *  - **Cash ($6)**  -  Stripe Checkout. Premium binds to the connected
 *    wallet so the game's `refreshPremium` read sees it post-redirect.
 *
 * Handle-only fiat (pay without a wallet) lands in M4g alongside the
 * profile/identity rework  -  until then, both tiles need a wallet and
 * the modal prompts to connect if there isn't one.
 *
 * The caller MUST conditionally mount this component (`{open && <Modal />}`)
 * rather than rely on an `open` prop. That guarantees local state is
 * reset on every open cycle, preventing stale `fiatSubmitting` /
 * `fiatError` from persisting across a failed redirect.
 */
export function PremiumGateModal({
  feature,
  sessionWallet,
  onClose,
  onUnlockCrypto,
  onUnlockFiat,
}: PremiumGateModalProps) {
  const [fiatSubmitting, setFiatSubmitting] = useState(false);
  const [fiatError, setFiatError] = useState<string | null>(null);

  const headline =
    feature === 'leaderboard' ? 'See the leaderboard'
    : feature === 'archive' ? 'Play past puzzles'
    : 'Unlock Griddle Premium';
  const blurbText = feature === 'leaderboard'
    ? "Premium unlocks every day's ranked leaderboard. See who solved fastest and how you stack up."
    : feature === 'archive'
      ? 'Premium unlocks the full puzzle archive. Replay any past day and climb its leaderboard.'
      : 'Unlock leaderboards, the full archive, streak protection, and unassisted mode. One-time, no subscription.';

  const handleFiatClick = async () => {
    setFiatError(null);
    setFiatSubmitting(true);
    try {
      await onUnlockFiat();
    } catch (err) {
      setFiatError(err instanceof Error ? err.message : 'Checkout failed');
      setFiatSubmitting(false);
    }
    // On success the parent redirects to Stripe  -  we deliberately leave
    // the spinner spinning rather than reset, so a fast redirect doesn't
    // flash "idle" state. Conditional mounting from the parent guarantees
    // the stuck-spinner state is cleared if the redirect ever fails.
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="modal-sheet sm:rounded-card animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-full bg-accent/10 text-accent flex items-center justify-center flex-shrink-0">
            <Diamond className="w-5 h-5" weight="fill" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-black tracking-tight text-gray-900">
              {headline}
            </h2>
            <p className="text-sm font-medium text-gray-500 mt-0.5">
              Griddle Premium  -  one-time unlock
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors duration-fast"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="w-4 h-4"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <p className="text-sm text-gray-700 leading-relaxed mt-4">{blurbText}</p>

        <ul className="text-sm text-gray-800 leading-relaxed mt-4 space-y-1.5">
          <Benefit>Every day's ranked leaderboard</Benefit>
          <Benefit>Full puzzle archive</Benefit>
          <Benefit>Personal stats dashboard</Benefit>
          <Benefit>Streak protection + unassisted mode</Benefit>
        </ul>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onUnlockCrypto}
            disabled={!sessionWallet}
            className="rounded-md border-2 border-brand bg-brand-50 px-3 py-3 text-left hover:bg-brand-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={sessionWallet ? undefined : 'Connect a wallet first'}
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              Pay with crypto ($WORD)
            </div>
            <div className="text-xl font-black text-gray-900 tabular-nums mt-0.5">$5</div>
            <div className="text-[11px] font-medium text-gray-500 mt-0.5">
              {sessionWallet ? 'One tap, onchain' : 'Connect wallet first'}
            </div>
          </button>

          <button
            type="button"
            onClick={handleFiatClick}
            disabled={fiatSubmitting}
            className="rounded-md border-2 border-gray-200 bg-white px-3 py-3 text-left hover:border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              Pay with cash (Stripe)
            </div>
            <div className="text-xl font-black text-gray-900 tabular-nums mt-0.5">$6</div>
            <div className="text-[11px] font-medium text-gray-500 mt-0.5">
              {fiatSubmitting ? 'Opening checkout…' : 'Card & Apple Pay'}
            </div>
          </button>
        </div>

        {fiatError && (
          <p className="text-[11px] font-semibold text-error-700 mt-2">{fiatError}</p>
        )}

        <p className="text-[11px] font-medium text-gray-400 text-center mt-3">
          One-time, no subscription.
        </p>
      </div>
    </div>
  );
}

function Benefit({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="text-brand font-bold mt-0.5">✓</span>
      <span>{children}</span>
    </li>
  );
}
