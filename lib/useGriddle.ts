'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getBlockedCells, isValidPath } from './adjacency';
import { isDictionaryWord } from './dictionary';
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
  // Guards the async solve effect against re-firing while the same
  // 9-letter path is still in flight.
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

  // Real-time shorter-word detection (4-8 letters)
  useEffect(() => {
    if (letters.length < 4 || letters.length > 8) {
      return;
    }
    const candidate = letters.join('');
    if (candidate === lastFlashedWordRef.current) return;
    if (isDictionaryWord(candidate)) {
      lastFlashedWordRef.current = candidate;
      setFlashWord(candidate);
      setFlashKey((k) => k + 1);
    }
  }, [letters]);

  // Async solve detection on reaching 9 letters. Fires once per unique
  // 9-letter attempt — backspace → retype re-fires because the ref is
  // reset on length < 9.
  useEffect(() => {
    if (solved || pendingSolve) return;
    if (letters.length !== 9) {
      // Reset the in-flight guard as soon as the user steps off a
      // 9-letter attempt (backspace, reset, etc.) so the next 9-letter
      // attempt fires a fresh check.
      inFlightAttemptRef.current = null;
      return;
    }
    if (!isValidPath(path)) return;
    const attempt = letters.join('');
    if (inFlightAttemptRef.current === attempt) return;
    inFlightAttemptRef.current = attempt;

    const payload = telemetryRef.current!.build(attempt);
    setPendingSolve(true);

    let cancelled = false;
    onSolveAttempt({ ...payload, unassisted })
      .then((verdict) => {
        if (cancelled) return;
        if (verdict.solved) {
          setSolved(true);
          if (verdict.word != null) {
            onSolved?.({ ...payload, unassisted, word: verdict.word });
          }
        } else {
          triggerShake();
        }
      })
      .catch(() => {
        if (cancelled) return;
        triggerShake();
      })
      .finally(() => {
        if (cancelled) return;
        setPendingSolve(false);
      });

    return () => {
      cancelled = true;
    };
  }, [letters, path, solved, pendingSolve, onSolveAttempt, onSolved, unassisted, triggerShake]);

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
      telemetryRef.current?.recordKeystroke();
      setPath((p) => [...p, foundCell!]);
    },
    [grid, path, solved, disabled, pendingSolve, triggerShake],
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
      telemetryRef.current?.recordKeystroke();
      setPath((p) => [...p, cellIdx]);
    },
    [path, solved, disabled, pendingSolve, triggerShake],
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
