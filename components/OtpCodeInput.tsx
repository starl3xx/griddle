'use client';

import { useState } from 'react';
import { CircleNotch, ArrowRight } from '@phosphor-icons/react';

interface OtpCodeInputProps {
  email: string;
  /**
   * Fired after a successful `/api/auth/verify-code` round-trip. The
   * parent handles the post-verify flow (close modal, refetch
   * profile, show welcome, etc.) — this component only owns the
   * input UX.
   *
   * May return a Promise (CreateProfileModal's callback awaits a
   * PATCH before closing) — submit() awaits it so the spinner stays
   * up for the full cycle and any error surfaces as inline copy
   * rather than an unhandled rejection.
   */
  onVerified: () => void | Promise<void>;
  /**
   * Optional prompt. Defaults to "Already have the code?" — suits the
   * primary sign-in flow. The Settings add-email surface overrides
   * it to "Got the code? Enter it here".
   */
  prompt?: string;
}

/**
 * 6-digit OTP input — companion to the magic link email. Designed
 * for the PWA escape hatch where tapping the email link opens the
 * default browser (a different session from the installed app).
 * Pasting or typing the code here completes sign-in inside the PWA.
 *
 * Input is numeric + 6 chars only; the button stays disabled until a
 * full 6 digits are present. Uses `inputMode="numeric"` so mobile
 * keyboards open the number pad, and `autoComplete="one-time-code"`
 * so iOS / Android surface the most-recent SMS/email code for a one-
 * tap fill. (Those platforms treat magic-link codes as OTPs for this
 * purpose even though the delivery channel is email.)
 */
export function OtpCodeInput({ email, onVerified, prompt }: OtpCodeInputProps) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Invalid or expired code.');
      }
      // Await in case the parent's callback does async work (refetch
      // profile, merge sessions, etc.) before closing the modal.
      // Without awaiting, the spinner would stop the moment the
      // fetch resolved and any rejection inside the callback would
      // become an unhandled promise rejection.
      await onVerified();
      // Success: the parent usually unmounts this component via its
      // own state flip. If it didn't (callback succeeded but left
      // this component on-screen), reset the spinner so the button
      // isn't stuck showing "verifying…".
      setSubmitting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
      setSubmitting(false);
    }
  };

  const ready = /^[0-9]{6}$/.test(code);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-md p-3 space-y-2">
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
        {prompt ?? 'Already have the code?'}
      </p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          size={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ready && !submitting) submit();
          }}
          placeholder="000000"
          // min-w-0 lets the flex item shrink below the input's
          // intrinsic min-width so it can sit next to Verify on
          // narrow PWA viewports without forcing horizontal overflow.
          className="flex-1 min-w-0 font-mono tracking-[0.4em] text-center text-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!ready || submitting}
          className="btn-primary !py-2 !px-3 text-sm inline-flex items-center gap-1"
        >
          {submitting ? (
            <CircleNotch className="w-4 h-4 animate-spin" weight="bold" aria-hidden />
          ) : (
            <ArrowRight className="w-4 h-4" weight="bold" aria-hidden />
          )}
          Verify
        </button>
      </div>
      {error && (
        <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
