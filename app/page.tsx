'use client';

import { useCallback, useState } from 'react';
import { Grid } from '@/components/Grid';
import { WordSlots } from '@/components/WordSlots';
import { FlashBadge } from '@/components/FlashBadge';
import { SolveModal } from '@/components/SolveModal';
import { TutorialModal } from '@/components/TutorialModal';
import { NextPuzzleCountdown } from '@/components/NextPuzzleCountdown';
import { useGriddle } from '@/lib/useGriddle';
import { getPuzzleForDay } from '@/lib/scheduler';

export default function Page() {
  // DEV: puzzle #1 hardcoded client-side for M1/M2. In M4 this becomes a
  // server-fetched puzzle where the `word` is never sent to the client and
  // solve verification happens via /api/solve.
  const puzzle = getPuzzleForDay(1);

  const [solveResult, setSolveResult] = useState<{
    solveMs: number;
    unassisted: boolean;
  } | null>(null);

  const handleSolve = useCallback(
    (payload: { clientSolveMs: number; unassisted: boolean }) => {
      setSolveResult({ solveMs: payload.clientSolveMs, unassisted: payload.unassisted });
    },
    [],
  );

  const [state, actions] = useGriddle({
    grid: puzzle.grid,
    devTargetWord: puzzle.word,
    onSolve: handleSolve,
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
            #{puzzle.dayNumber.toString().padStart(3, '0')} · find the 9-letter word
          </p>
        </header>

        <FlashBadge word={state.flashWord} flashKey={state.flashKey} />

        <Grid
          grid={puzzle.grid}
          cellStates={state.cellStates}
          sequenceByCell={state.sequenceByCell}
          shakeSignal={state.shakeSignal}
          solved={state.solved}
          onCellTap={actions.tapCell}
        />

        <WordSlots letters={state.letters} />

        <div className="flex gap-3 mt-1">
          <button type="button" className="btn-secondary" onClick={actions.backspace}>
            Backspace
          </button>
          <button type="button" className="btn-secondary" onClick={actions.reset}>
            Reset
          </button>
        </div>

        <div className="max-w-md mx-auto bg-brand-50 rounded-card px-5 py-4 text-sm text-gray-800 leading-relaxed">
          <span className="font-bold text-brand-700">How to play:</span> Find the 9-letter
          word using all cells. After picking a letter, the crossed-out cells are
          off-limits — consecutive letters can’t be neighbors. Type or tap to build your
          word.
        </div>

        <NextPuzzleCountdown />
      </main>

      <TutorialModal />

      {solveResult && (
        <SolveModal
          dayNumber={puzzle.dayNumber}
          word={puzzle.word}
          grid={puzzle.grid}
          solveMs={solveResult.solveMs}
          unassisted={solveResult.unassisted}
          onPlayAgain={handlePlayAgain}
          onClose={() => setSolveResult(null)}
        />
      )}
    </>
  );
}
