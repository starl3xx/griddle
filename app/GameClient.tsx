'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Diamond } from '@phosphor-icons/react';
import { useDarkMode } from '@/lib/useDarkMode';
import { Grid } from '@/components/Grid';
import { WordSlots } from '@/components/WordSlots';
import { SolveModal } from '@/components/SolveModal';
import { TutorialModal } from '@/components/TutorialModal';
import { HomeTiles } from '@/components/HomeTiles';
import { FoundWords } from '@/components/FoundWords';
import { StatsModal } from '@/components/StatsModal';
import { CreateProfileModal } from '@/components/CreateProfileModal';
import { PremiumGateModal } from '@/components/PremiumGateModal';
import { NextPuzzleCountdown } from '@/components/NextPuzzleCountdown';
import { useGriddle, type SolveVerdict } from '@/lib/useGriddle';
import { useFarcaster } from '@/lib/farcaster';
import type { SolvePayload } from '@/lib/telemetry';

/**
 * The wagmi/viem/connector stack is ~140 kB and would balloon the
 * first-load bundle if imported eagerly. Dynamic-import it so it only
 * loads when the user clicks Connect for the first time.
 */
const LazyConnectFlow = dynamic(() => import('@/components/LazyConnectFlow'), {
  ssr: false,
  loading: () => null,
});

/**
 * Same lazy-import reasoning as LazyConnectFlow: the crypto unlock flow
 * brings in permit signing + contract writes on top of the connect bundle.
 * Only loaded when the user actually clicks "Pay with crypto" — non-paying
 * users never see any of the wagmi/viem write path code.
 */
const LazyPremiumCryptoFlow = dynamic(
  () => import('@/components/LazyPremiumCryptoFlow'),
  { ssr: false, loading: () => null },
);

interface InitialPuzzle {
  dayNumber: number;
  date: string;
  grid: string;
}

interface GameClientProps {
  initialPuzzle: InitialPuzzle;
}

const TUTORIAL_STORAGE_KEY = 'griddle_tutorial_seen_v1';

/**
 * Client wrapper for the game state. The parent `app/page.tsx` is a
 * server component that fetches the puzzle from Neon (without the
 * target word) and passes the shape into here. Game logic, modals,
 * keyboard input, telemetry, and the /api/solve round-trip all live
 * on this side of the server/client boundary.
 */
export default function GameClient({ initialPuzzle }: GameClientProps) {
  const { inMiniApp, fid, username, pfpUrl, displayName } = useFarcaster();
  const router = useRouter();

  // Refs so handleWalletConnect (empty deps array) always reads the
  // latest Farcaster values without being re-created on every context update.
  const inMiniAppRef = useRef(inMiniApp);
  const fidRef = useRef(fid);
  const usernameRef = useRef(username);
  const displayNameRef = useRef(displayName);
  const pfpUrlRef = useRef(pfpUrl);
  useEffect(() => { inMiniAppRef.current = inMiniApp; }, [inMiniApp]);
  useEffect(() => { fidRef.current = fid; }, [fid]);
  useEffect(() => { usernameRef.current = username; }, [username]);
  useEffect(() => { displayNameRef.current = displayName; }, [displayName]);
  useEffect(() => { pfpUrlRef.current = pfpUrl; }, [pfpUrl]);

  /** The wallet currently bound to this session, or null if none. */
  const [sessionWallet, setSessionWallet] = useState<string | null>(null);
  const { dark, toggle: toggleDark } = useDarkMode(sessionWallet);

  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setShowTutorial(!window.localStorage.getItem(TUTORIAL_STORAGE_KEY));
    } catch {
      setShowTutorial(true);
    }
  }, []);

  const dismissTutorial = useCallback(() => {
    try {
      window.localStorage.setItem(TUTORIAL_STORAGE_KEY, '1');
    } catch {
      // noop
    }
    setShowTutorial(false);
  }, []);

  // Reopening the tutorial from the HOW TO PLAY link is an explicit user
  // action — we deliberately don't re-arm the first-visit flag.
  const openTutorial = useCallback(() => setShowTutorial(true), []);

  const [solveResult, setSolveResult] = useState<{
    solveMs: number;
    unassisted: boolean;
    word: string;
  } | null>(null);

  /**
   * POST the claimed word to the server. The server compares it against
   * the stored puzzle answer and returns the verdict. On success the
   * word comes back in the response (which is fine — the client just
   * typed it, it’s not a leak at that point).
   */
  const handleSolveAttempt = useCallback(
    async (
      payload: SolvePayload & { unassisted: boolean },
    ): Promise<SolveVerdict> => {
      try {
        const res = await fetch('/api/solve', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            dayNumber: initialPuzzle.dayNumber,
            claimedWord: payload.claimedWord,
            clientSolveMs: payload.clientSolveMs,
            keystrokeIntervalsMs: payload.keystrokeIntervalsMs,
            keystrokeCount: payload.keystrokeCount,
            unassisted: payload.unassisted,
          }),
        });
        if (!res.ok) return { solved: false };
        const data = (await res.json()) as { solved: boolean; word?: string };
        // Strict contract: only return solved=true if the server also
        // returned a string `word`. Anything else is a verification
        // failure from the client’s perspective, which causes a shake
        // instead of locking the UI into a half-solved state.
        if (data.solved === true && typeof data.word === 'string') {
          return { solved: true, word: data.word };
        }
        return { solved: false };
      } catch {
        return { solved: false };
      }
    },
    [initialPuzzle.dayNumber],
  );

  const handleSolved = useCallback(
    (payload: SolvePayload & { unassisted: boolean; word: string }) => {
      setSolveResult({
        solveMs: payload.clientSolveMs,
        unassisted: payload.unassisted,
        word: payload.word,
      });
    },
    [],
  );

  const [state, actions] = useGriddle({
    grid: initialPuzzle.grid,
    onSolveAttempt: handleSolveAttempt,
    onSolved: handleSolved,
    disabled: showTutorial,
  });

  const handlePlayAgain = useCallback(() => {
    setSolveResult(null);
    actions.reset();
  }, [actions]);

  /**
   * Wallet linking + premium read. Fired once when a wallet connects.
   * The link endpoint retroactively attributes anonymous solves on this
   * session to the wallet, then we read the premium status to gate any
   * future premium-only UI.
   */
  const [premium, setPremium] = useState(false);

  // Check session-based premium on mount (covers fiat buyers who haven't
  // connected a wallet yet). This runs once, client-side only.
  useEffect(() => {
    fetch('/api/premium/session')
      .then((r) => r.ok ? r.json() : null)
      .then((data: { premium?: boolean } | null) => {
        if (data?.premium) setPremium(true);
      })
      .catch(() => {/* best-effort */});
  }, []);

  // Hydrate hasSessionProfile from /api/profile on mount. Required so the
  // account state survives a page reload — including the post-magic-link
  // redirect to /?auth=ok, which otherwise resets hasSessionProfile to
  // false and leaves StatsModal showing the anonymous CTA.
  useEffect(() => {
    fetch('/api/profile')
      .then((r) => r.ok ? r.json() : null)
      .then((data: { profile: unknown | null } | null) => {
        if (data?.profile) setHasSessionProfile(true);
      })
      .catch(() => {/* best-effort */});
  }, []);

  // Post-magic-link: /?auth=ok means the verify endpoint just bound a
  // session profile. Open the stats modal so the user sees their new
  // account state immediately, and strip the query param so a subsequent
  // reload doesn't re-pop the modal.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'ok') {
      setHasSessionProfile(true);
      setShowStats(true);
      params.delete('auth');
      const qs = params.toString();
      window.history.replaceState(
        null,
        '',
        window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash,
      );
    }
  }, []);

  const refreshPremium = useCallback(async (wallet: string) => {
    try {
      const res = await fetch(`/api/premium/${wallet}`);
      if (res.ok) {
        const data = (await res.json()) as { premium?: boolean };
        if (data.premium) setPremium(true);
      }
    } catch {
      // best-effort; leave previous state as-is
    }
  }, []);

  const handleWalletConnect = useCallback(
    async (address: string) => {
      const normalized = address.toLowerCase();
      // Link wallet in KV BEFORE setting sessionWallet in state. useDarkMode
      // fires an effect when sessionWallet changes and immediately calls
      // GET /api/settings (which reads the wallet via getSessionWallet from KV).
      // If setSessionWallet fires before the link POST completes, the KV entry
      // doesn't exist yet and the settings fetch returns wallet:null, silently
      // skipping the dark-mode DB sync.
      try {
        await fetch('/api/wallet/link', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ wallet: address }),
        });
      } catch {
        // link is best-effort — proceed even on failure so UI updates
      }

      // Farcaster miniapp: upsert a rich profile using FID + username + pfp.
      // The API auto-merges with any existing wallet profile and binds the
      // result to the session so /api/profile reads correctly.
      // Read from refs — not from closure — so we always get the
      // latest Farcaster context even though this callback has empty deps.
      if (inMiniAppRef.current && fidRef.current) {
        fetch('/api/profile/farcaster', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            fid: fidRef.current,
            username: usernameRef.current ?? null,
            displayName: displayNameRef.current ?? null,
            avatarUrl: pfpUrlRef.current ?? null,
            wallet: normalized,
          }),
        }).catch(() => {/* best-effort */});
      }

      setSessionWallet(normalized);
      // Check wallet premium. If the wallet doesn't have a premium_users
      // row but the session does (fiat paid before wallet connect), migrate
      // the session premium to the wallet so future loads use the wallet key.
      const walletRes = await fetch(`/api/premium/${normalized}`).catch(() => null);
      // Only parse a successful response — a failed or errored check
      // must NOT trigger migration (GETDEL would delete the session key,
      // and onConflictDoUpdate would overwrite a crypto-paid row with fiat).
      const walletData = walletRes?.ok
        ? await walletRes.json().catch(() => null) as { premium?: boolean } | null
        : null;
      if (walletData?.premium) {
        setPremium(true);
      } else if (walletRes?.ok && walletData !== null) {
        // Confirmed via a successful response that the wallet has no premium row.
        // Safe to attempt migration — fire-and-forget. On failure the migrate
        // route restores the session key so the next connect can retry.
        fetch('/api/premium/migrate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ wallet: normalized }),
        })
          .then((r) => r.ok ? r.json() : null)
          .then((data: { migrated?: boolean } | null) => {
            if (data?.migrated) setPremium(true);
          })
          .catch(() => {/* best-effort */});
      }
      // If walletRes was null/non-ok (network error, 5xx), skip migration
      // entirely — we can't distinguish "no premium" from "check failed".
    },
    [],
  );

  // Reset premium state on disconnect AND clear the server-side
  // session→wallet binding so subsequent solves aren’t silently
  // attributed to the just-disconnected wallet.
  const handleWalletDisconnect = useCallback(() => {
    setSessionWallet(null);
    setPremium(false);
    fetch('/api/wallet/link', { method: 'DELETE' }).catch(() => {
      // Best-effort: the client UI is already in disconnect state,
      // a failed delete just means the binding lingers in KV until
      // the TTL expires or the next connect overwrites it.
    });
  }, []);

  // walletEnabled gates the dynamic import of the wagmi stack. False
  // until the user clicks Connect for the first time. Once true, the
  // LazyConnectFlow chunk is fetched, WalletProvider mounts, and the
  // connector picker auto-opens (see LazyConnectFlow’s AutoOpener).
  //
  // pickerOpenKey force-opens the picker every time it bumps. Needed
  // because after a disconnect, `walletEnabled` is already true — so
  // a subsequent `triggerConnect()` wouldn't re-mount LazyConnectFlow
  // and AutoOpener's effect wouldn't re-fire. Bumping the key from
  // the parent is the explicit "please open the picker again" signal.
  const [walletEnabled, setWalletEnabled] = useState(false);
  const [pickerOpenKey, setPickerOpenKey] = useState(0);

  // Mount WagmiProvider immediately on page load so wagmi's persisted
  // state auto-reconnects without requiring a user click. Previously
  // walletEnabled only flipped true on manual Connect — without this
  // effect, removing the header Connect button means wagmi never mounts
  // on reload and auto-reconnect never fires.
  useEffect(() => { setWalletEnabled(true); }, []);

  const triggerConnect = useCallback(() => {
    setWalletEnabled(true);
    setPickerOpenKey((k) => k + 1);
  }, []);

  // Modal state for the three HomeTiles. Only one can be open at a
  // time — the parent owns the premium-gate decision so the tiles stay
  // dumb (just emit click events).
  const [showStats, setShowStats] = useState(false);
  const [showCreateProfile, setShowCreateProfile] = useState(false);
  // True once a session-profile KV binding exists (email/handle-only profile).
  // Passed to StatsModal so hasAccount reflects it immediately post-creation.
  const [hasSessionProfile, setHasSessionProfile] = useState(false);
  const [premiumGate, setPremiumGate] =
    useState<null | 'leaderboard' | 'archive' | 'premium'>(null);

  /**
   * Whether the crypto unlock flow overlay is mounted. True between the
   * user clicking "Pay with crypto" and either success (→ refresh
   * premium, close both modals) or cancel/error (→ close the overlay,
   * leave the gate modal open so they can retry or switch to cash).
   */
  const [showCryptoFlow, setShowCryptoFlow] = useState(false);

  const handleUnlockCrypto = useCallback(() => {
    setShowCryptoFlow(true);
  }, []);

  /**
   * POST to Stripe checkout and redirect. No wallet required —
   * premium binds to the session in Upstash and migrates to a wallet
   * row on first connect. Passing the wallet when available lets the
   * webhook skip the migration step.
   */
  const handleUnlockFiat = useCallback(async () => {
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet: sessionWallet ?? undefined }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Checkout failed: ${body}`);
    }
    const data = (await res.json()) as { url?: string };
    if (!data.url) throw new Error('Checkout did not return a URL');
    window.location.href = data.url;
  }, [sessionWallet]);

  const handleCryptoUnlocked = useCallback(
    (wallet: string) => {
      setShowCryptoFlow(false);
      setPremiumGate(null);
      void refreshPremium(wallet);
    },
    [refreshPremium],
  );

  const handleStatsClick = useCallback(() => setShowStats(true), []);
  const handleLeaderboardClick = useCallback(() => {
    if (premium) {
      router.push(`/leaderboard/${initialPuzzle.dayNumber}`);
    } else {
      setPremiumGate('leaderboard');
    }
  }, [premium, router, initialPuzzle.dayNumber]);
  const handleArchiveClick = useCallback(() => {
    if (premium) {
      router.push('/archive');
    } else {
      setPremiumGate('archive');
    }
  }, [premium, router]);

  const monogram = sessionWallet ? sessionWallet.slice(2, 3).toUpperCase() : '?';

  return (
    <>
      {/* LazyConnectFlow stays mounted once enabled so wagmi can
          auto-reconnect on page load. The ConnectButton is visually
          clipped to a 0×0 area — no visible header button. The wrapper
          must NOT use display:none (blocks DOM clicks) or
          visibility:hidden (inherits to children). overflow:hidden on a
          0×0 absolute div clips the button visually; position:fixed
          descendants (the picker overlay) escape overflow:hidden so the
          picker renders correctly over the whole page. AutoOpener fires
          document.querySelector().click() which works on clipped elements. */}
      {walletEnabled && (
        <div aria-hidden className="absolute w-0 h-0 overflow-hidden">
          <LazyConnectFlow
            onConnect={handleWalletConnect}
            onDisconnect={handleWalletDisconnect}
            openKey={pickerOpenKey}
          />
        </div>
      )}

      <main className="flex-1 flex flex-col items-center px-4 pt-10 pb-6 gap-6">
        <header className="text-center">
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight text-gray-900 dark:text-gray-100">
            Griddle
          </h1>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mt-1 tabular-nums flex items-center justify-center gap-1.5">
            <span>
              #{initialPuzzle.dayNumber.toString().padStart(3, '0')} · find the 9-letter word
            </span>
            {premium && (
              <span className="text-accent inline-flex items-center" title="Premium unlocked">
                <Diamond className="w-3.5 h-3.5" weight="fill" aria-hidden />
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={openTutorial}
            className="mt-2 text-[11px] font-bold uppercase tracking-wider text-accent hover:text-accent/80 transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          >
            How to play
          </button>
        </header>

        <FoundWords words={state.foundWords} />

        <Grid
          grid={initialPuzzle.grid}
          cellStates={state.cellStates}
          sequenceByCell={state.sequenceByCell}
          shakeSignal={state.shakeSignal}
          solved={state.solved}
          onCellTap={actions.tapCell}
        />

        <WordSlots letters={state.letters} />

        <div className="flex gap-3 mt-1">
          <button
            type="button"
            className="btn-secondary"
            onClick={actions.backspace}
            disabled={state.pendingSolve}
          >
            Backspace
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={actions.reset}
            disabled={state.pendingSolve}
          >
            Reset
          </button>
        </div>

        <HomeTiles
          onStatsClick={handleStatsClick}
          onLeaderboardClick={handleLeaderboardClick}
          onArchiveClick={handleArchiveClick}
          pfpUrl={pfpUrl}
          monogram={monogram}
          premium={premium}
        />

        <NextPuzzleCountdown />
      </main>

      <TutorialModal open={showTutorial} onDismiss={dismissTutorial} />

      <StatsModal
        open={showStats}
        premium={premium}
        hasSessionProfile={hasSessionProfile}
        onCreateProfile={() => { setShowStats(false); setShowCreateProfile(true); }}
        dark={dark}
        onToggleDark={toggleDark}
        onClose={() => setShowStats(false)}
        onConnect={() => { setShowStats(false); triggerConnect(); }}
        onUpgrade={() => { setShowStats(false); setPremiumGate('premium'); }}
        onRefreshPremium={() => { if (sessionWallet) void refreshPremium(sessionWallet); }}
        pfpUrl={pfpUrl}
        displayName={displayName}
      />

      {/* CreateProfileModal rendered at top level — NOT inside StatsModal —
          so its position:fixed overlay escapes the animate-slide-up transform
          that would create a containing block and clip fixed descendants. */}
      {showCreateProfile && (
        <CreateProfileModal
          onClose={() => { setShowCreateProfile(false); setShowStats(true); }}
          onConnectWallet={() => { setShowCreateProfile(false); triggerConnect(); }}
          onProfileCreated={() => {
            setHasSessionProfile(true);
            setShowCreateProfile(false);
            setShowStats(true);
          }}
        />
      )}

      {premiumGate !== null && (
        <PremiumGateModal
          feature={premiumGate}
          sessionWallet={sessionWallet}
          onClose={() => setPremiumGate(null)}
          onUnlockCrypto={handleUnlockCrypto}
          onUnlockFiat={handleUnlockFiat}
        />
      )}

      {showCryptoFlow && (
        <div
          className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4 animate-fade-in"
          onClick={() => setShowCryptoFlow(false)}
        >
          <div
            className="modal-sheet sm:rounded-card animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <LazyPremiumCryptoFlow
              onUnlocked={handleCryptoUnlocked}
              onCancel={() => setShowCryptoFlow(false)}
            />
          </div>
        </div>
      )}

      {solveResult && (
        <SolveModal
          dayNumber={initialPuzzle.dayNumber}
          word={solveResult.word}
          grid={initialPuzzle.grid}
          solveMs={solveResult.solveMs}
          unassisted={solveResult.unassisted}
          inMiniApp={inMiniApp}
          onPlayAgain={handlePlayAgain}
          onClose={() => setSolveResult(null)}
        />
      )}
    </>
  );
}
