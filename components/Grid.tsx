'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CellState } from '@/lib/useGriddle';

type AnimPhase = 'idle' | 'glowing' | 'shuffling' | 'settled';

// Post-solve reveal: glow pulses, then tiles shuffle into reading order
// (W-O-N / D-E-R / F-U-L) staggered by solve-path order. Total duration
// drives when GameClient opens the SolveModal, via onReorderComplete.
const GLOW_DELAY_MS = 400;
const STAGGER_MS = 60;
const SHUFFLE_DURATION_MS = 700;

interface GridProps {
  grid: string;
  cellStates: CellState[];
  sequenceByCell: Array<number | null>;
  /**
   * Solve path — indices of cells in the order the player visited them.
   * Only consulted when `solved` flips true; drives the per-tile
   * transform that reorders tiles into left-to-right reading order.
   */
  path: number[];
  shakeSignal: number;
  solved: boolean;
  onCellTap: (idx: number) => void;
  /**
   * Fires once the shuffle animation has settled. GameClient defers
   * opening SolveModal on this so the reveal plays uninterrupted.
   */
  onReorderComplete?: () => void;
}

export function Grid({ grid, cellStates, sequenceByCell, path, shakeSignal, solved, onCellTap, onReorderComplete }: GridProps) {
  const [shaking, setShaking] = useState(false);
  const [animPhase, setAnimPhase] = useState<AnimPhase>('idle');

  // Keep the completion callback behind a ref so its identity doesn't
  // re-run the state-machine effect on every GameClient render.
  const onReorderCompleteRef = useRef(onReorderComplete);
  useEffect(() => { onReorderCompleteRef.current = onReorderComplete; }, [onReorderComplete]);

  useEffect(() => {
    if (shakeSignal === 0) return;
    setShaking(true);
    const t = setTimeout(() => setShaking(false), 420);
    return () => clearTimeout(t);
  }, [shakeSignal]);

  // Solve-reveal state machine. `solved` flipping true schedules the
  // glow pause and the settle handoff; flipping false (reset / fullReset
  // / play again) snaps back to idle so tiles return to their original
  // positions.
  useEffect(() => {
    if (!solved) {
      setAnimPhase('idle');
      return;
    }
    setAnimPhase('glowing');
    const toShuffle = setTimeout(() => setAnimPhase('shuffling'), GLOW_DELAY_MS);
    const totalMs = GLOW_DELAY_MS + 8 * STAGGER_MS + SHUFFLE_DURATION_MS;
    const toSettled = setTimeout(() => {
      setAnimPhase('settled');
      onReorderCompleteRef.current?.();
    }, totalMs);
    return () => {
      clearTimeout(toShuffle);
      clearTimeout(toSettled);
    };
  }, [solved]);

  // Measure tile pitch (cell size + gap) so transforms are pixel-accurate
  // at any breakpoint. Recomputed on resize so a window-resize mid-reveal
  // doesn't land tiles in the wrong spots.
  const cellRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [unit, setUnit] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const c0 = cellRefs.current[0];
      const c1 = cellRefs.current[1];
      const c3 = cellRefs.current[3];
      if (!c0 || !c1 || !c3) return;
      const r0 = c0.getBoundingClientRect();
      const r1 = c1.getBoundingClientRect();
      const r3 = c3.getBoundingClientRect();
      setUnit({ x: r1.left - r0.left, y: r3.top - r0.top });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const transforms = useMemo<Array<{ dx: number; dy: number; delay: number } | null>>(() => {
    const nulls: Array<null> = new Array(9).fill(null);
    if (animPhase !== 'shuffling' && animPhase !== 'settled') return nulls;
    if (!unit || path.length !== 9) return nulls;
    const result: Array<{ dx: number; dy: number; delay: number } | null> = new Array(9).fill(null);
    for (let step = 0; step < 9; step++) {
      const origIdx = path[step];
      const origRow = Math.floor(origIdx / 3);
      const origCol = origIdx % 3;
      const targRow = Math.floor(step / 3);
      const targCol = step % 3;
      result[origIdx] = {
        dx: (targCol - origCol) * unit.x,
        dy: (targRow - origRow) * unit.y,
        delay: step * STAGGER_MS,
      };
    }
    return result;
  }, [animPhase, unit, path]);

  const dimSequence = animPhase === 'shuffling' || animPhase === 'settled';

  // `onCellTap` from useGriddle is a `useCallback` whose deps include
  // `path`, so its reference changes on every tap. Passing it straight
  // through would defeat `React.memo` on Cell (shallow-compare sees a
  // new function and re-renders). A ref + empty-dep stable forwarder
  // decouples identity from content: Cell's `onTap` never changes, so
  // cells whose own props are unchanged stay memoized, while the
  // forwarder still invokes the latest callback through the ref.
  const onCellTapRef = useRef(onCellTap);
  useEffect(() => {
    onCellTapRef.current = onCellTap;
  });
  const stableOnTap = useCallback((idx: number) => {
    onCellTapRef.current(idx);
  }, []);

  return (
    <div
      className={[
        'grid grid-cols-3 gap-2 p-2 rounded-card',
        shaking ? 'animate-shake' : '',
        solved ? 'animate-pulse-glow rounded-card' : '',
      ].join(' ')}
    >
      {Array.from({ length: 9 }, (_, i) => {
        const tf = transforms[i];
        // Lift each tile as it flies so later-step tiles pass over
        // earlier movers cleanly. Step index doubles as a z-order
        // signal (later step = higher layer during overlap).
        const wrapperStyle: React.CSSProperties | undefined = tf
          ? {
              transform: `translate(${tf.dx}px, ${tf.dy}px)`,
              transition: `transform ${SHUFFLE_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1) ${tf.delay}ms`,
              zIndex: 1 + tf.delay / STAGGER_MS,
              position: 'relative',
            }
          : undefined;
        return (
          <div
            key={i}
            ref={(el) => { cellRefs.current[i] = el; }}
            style={wrapperStyle}
          >
            <Cell
              index={i}
              letter={grid[i]}
              state={cellStates[i]}
              sequence={sequenceByCell[i]}
              onTap={stableOnTap}
              dimSequence={dimSequence}
            />
          </div>
        );
      })}
    </div>
  );
}

interface CellProps {
  index: number;
  letter: string;
  state: CellState;
  sequence: number | null;
  onTap: (idx: number) => void;
  dimSequence?: boolean;
}

// Memoized so a state change on one cell doesn't re-render all nine.
// `onTap` is guaranteed stable by the ref indirection in Grid above,
// so memo's shallow comparison actually prunes unchanged cells.
const Cell = memo(function Cell({ index, letter, state, sequence, onTap, dimSequence }: CellProps) {
  const base =
    'relative w-20 h-20 sm:w-24 sm:h-24 rounded-lg border-4 flex items-center justify-center text-3xl sm:text-4xl font-black uppercase transition-all duration-fast select-none';
  /**
   * Visual semantics: dark + white text means "this letter is consumed
   * (in use or already used)", light + dark text means "this letter is
   * still in play (available or temporarily off-limits)".
   *
   * Sub-distinctions inside each category:
   *   current (consumed)  -  scale-105 + shadow-card so it visually pops
   *                        as the focused / most-recent cell
   *   used    (consumed)  -  no scale, smaller shadow, sequence number
   *                        in the corner showing the typing order
   *   available (in play)  -  pale green tint signals "go"
   *   open    (in play)   -  neutral white before any letter is typed
   *   blocked (in play)   -  pale gray, muted text, no X overlay so the
   *                        letter remains readable for planning ahead
   */
  const stateClasses: Record<CellState, string> = {
    open: 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 hover:border-brand dark:hover:border-brand-400 shadow-btn',
    available: 'bg-success-50 dark:bg-success-900/30 border-success-200 dark:border-success-700 text-gray-900 dark:text-gray-100 hover:border-success-500 shadow-btn',
    current: 'bg-brand border-brand text-white scale-105 shadow-card',
    used: 'bg-brand-800 border-brand-800 text-white shadow-btn',
    blocked: 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed',
  };
  const disabled = state === 'blocked';

  return (
    <button
      type="button"
      onClick={() => onTap(index)}
      disabled={disabled}
      className={`${base} ${stateClasses[state]}`}
      aria-label={`Letter ${letter}, ${state}`}
    >
      <span>{letter.toUpperCase()}</span>
      {state === 'used' && sequence !== null && (
        <span
          className={`absolute top-1 right-1.5 text-[10px] font-semibold text-white/70 tabular-nums transition-opacity duration-300 ${dimSequence ? 'opacity-0' : 'opacity-100'}`}
        >
          {sequence}
        </span>
      )}
    </button>
  );
});
