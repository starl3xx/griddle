'use client';

import { useCallback, useEffect, useState } from 'react';
import { Grid } from '@/components/Grid';
import { WordSlots } from '@/components/WordSlots';
import { FlashBadge } from '@/components/FlashBadge';
import { SolveModal } from '@/components/SolveModal';
import { TutorialModal } from '@/components/TutorialModal';
import { HowToPlayCard } from '@/components/HowToPlayCard';
import { NextPuzzleCountdown } from '@/components/NextPuzzleCountdown';
import { useGriddle, type SolveVerdict } from '@/lib/useGriddle';
import { useFarcaster } from '@/lib/farcaster';
import type { SolvePayload } from '@/lib/telemetry';

interface InitialPuzzle {
  dayNumber: number;
  date: string;
  grid: string;
}

interface GameClientProps {
  initialPuzzle: InitialPuzzle;
}

const TUTORIAL_STORAGE_KEY = 'griddle_tutorial_seen_v1';
const HOWTOPLAY_STORAGE_KEY = 'griddle_howtoplay_dismissed_v1';

/**
 * Client wrapper for the game state. The parent `app/page.tsx` is a
 * server component that fetches the puzzle from Neon (without the
 * target word) and passes the shape into here. Game logic, modals,
 * keyboard input, telemetry, and the /api/solve round-trip all live
 * on this side of the server/client boundary.
 */
export default function GameClient({ initialPuzzle }: GameClientProps) {
  const { inMiniApp } = useFarcaster();

  const [showTutorial, setShowTutorial] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setShowTutorial(!window.localStorage.getItem(TUTORIAL_STORAGE_KEY));
      setShowHowToPlay(!window.localStorage.getItem(HOWTOPLAY_STORAGE_KEY));
    } catch {
      setShowTutorial(true);
      setShowHowToPlay(true);
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

  const dismissHowToPlay = useCallback(() => {
    try {
      window.localStorage.setItem(HOWTOPLAY_STORAGE_KEY, '1');
    } catch {
      // noop
    }
    setShowHowToPlay(false);
  }, []);

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

  return (
    <>
      <main className="flex-1 flex flex-col items-center px-4 pt-10 pb-6 gap-6">
        <header className="text-center">
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight text-gray-900">
            Griddle
          </h1>
          <p className="text-sm font-medium text-gray-500 mt-1 tabular-nums">
            #{initialPuzzle.dayNumber.toString().padStart(3, '0')} · find the 9-letter word
          </p>
        </header>

        <FlashBadge word={state.flashWord} flashKey={state.flashKey} />

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

        {!showTutorial && showHowToPlay && (
          <HowToPlayCard onDismiss={dismissHowToPlay} />
        )}

        <NextPuzzleCountdown />
      </main>

      <TutorialModal open={showTutorial} onDismiss={dismissTutorial} />

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
