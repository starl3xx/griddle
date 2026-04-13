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
 * container?", not "is there an authenticated user?". For M4 wallet /
 * auth work we’ll also read user.fid.
 *
 * The SDK is loaded via a dynamic import so the ~30 kB bundle cost only
 * hits browsers that actually resolve it — web users never pay. All entry
 * points are safe no-ops outside a Farcaster context.
 */

export interface FarcasterState {
  inMiniApp: boolean;
  /** True once the detection check has resolved (either way). */
  hydrated: boolean;
}

const CONTEXT_TIMEOUT_MS = 2000;

export function useFarcaster(): FarcasterState {
  const [state, setState] = useState<FarcasterState>({
    inMiniApp: false,
    hydrated: false,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let sdk: typeof import('@farcaster/miniapp-sdk').sdk | null = null;
      try {
        ({ sdk } = await import('@farcaster/miniapp-sdk'));
      } catch {
        // Dynamic import failed — definitely not in Farcaster.
        if (!cancelled) setState({ inMiniApp: false, hydrated: true });
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
          setState({ inMiniApp: clientFid != null, hydrated: true });
        }
      } catch {
        if (!cancelled) setState({ inMiniApp: false, hydrated: true });
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
