'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Crown, CircleNotch } from '@phosphor-icons/react';
import { isValidAddress } from '@/lib/address';

export const dynamic = 'force-dynamic';

/**
 * Inner component that reads search params — must be wrapped in Suspense
 * because useSearchParams() suspends during static rendering in Next 14.
 */
function SuccessInner() {
  const router = useRouter();
  const params = useSearchParams();
  const walletParam = params.get('wallet');
  const wallet = walletParam && isValidAddress(walletParam) ? walletParam : null;

  const [confirmed, setConfirmed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 10;

    // Wallet-connected buyers: webhook writes premium_users, not a session
    // key. Poll the wallet endpoint instead so confirmation always works.
    const pollUrl = wallet ? `/api/premium/${wallet}` : '/api/premium/session';

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(pollUrl);
        if (res.ok) {
          const data = (await res.json()) as { premium?: boolean };
          if (data.premium) {
            if (!cancelled) {
              setConfirmed(true);
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
  }, [router, wallet]);

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-12 gap-4 text-center">
      <div className="w-16 h-16 rounded-full bg-accent/15 text-accent flex items-center justify-center">
        {confirmed ? (
          <Crown className="w-8 h-8" weight="fill" aria-hidden />
        ) : (
          <CircleNotch className="w-8 h-8 animate-spin" weight="bold" aria-hidden />
        )}
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-gray-900">
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

export default function PremiumSuccessPage() {
  return (
    <Suspense fallback={
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12 gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-accent/15 text-accent flex items-center justify-center">
          <CircleNotch className="w-8 h-8 animate-spin" weight="bold" aria-hidden />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Confirming payment…</h1>
      </main>
    }>
      <SuccessInner />
    </Suspense>
  );
}
