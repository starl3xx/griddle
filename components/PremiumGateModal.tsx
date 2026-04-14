'use client';

import { useState } from 'react';
import { Diamond } from '@phosphor-icons/react';

interface PremiumGateModalProps {
  open: boolean;
  /** What the user tried to open — shapes the modal headline. */
  feature: 'leaderboard' | 'archive';
  /**
   * Wallet address currently bound to this session, or null. When null
   * the crypto path is disabled (wallet is required for permit signing)
   * and the fiat path prompts for a handle up front so the buyer still
   * gets leaderboard presence.
   */
  sessionWallet: string | null;
  onClose: () => void;
  /** Fires when the user clicks "Pay with crypto" — parent opens the flow. */
  onUnlockCrypto: () => void;
  /**
   * Fires when the user clicks "Pay with cash". The parent POSTs to
   * /api/stripe/checkout with the wallet (if any) or handle and redirects
   * to the returned session URL. A rejected promise surfaces the error
   * inline inside the modal.
   */
  onUnlockFiat: (handle: string | null) => Promise<void> | void;
}

/**
 * Premium-gate modal. Two unlock paths:
 *
 *  - **Crypto ($5)** — requires a connected wallet. Clicking opens the
 *    lazy-loaded PremiumCryptoFlow inside the parent, which quotes the
 *    oracle, signs an ERC-2612 permit, calls `unlockWithPermit`, and
 *    asks the server to verify the burn before flipping premium state.
 *  - **Cash ($6)** — Stripe Checkout. If a wallet is connected, premium
 *    binds to that wallet. Otherwise we require a handle up front so
 *    the fiat buyer still gets leaderboard presence; on first wallet
 *    connect those rows merge.
 *
 * The two tiles are click targets, not labels next to an action button.
 * No "Unlock" button below them — a user who clicked a tile clearly
 * intends to pay, so an extra confirmation step is friction.
 */
export function PremiumGateModal({
  open,
  feature,
  sessionWallet,
  onClose,
  onUnlockCrypto,
  onUnlockFiat,
}: PremiumGateModalProps) {
  const [handle, setHandle] = useState('');
  const [fiatSubmitting, setFiatSubmitting] = useState(false);
  const [fiatError, setFiatError] = useState<string | null>(null);

  if (!open) return null;

  const headline =
    feature === 'leaderboard' ? 'See the leaderboard' : 'Play past puzzles';
  const blurb =
    feature === 'leaderboard'
      ? 'Premium unlocks every day’s ranked leaderboard — see who solved fastest, who went unassisted, and how you stack up.'
      : 'Premium unlocks the full puzzle archive — replay any past day and climb its leaderboard.';

  const needsHandle = !sessionWallet;
  const trimmedHandle = handle.trim();
  const handleValid = /^[A-Za-z0-9_\-]{1,32}$/.test(trimmedHandle);

  const handleFiatClick = async () => {
    setFiatError(null);
    if (needsHandle && !handleValid) {
      setFiatError('Pick a handle (1–32 chars, letters/numbers/_/-).');
      return;
    }
    setFiatSubmitting(true);
    try {
      await onUnlockFiat(needsHandle ? trimmedHandle : null);
    } catch (err) {
      setFiatError(err instanceof Error ? err.message : 'Checkout failed');
      setFiatSubmitting(false);
    }
    // On success the parent redirects to Stripe — we deliberately leave
    // the spinner spinning rather than reset, so a fast redirect doesn't
    // flash "idle" state.
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
              Griddle Premium — one-time unlock
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

        <p className="text-sm text-gray-700 leading-relaxed mt-4">{blurb}</p>

        <ul className="text-sm text-gray-800 leading-relaxed mt-4 space-y-1.5">
          <Benefit>Every day’s ranked leaderboard</Benefit>
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
            className="rounded-md border-2 border-gray-200 bg-white px-3 py-3 text-left hover:border-gray-300 hover:bg-gray-50 disabled:opacity-60 transition-colors"
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

        {needsHandle && (
          <div className="mt-4">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
              Pick a handle for the leaderboard
            </label>
            <input
              type="text"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="alice"
              maxLength={32}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Required for cash checkout. Connect a wallet to skip this step.
            </p>
          </div>
        )}

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
