'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getBlockedCells, isValidPath } from './adjacency';
import { isDictionaryWord, prefetchDictionary } from './dictionary';
import { SolveTelemetry, type SolvePayload } from './telemetry';

export type CellState = 'open' | 'available' | 'current' | 'used' | 'blocked';

export interface GriddleState {
  letters: string[];
  path: number[];
  cellStates: CellState[];
  sequenceByCell: Array<number | null>;
  shakeSignal: number;
  flashWord: string | null;
  flashKey: number;
  solved: boolean;
  /** True while an async solve verification is in flight. */
  pendingSolve: boolean;
}

export interface GriddleActions {
  typeLetter: (letter: string) => void;
  tapCell: (cellIdx: number) => void;
  backspace: () => void;
  reset: () => void;
}

/**
 * Verdict returned by the server for a solve attempt. `solved=true` means
 * the claimed word matched the stored answer — the hook sets solved state
 * and fires onSolved. `solved=false` triggers a shake and lets the user
 * backspace / retry.
 */
export interface SolveVerdict {
  solved: boolean;
  word?: string;
}

interface UseGriddleOptions {
  grid: string;
  /**
   * Async solve verification callback. Called when the user has laid
   * down 9 letters on a valid Hamiltonian path. Returns a promise that
   * resolves to a verdict. In production this POSTs to /api/solve; in
   * tests it can be stubbed with a local check.
   */
  onSolveAttempt: (payload: SolvePayload & { unassisted: boolean }) => Promise<SolveVerdict>;
  /** Fires after a verdict with solved=true. */
  onSolved?: (payload: SolvePayload & { unassisted: boolean; word: string }) => void;
  unassisted?: boolean;
  /**
   * When true, all input (keyboard, tap, backspace) is a no-op. Used while
   * a blocking modal (tutorial, future settings) is open so stray keystrokes
   * don’t silently fill the grid behind the modal.
   */
  disabled?: boolean;
}

export function useGriddle({
  grid,
  onSolveAttempt,
  onSolved,
  unassisted = false,
  disabled = false,
}: UseGriddleOptions): [GriddleState, GriddleActions] {
  const [path, setPath] = useState<number[]>([]);
  const [shakeSignal, setShakeSignal] = useState(0);
  const [flashWord, setFlashWord] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const [solved, setSolved] = useState(false);
  const [pendingSolve, setPendingSolve] = useState(false);

  const telemetryRef = useRef<SolveTelemetry | null>(null);
  if (telemetryRef.current === null) telemetryRef.current = new SolveTelemetry();

  const lastFlashedWordRef = useRef<string | null>(null);

  /**
   * Synchronous re-entry guard for solve attempts. Set to the in-flight
   * 9-letter attempt while a /api/solve POST is pending. Cleared in the
   * .finally() of the verify call. Lives in a ref (not state) so reading
   * it inside an input handler reflects the latest value without needing
   * a re-render.
   */
  const inFlightAttemptRef = useRef<string | null>(null);

  const letters = useMemo(() => path.map((i) => grid[i]), [path, grid]);

  const cellStates = useMemo<CellState[]>(() => {
    const used = new Set(path);
    const current = path[path.length - 1] ?? null;
    const blocked = getBlockedCells(current);
    const inProgress = path.length > 0;
    return Array.from({ length: 9 }, (_, i) => {
      if (i === current) return 'current';
      if (used.has(i)) return 'used';
      if (blocked.has(i)) return 'blocked';
      return inProgress ? 'available' : 'open';
    });
  }, [path]);

  const sequenceByCell = useMemo<Array<number | null>>(() => {
    const arr: Array<number | null> = new Array(9).fill(null);
    path.forEach((cell, i) => {
      if (arr[cell] === null) arr[cell] = i + 1;
    });
    return arr;
  }, [path]);

  const triggerShake = useCallback(() => {
    setShakeSignal((s) => s + 1);
  }, []);

  const reset = useCallback(() => {
    setPath([]);
    setFlashWord(null);
    lastFlashedWordRef.current = null;
    inFlightAttemptRef.current = null;
    setSolved(false);
    setPendingSolve(false);
    telemetryRef.current?.reset();
  }, []);

  // Real-time shorter-word detection (4-8 letters). The dictionary is
  // lazy-loaded via dynamic import — the first check after page load
  // may take ~50-100ms while the chunk downloads, but `prefetchDictionary`
  // is fired from the first keystroke handler so the chunk is usually
  // already in flight by the time the user types 4 letters.
  useEffect(() => {
    if (letters.length < 4 || letters.length > 8) return;
    const candidate = letters.join('');
    if (candidate === lastFlashedWordRef.current) return;

    let cancelled = false;
    isDictionaryWord(candidate).then((isWord) => {
      if (cancelled || !isWord) return;
      // Re-check after await — the user may have backspaced past this
      // candidate, which would have nulled lastFlashedWordRef. Only
      // flash if the candidate is still the most recent attempt.
      if (lastFlashedWordRef.current === candidate) return;
      lastFlashedWordRef.current = candidate;
      setFlashWord(candidate);
      setFlashKey((k) => k + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [letters]);

  /**
   * Imperative solve trigger. Called from `typeLetter` / `tapCell` after
   * appending the 9th letter, NOT from a useEffect.
   *
   * Why imperative? An effect that calls `setPendingSolve(true)` and lists
   * `pendingSolve` in its dep array cancels its own async work — the
   * pendingSolve change re-triggers the effect, which fires the previous
   * cleanup, which sets `cancelled = true`, which short-circuits the
   * `.finally()` that was supposed to clear pendingSolve. Net result:
   * pendingSolve gets stuck at `true` and the game freezes after the
   * first 9-letter attempt. Imperative trigger sidesteps the entire
   * effect-cleanup-self-cancel cycle.
   */
  const triggerSolve = useCallback(
    (finalPath: number[]) => {
      if (solved) return;
      if (finalPath.length !== 9) return;
      if (!isValidPath(finalPath)) return;

      const finalLetters = finalPath.map((i) => grid[i]).join('');
      // Re-entry guard: if a verify for the same letters is already in
      // flight, ignore. inFlightAttemptRef is cleared in finally().
      if (inFlightAttemptRef.current === finalLetters) return;
      inFlightAttemptRef.current = finalLetters;

      const payload = telemetryRef.current!.build(finalLetters);
      setPendingSolve(true);

      onSolveAttempt({ ...payload, unassisted })
        .then((verdict) => {
          // Treat "solved without word" as a server contract violation
          // (the API guarantees `word` is present when solved=true).
          // If we ever receive solved=true with no word, fall through
          // to the shake path rather than locking the UI into a
          // half-solved state with no SolveModal.
          if (verdict.solved && verdict.word != null) {
            setSolved(true);
            onSolved?.({ ...payload, unassisted, word: verdict.word });
          } else {
            triggerShake();
          }
        })
        .catch(() => {
          triggerShake();
        })
        .finally(() => {
          setPendingSolve(false);
          inFlightAttemptRef.current = null;
        });
    },
    [grid, solved, onSolveAttempt, onSolved, unassisted, triggerShake],
  );

  const typeLetter = useCallback(
    (letter: string) => {
      if (solved || disabled || pendingSolve) return;
      const lc = letter.toLowerCase();
      if (!/^[a-z]$/.test(lc)) return;
      const used = new Set(path);
      const current = path[path.length - 1] ?? null;
      const blocked = getBlockedCells(current);
      let foundCell: number | null = null;
      for (let i = 0; i < 9; i++) {
        if (grid[i] === lc && !used.has(i) && !blocked.has(i)) {
          foundCell = i;
          break;
        }
      }
      if (foundCell === null) {
        triggerShake();
        return;
      }
      // Warm the dictionary chunk on the first keystroke so it’s ready
      // by the time the user reaches a 4-letter shorter-word check.
      prefetchDictionary();
      telemetryRef.current?.recordKeystroke();
      const newPath = [...path, foundCell];
      setPath(newPath);
      if (newPath.length === 9) triggerSolve(newPath);
    },
    [grid, path, solved, disabled, pendingSolve, triggerShake, triggerSolve],
  );

  const tapCell = useCallback(
    (cellIdx: number) => {
      if (solved || disabled || pendingSolve) return;
      if (cellIdx < 0 || cellIdx > 8) return;
      const used = new Set(path);
      const current = path[path.length - 1] ?? null;
      const blocked = getBlockedCells(current);
      if (used.has(cellIdx) || blocked.has(cellIdx)) {
        triggerShake();
        return;
      }
      prefetchDictionary();
      telemetryRef.current?.recordKeystroke();
      const newPath = [...path, cellIdx];
      setPath(newPath);
      if (newPath.length === 9) triggerSolve(newPath);
    },
    [path, solved, disabled, pendingSolve, triggerShake, triggerSolve],
  );

  const backspace = useCallback(() => {
    if (solved || disabled || pendingSolve) return;
    setPath((p) => (p.length === 0 ? p : p.slice(0, -1)));
    lastFlashedWordRef.current = null;
  }, [solved, disabled, pendingSolve]);

  // Global keyboard listener. Disabled/pending both skip attachment so
  // the browser handles keys normally during modals + in-flight solves.
  useEffect(() => {
    if (disabled || pendingSolve) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        backspace();
        return;
      }
      if (/^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        typeLetter(e.key);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [typeLetter, backspace, disabled, pendingSolve]);

  return [
    { letters, path, cellStates, sequenceByCell, shakeSignal, flashWord, flashKey, solved, pendingSolve },
    { typeLetter, tapCell, backspace, reset },
  ];
}
