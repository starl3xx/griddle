'use client';

import { useEffect, useState } from 'react';

/**
 * Farcaster mini-app integration.
 *
 * Borrowed patterns from the LHAW integration (see `lets-have-a-word/pages/
 * index.tsx` around `getFarcasterContext`), specifically:
 *
 *   1. Fire `sdk.actions.ready()` IMMEDIATELY on mount — don’t await the
 *      context check first. The splash screen inside the Farcaster client
 *      is held open until ready() fires, so delaying it behind a slow or
 *      hung context request strands the user staring at nothing.
 *   2. Race `sdk.context` against a 2-second timeout. The SDK context can
 *      hang indefinitely in preview mode / dev clients, so we cap it.
 *   3. Use `@farcaster/miniapp-sdk` directly (not the frame-sdk wrapper) —
 *      matches what LHAW imports.
 *
 * Detection uses `context.client.clientFid` rather than `context.user.fid`
 * because the signal we want is "am I running inside a Farcaster client
 * container?", not "is there an authenticated user?". For M5-wallets and
 * M6-email-auth work we’ll also read user.fid.
 *
 * The SDK is loaded via a dynamic import so the ~30 kB bundle cost only
 * hits browsers that actually resolve it — web users never pay. All entry
 * points are safe no-ops outside a Farcaster context.
 */

export interface FarcasterState {
  inMiniApp: boolean;
  /** True once the detection check has resolved (either way). */
  hydrated: boolean;
  /** Farcaster user id (numeric). Null outside a Farcaster miniapp. */
  fid: number | null;
  /** Farcaster @username (without the @). Null outside a Farcaster miniapp. */
  username: string | null;
  /** Profile picture URL if the user is authed inside a Farcaster client. */
  pfpUrl: string | null;
  /** Display name if the user is authed inside a Farcaster client. */
  displayName: string | null;
}

const CONTEXT_TIMEOUT_MS = 2000;

export function useFarcaster(): FarcasterState {
  const [state, setState] = useState<FarcasterState>({
    inMiniApp: false,
    hydrated: false,
    fid: null,
    username: null,
    pfpUrl: null,
    displayName: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let sdk: typeof import('@farcaster/miniapp-sdk').sdk | null = null;
      try {
        ({ sdk } = await import('@farcaster/miniapp-sdk'));
      } catch {
        // Dynamic import failed — definitely not in Farcaster.
        if (!cancelled) {
          setState({ inMiniApp: false, hydrated: true, fid: null, username: null, pfpUrl: null, displayName: null });
        }
        return;
      }

      // Fire ready() first, don’t await it behind context. The Farcaster
      // client’s splash screen is held until ready() fires — if we wait
      // for context (which can hang) the user stares at the splash.
      try {
        await sdk.actions.ready();
      } catch {
        // Outside Farcaster, ready() is a no-op or throws quietly.
      }

      // Cap sdk.context at CONTEXT_TIMEOUT_MS so we never hang.
      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), CONTEXT_TIMEOUT_MS);
      });

      try {
        const context = await Promise.race([sdk.context, timeoutPromise]);
        const clientFid = context?.client?.clientFid;
        if (!cancelled) {
          setState({
            inMiniApp: clientFid != null,
            hydrated: true,
            fid: context?.user?.fid ?? null,
            username: context?.user?.username ?? null,
            pfpUrl: context?.user?.pfpUrl ?? null,
            displayName: context?.user?.displayName ?? null,
          });
        }
      } catch {
        if (!cancelled) {
          setState({ inMiniApp: false, hydrated: true, fid: null, username: null, pfpUrl: null, displayName: null });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/**
 * Three-state result from `composeCast`:
 *
 *   - `cast`       — the user actually posted a cast
 *   - `cancelled`  — the user opened the composer and dismissed it (respect
 *                    the intent; do NOT fall through to other share methods)
 *   - `failed`     — the SDK threw or isn’t available at all (caller SHOULD
 *                    fall through to Web Share / clipboard)
 *
 * The distinction matters because `sdk.actions.composeCast` *resolves* (not
 * rejects) when the user cancels, returning `{ cast: null }`. Treating every
 * resolution as success means a cancelled composer silently swallows the
 * share action — the clipboard fallback never runs, but nothing was actually
 * shared either. The user hits Share and sees… nothing. Three-state return
 * lets callers handle each case intentionally.
 */
export type ComposeCastResult = 'cast' | 'cancelled' | 'failed';

/**
 * Open the Farcaster cast composer with pre-filled text and an embed URL.
 * Safe to call outside a Farcaster context — dynamic import failure or any
 * thrown error returns `'failed'` and the caller can fall back to Web Share
 * / clipboard.
 */
export async function composeCast(
  text: string,
  embedUrl: string,
): Promise<ComposeCastResult> {
  try {
    const { sdk } = await import('@farcaster/miniapp-sdk');
    const result = await sdk.actions.composeCast({ text, embeds: [embedUrl] });
    // composeCast’s Result<false> shape is { cast: ComposeCastInnerResult | null }.
    // cast === null means the user cancelled the composer.
    if (result && 'cast' in result && result.cast != null) {
      return 'cast';
    }
    return 'cancelled';
  } catch {
    return 'failed';
  }
}

/**
 * Open an external URL from inside a Farcaster mini-app.
 *
 * Background: Stripe's hosted checkout (and similar third-party payment
 * surfaces) set `X-Frame-Options: DENY`, which means a plain
 * `window.location.href = url` inside the mini-app iframe navigates to
 * a page that the Farcaster client then refuses to paint. The user sees
 * a frozen skeleton or a blank screen.
 *
 * The SDK's `openUrl` action tells the host Farcaster client to break
 * out of the embedded frame and open the URL in the device's browser.
 * The user completes checkout there; Stripe's success_url lands them
 * on griddle.fun in the browser (not back in the mini-app), and they
 * manually return to the mini-app afterwards.
 *
 * Returns `'opened'` on success, `'failed'` if the SDK isn't available
 * (dynamic import failure / outside a mini-app container / host client
 * refused the action). The caller decides the fallback — typically
 * `window.location.href` for plain-web paths.
 */
export async function openExternalUrl(url: string): Promise<'opened' | 'failed'> {
  try {
    const { sdk } = await import('@farcaster/miniapp-sdk');
    await sdk.actions.openUrl(url);
    return 'opened';
  } catch {
    return 'failed';
  }
}
