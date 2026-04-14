'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Diamond, CircleNotch } from '@phosphor-icons/react';

/**
 * Post-Stripe redirect landing page.
 *
 * Stripe redirects here after checkout with `?session_id=cs_...`.
 * We poll `/api/premium/session` until the webhook has fired and set
 * the session-premium key in Upstash (typically < 2s). Once confirmed,
 * we auto-redirect back to the game so the user lands with premium
 * already visible — no stale gate on return.
 *
 * Falls back to a manual "Back to puzzle" link after 10s in case the
 * webhook is delayed or the session key takes longer than expected.
 */
export const dynamic = 'force-dynamic';

export default function PremiumSuccessPage() {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 10; // 10 × 1s = 10s max wait

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch('/api/premium/session');
        if (res.ok) {
          const data = (await res.json()) as { premium?: boolean };
          if (data.premium) {
            if (!cancelled) {
              setConfirmed(true);
              // Brief pause so the user sees the success state, then go.
              setTimeout(() => { if (!cancelled) router.push('/'); }, 800);
            }
            return;
          }
        }
      } catch {
        // best-effort
      }
      attempts++;
      if (attempts >= MAX_ATTEMPTS) {
        if (!cancelled) setTimedOut(true);
        return;
      }
      setTimeout(poll, 1000);
    };

    poll();
    return () => { cancelled = true; };
  }, [router]);

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-12 gap-4 text-center">
      <div className="w-16 h-16 rounded-full bg-accent/15 text-accent flex items-center justify-center">
        {confirmed ? (
          <Diamond className="w-8 h-8" weight="fill" aria-hidden />
        ) : (
          <CircleNotch className="w-8 h-8 animate-spin" weight="bold" aria-hidden />
        )}
      </div>
      <h1 className="text-3xl font-black tracking-tight text-gray-900">
        {confirmed ? 'Premium unlocked' : 'Confirming payment…'}
      </h1>
      <p className="text-sm font-medium text-gray-500 max-w-sm">
        {confirmed
          ? 'Thanks for supporting Griddle. Sending you back now.'
          : timedOut
            ? 'Payment confirmed — tap below to start playing.'
            : 'Just a moment while we confirm your purchase.'}
      </p>
      {(timedOut || confirmed) && (
        <a href="/" className="btn-primary mt-2 inline-flex items-center gap-2">
          Back to today's puzzle
        </a>
      )}
    </main>
  );
}
