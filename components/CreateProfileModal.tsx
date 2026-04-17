'use client';

import { useState } from 'react';
import { Envelope, CircleNotch } from '@phosphor-icons/react';
import { OtpCodeInput } from './OtpCodeInput';

interface CreateProfileModalProps {
  onClose: () => void;
  onConnectWallet: () => void;
  /** Called once profile is created/verified so parent can refresh state. */
  onProfileCreated: () => void;
}

type Step = 'form' | 'check-email';

/**
 * Sign-in modal for anonymous users. Two paths:
 *
 *   1. **Email (primary)** — enter email → magic link + OTP code emailed
 *      → user clicks link OR pastes code → profile created, session
 *      bound → onProfileCreated fires.
 *   2. **Wallet** — defers to the parent's connect flow (wallet-linked
 *      profiles use the existing wallet-session KV binding).
 *
 * Username is NOT collected here. Asking for it pre-verify caused two
 * bugs: (a) magic-link clicks land in a different browser context from
 * where the user typed (iOS Mail → Safari vs. installed PWA), so any
 * localStorage-based handoff loses the name, and (b) silent PATCH
 * failures post-OTP-verify left users with an empty handle and no
 * error. SettingsModal prompts for the username right after verify
 * completes, so the user types it exactly once on the device where
 * the session just got bound.
 */
export function CreateProfileModal({
  onClose,
  onConnectWallet,
  onProfileCreated,
}: CreateProfileModalProps) {
  const [step, setStep] = useState<Step>('form');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setError('Enter your email to get started.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Enter a valid email address.');
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch('/api/auth/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? 'Failed to send email');
      }
      setStep('check-email');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="modal-sheet animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {step === 'check-email' ? (
          <CheckEmailState
            email={email.trim()}
            onClose={onClose}
            onVerifiedWithCode={onProfileCreated}
          />
        ) : (
          <>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand flex items-center justify-center flex-shrink-0">
                <Envelope className="w-5 h-5" weight="bold" aria-hidden />
              </div>
              <div>
                <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100">
                  Sign in
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  We’ll send a one-time link. New here? Same flow.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="ml-auto w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-4 h-4" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !submitting) handleSubmit();
                  }}
                  placeholder="you@example.com"
                  className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
                  autoComplete="email"
                  autoFocus
                />
              </div>

              {error && (
                <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p>
              )}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="btn-primary w-full inline-flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <CircleNotch className="w-4 h-4 animate-spin" weight="bold" aria-hidden />
                ) : (
                  <Envelope className="w-4 h-4" weight="bold" aria-hidden />
                )}
                Send sign-in link
              </button>

              <div className="flex items-center gap-2 my-1">
                <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
                <span className="text-[11px] text-gray-400 uppercase tracking-wider">or</span>
                <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
              </div>

              <button
                type="button"
                onClick={onConnectWallet}
                className="btn-secondary w-full text-sm"
              >
                Connect a wallet instead
              </button>
            </div>

            <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center mt-4">
              You’ll pick a username after signing in.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function CheckEmailState({
  email,
  onClose,
  onVerifiedWithCode,
}: {
  email: string;
  onClose: () => void;
  /** Fires after a successful `/api/auth/verify-code` round-trip. */
  onVerifiedWithCode: () => void | Promise<void>;
}) {
  return (
    <div className="py-4">
      <div className="text-center mb-5">
        <div className="w-12 h-12 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand flex items-center justify-center mx-auto mb-4">
          <Envelope className="w-6 h-6" weight="bold" aria-hidden />
        </div>
        <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100 mb-1">
          Check your email
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed max-w-xs mx-auto">
          We sent a sign-in link to <strong>{email}</strong>. Tap it, or enter the 6-digit code below.
        </p>
      </div>

      {/* OTP input — the PWA escape hatch. Email clients open the
          magic link in the default browser, not the installed PWA, so
          PWA users sign in by pasting the emailed code here instead. */}
      <OtpCodeInput
        email={email}
        onVerified={onVerifiedWithCode}
        prompt="Signing in from the PWA? Enter the code"
      />

      <button type="button" onClick={onClose} className="block mx-auto mt-5 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
        Close
      </button>
    </div>
  );
}
