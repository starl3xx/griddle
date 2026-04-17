'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Crown, ArrowLeft, CircleNotch } from '@phosphor-icons/react';

/**
 * Lazy-load the Stripe SDK chunk so non-paying users never pull it.
 * Mirrors the GameClient-level lazy pattern used for LazyConnectFlow
 * and LazyPremiumCryptoFlow — kept inside PremiumGateModal because
 * the embed lives in the second step of this modal, not as a sibling
 * overlay like the crypto flow.
 */
const LazyPremiumCheckoutEmbed = dynamic(
  () =>
    import('./PremiumCheckoutEmbed').then((mod) => ({
      default: mod.PremiumCheckoutEmbed,
    })),
  { ssr: false, loading: () => <EmbedLoading /> },
);

interface PremiumGateModalProps {
  /** What the user tried to open — shapes the modal headline. */
  feature: 'leaderboard' | 'archive' | 'premium';
  /**
   * Wallet address currently bound to this session, or null. The
   * crypto tile requires a wallet (permit signing); fiat works either
   * way — the webhook writes session-premium for anonymous buyers and
   * premium_users for wallet-connected ones.
   */
  sessionWallet: string | null;
  /**
   * When true, the fiat tile bypasses the embed and calls `onUnlockFiat`
   * directly (hosted Stripe Checkout redirect). Set to true inside the
   * Farcaster mini app Frame where cross-origin iframe payment flows
   * are blocked.
   */
  forceHostedFiat: boolean;
  onClose: () => void;
  /** Fires when the user clicks "Pay with crypto" — parent opens the flow. */
  onUnlockCrypto: () => void;
  /**
   * Hosted-mode fiat handler. Only called when `forceHostedFiat` is
   * true. Parent POSTs to /api/stripe/checkout with `mode: 'hosted'`
   * and redirects to the returned session URL. A rejected promise
   * surfaces the error inline.
   */
  onUnlockFiat: () => Promise<void> | void;
  /**
   * Fires as soon as the user clicks the fiat tile — regardless of
   * mode. Parent emits the `upgrade_clicked` funnel event.
   */
  onUpgradeClickedFiat: () => void;
  /**
   * Fires when the embedded Stripe session mounts (fetchClientSecret
   * has been invoked). Parent emits the `checkout_started` funnel
   * event. In hosted mode this does NOT fire here — the parent emits
   * `checkout_started` itself right before the redirect.
   */
  onFiatCheckoutStarted: () => void;
  /**
   * Fires after Stripe's client-side completion + post-complete polling
   * has confirmed the webhook wrote the row / KV key. Parent is
   * expected to setPremium(true), close the modal, and — if a wallet
   * is connected — run its usual wallet-keyed premium refresh.
   */
  onFiatCheckoutComplete: () => void;
}

type Step = 'tiles' | 'embed' | 'confirming';

/**
 * Premium-gate modal. Three-step flow for the fiat path:
 *
 *   1. `tiles`       — crypto vs. fiat choice (unchanged UX from prior)
 *   2. `embed`       — inline Stripe Checkout via `EmbeddedCheckoutProvider`
 *   3. `confirming`  — short poll of /api/premium/[wallet] or
 *                      /api/premium/session to wait for the webhook
 *                      before claiming success
 *
 * The crypto tile still hands control to the parent (`onUnlockCrypto`)
 * as before — its overlay is a sibling modal, not a step of this one.
 *
 * Callers MUST conditionally mount this component (`{open && <Modal />}`)
 * rather than rely on an `open` prop. That guarantees step state + the
 * lazy-loaded embed are discarded on close, so a failed payment doesn't
 * leave stale state in a re-opened modal.
 */
export function PremiumGateModal({
  feature,
  sessionWallet,
  forceHostedFiat,
  onClose,
  onUnlockCrypto,
  onUnlockFiat,
  onUpgradeClickedFiat,
  onFiatCheckoutStarted,
  onFiatCheckoutComplete,
}: PremiumGateModalProps) {
  const [step, setStep] = useState<Step>('tiles');
  const [fiatSubmitting, setFiatSubmitting] = useState(false);
  const [fiatError, setFiatError] = useState<string | null>(null);

  const headline =
    feature === 'leaderboard' ? 'See the leaderboard'
    : feature === 'archive' ? 'Play past puzzles'
    : 'Unlock Griddle Premium';
  const blurbText = feature === 'leaderboard'
    ? 'Premium unlocks every day’s ranked leaderboard. See who solved fastest and how you stack up.'
    : feature === 'archive'
      ? 'Premium unlocks the full puzzle archive. Replay any past day and climb its leaderboard.'
      : 'Unlock leaderboards, the full archive, streak protection, and unassisted mode. One-time, no subscription.';

  const handleFiatClick = async () => {
    setFiatError(null);
    onUpgradeClickedFiat();
    if (forceHostedFiat) {
      setFiatSubmitting(true);
      try {
        await onUnlockFiat();
      } catch (err) {
        setFiatError(err instanceof Error ? err.message : 'Checkout failed');
        setFiatSubmitting(false);
      }
      // Hosted-mode success is a full-page redirect — leave the
      // spinner spinning. Conditional mounting clears it if the
      // redirect fails.
      return;
    }
    // Embedded mode: swap to the embed step. `checkout_started` fires
    // from inside EmbedSlot once the embed mounts, matching crypto-path
    // timing (both emit "started" at "network acknowledged" rather
    // than "user clicked").
    setStep('embed');
  };

  const handleEmbedComplete = useCallback(() => {
    setStep('confirming');
  }, []);

  // Polling loop for the `confirming` step. We exit via the
  // onFiatCheckoutComplete callback when premium is confirmed. On
  // timeout we hand off to /premium/success (which polls on its own
  // and surfaces a retry CTA) rather than optimistically flipping
  // state — that would mask a genuine webhook failure.
  useEffect(() => {
    if (step !== 'confirming') return;
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 10; // 10 × 500 ms = 5 s
    const pollUrl = sessionWallet
      ? `/api/premium/${sessionWallet}`
      : '/api/premium/session';

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(pollUrl);
        if (res.ok) {
          const data = (await res.json()) as { premium?: boolean };
          if (data.premium) {
            if (!cancelled) onFiatCheckoutComplete();
            return;
          }
        }
      } catch {
        // best-effort
      }
      attempts++;
      if (attempts >= MAX_ATTEMPTS) {
        if (!cancelled) {
          // Thread the wallet through so /premium/success polls
          // /api/premium/[wallet] rather than /api/premium/session —
          // the webhook for wallet-connected buyers writes to
          // premium_users (wallet-keyed), not the session KV key, so
          // a session-only poll on the success page would never see
          // the row.
          const href = sessionWallet
            ? `/premium/success?wallet=${sessionWallet}`
            : '/premium/success';
          window.location.href = href;
        }
        return;
      }
      setTimeout(poll, 500);
    };

    poll();
    return () => { cancelled = true; };
  }, [step, sessionWallet, onFiatCheckoutComplete]);

  // During `confirming` the user has already paid — closing the modal
  // unmounts the polling effect via its cleanup, so onFiatCheckoutComplete
  // never fires and premium UI doesn't flip until the next refresh. Lock
  // both the backdrop and the close button for the ≤5 s window; on
  // timeout the polling loop navigates away, which dismounts the modal
  // regardless.
  const dismissible = step !== 'confirming';
  const handleBackdropClick = dismissible ? onClose : undefined;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fade-in"
      onClick={handleBackdropClick}
    >
      <div
        className="modal-sheet animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {step === 'tiles' ? (
            <div className="w-11 h-11 rounded-full bg-accent/10 text-accent flex items-center justify-center flex-shrink-0">
              <Crown className="w-5 h-5" weight="fill" aria-hidden />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (step === 'embed') setStep('tiles');
              }}
              disabled={step !== 'embed'}
              aria-label="Back"
              className="w-11 h-11 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 flex items-center justify-center flex-shrink-0 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ArrowLeft className="w-5 h-5" weight="bold" aria-hidden />
            </button>
          )}
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              {step === 'tiles' ? headline : step === 'embed' ? 'Pay with card' : 'Confirming payment…'}
            </h2>
            <p className="text-sm font-medium text-gray-500 mt-0.5">
              Griddle Premium — one-time unlock
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={!dismissible}
            aria-label="Close"
            className="ml-auto w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors duration-fast disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400"
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

        {step === 'tiles' && (
          <>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mt-4">{blurbText}</p>

            <ul className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed mt-4 space-y-1.5">
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
                className="rounded-md border-2 border-brand bg-brand-50 dark:bg-brand-900/30 px-3 py-3 text-left hover:bg-brand-100 dark:hover:bg-brand-900/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title={sessionWallet ? undefined : 'Connect a wallet first'}
              >
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Pay with crypto (USDC)
                </div>
                <div className="text-xl font-black text-gray-900 dark:text-gray-100 tabular-nums mt-0.5">$5</div>
                <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mt-0.5">
                  {sessionWallet ? 'Swapped to $WORD and burned' : 'Connect wallet first'}
                </div>
              </button>

              <button
                type="button"
                onClick={handleFiatClick}
                disabled={fiatSubmitting}
                className="rounded-md border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-3 text-left hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Pay with card
                </div>
                <div className="text-xl font-black text-gray-900 dark:text-gray-100 tabular-nums mt-0.5">$6</div>
                <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mt-0.5">
                  {fiatSubmitting
                    ? 'Opening checkout…'
                    : forceHostedFiat
                      ? 'Card, Apple Pay, Google Pay'
                      : 'Card, Apple Pay, Google Pay, Link'}
                </div>
              </button>
            </div>

            {fiatError && (
              <p className="text-[11px] font-semibold text-error-700 mt-2">{fiatError}</p>
            )}

            <p className="text-[11px] font-medium text-gray-400 text-center mt-3">
              One-time, no subscription.
            </p>
          </>
        )}

        {step === 'embed' && (
          <div className="mt-4">
            <EmbedSlot
              wallet={sessionWallet}
              onCheckoutStarted={onFiatCheckoutStarted}
              onComplete={handleEmbedComplete}
            />
          </div>
        )}

        {step === 'confirming' && (
          <div className="flex flex-col items-center gap-3 py-10">
            <CircleNotch className="w-8 h-8 animate-spin text-accent" weight="bold" aria-hidden />
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
              Finishing up — just a moment.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Wraps LazyPremiumCheckoutEmbed + fires the `checkout_started`
 * funnel event exactly once per mount. React Strict Mode re-runs
 * effects in dev, which would double-fire without the guard.
 */
function EmbedSlot({
  wallet,
  onCheckoutStarted,
  onComplete,
}: {
  wallet: string | null;
  onCheckoutStarted: () => void;
  onComplete: () => void;
}) {
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    onCheckoutStarted();
  }, [onCheckoutStarted]);

  return <LazyPremiumCheckoutEmbed wallet={wallet} onComplete={onComplete} />;
}

function EmbedLoading() {
  return (
    <div className="flex items-center justify-center py-10">
      <CircleNotch className="w-6 h-6 animate-spin text-gray-400" weight="bold" aria-hidden />
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
