'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Grid } from '@/components/Grid';
import { WordSlots } from '@/components/WordSlots';
import { SolveModal } from '@/components/SolveModal';
import { TutorialModal } from '@/components/TutorialModal';
import { HomeTiles } from '@/components/HomeTiles';
import { FoundWords } from '@/components/FoundWords';
import { StatsModal } from '@/components/StatsModal';
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
  const { inMiniApp, pfpUrl, displayName } = useFarcaster();
  const router = useRouter();

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
  const handleWalletConnect = useCallback(async (address: string) => {
    setSessionWallet(address.toLowerCase());
    try {
      await fetch('/api/wallet/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: address }),
      });
      const res = await fetch(`/api/premium/${address}`);
      if (res.ok) {
        const data = (await res.json()) as { premium?: boolean };
        setPremium(!!data.premium);
      }
    } catch {
      // best-effort: connection still succeeds, we just don't backfill
      // or know about premium status
    }
  }, []);

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
  const triggerConnect = useCallback(() => {
    setWalletEnabled(true);
    setPickerOpenKey((k) => k + 1);
  }, []);

  // Modal state for the three HomeTiles. Only one can be open at a
  // time — the parent owns the premium-gate decision so the tiles stay
  // dumb (just emit click events).
  const [showStats, setShowStats] = useState(false);
  const [premiumGate, setPremiumGate] =
    useState<null | 'leaderboard' | 'archive'>(null);

  /** The wallet currently bound to this session, or null if none. */
  const [sessionWallet, setSessionWallet] = useState<string | null>(null);

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
      <main className="flex-1 flex flex-col items-center px-4 pt-10 pb-6 gap-6">
        <div className="absolute top-4 right-4">
          {walletEnabled ? (
            <LazyConnectFlow
              onConnect={handleWalletConnect}
              onDisconnect={handleWalletDisconnect}
              openKey={pickerOpenKey}
            />
          ) : (
            <button
              type="button"
              onClick={triggerConnect}
              className="bg-brand text-white rounded-pill px-4 py-1.5 text-xs font-bold uppercase tracking-wider hover:bg-brand-600 transition-colors duration-fast"
            >
              Connect
            </button>
          )}
        </div>
        <header className="text-center">
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight text-gray-900">
            Griddle
          </h1>
          <p className="text-sm font-medium text-gray-500 mt-1 tabular-nums">
            #{initialPuzzle.dayNumber.toString().padStart(3, '0')} · find the 9-letter word
            {premium && (
              <span className="ml-2 text-accent" title="Premium unlocked">
                ◆
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
        onClose={() => setShowStats(false)}
        onConnect={() => {
          setShowStats(false);
          triggerConnect();
        }}
        pfpUrl={pfpUrl}
        displayName={displayName}
      />

      <PremiumGateModal
        open={premiumGate !== null}
        feature={premiumGate ?? 'leaderboard'}
        onClose={() => setPremiumGate(null)}
        onUnlockClick={() => {
          // Stubbed — M4f wires this up to the actual Stripe / permit-burn flows.
        }}
      />

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
