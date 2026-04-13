'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getBlockedCells, isValidPath } from './adjacency';
import { isDictionaryWord } from './dictionary';
import { SolveTelemetry, type SolvePayload } from './telemetry';

export type CellState = 'open' | 'current' | 'used' | 'blocked';

export interface GriddleState {
  letters: string[];
  path: number[];
  cellStates: CellState[];
  sequenceByCell: Array<number | null>;
  shakeSignal: number;
  flashWord: string | null;
  flashKey: number;
  solved: boolean;
}

export interface GriddleActions {
  typeLetter: (letter: string) => void;
  tapCell: (cellIdx: number) => void;
  backspace: () => void;
  reset: () => void;
}

interface UseGriddleOptions {
  grid: string;
  /**
   * DEV ONLY: M1 verifies solves client-side against a known target word.
   * M4 will replace this with a server-side /api/solve verification.
   */
  devTargetWord: string;
  onSolve?: (payload: SolvePayload & { unassisted: boolean }) => void;
  unassisted?: boolean;
}

export function useGriddle({
  grid,
  devTargetWord,
  onSolve,
  unassisted = false,
}: UseGriddleOptions): [GriddleState, GriddleActions] {
  const [path, setPath] = useState<number[]>([]);
  const [shakeSignal, setShakeSignal] = useState(0);
  const [flashWord, setFlashWord] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const [solved, setSolved] = useState(false);

  const telemetryRef = useRef<SolveTelemetry | null>(null);
  if (telemetryRef.current === null) telemetryRef.current = new SolveTelemetry();

  const lastFlashedWordRef = useRef<string | null>(null);

  const letters = useMemo(() => path.map((i) => grid[i]), [path, grid]);

  const cellStates = useMemo<CellState[]>(() => {
    const used = new Set(path);
    const current = path[path.length - 1] ?? null;
    const blocked = getBlockedCells(current);
    return Array.from({ length: 9 }, (_, i) => {
      if (i === current) return 'current';
      if (used.has(i)) return 'used';
      if (blocked.has(i)) return 'blocked';
      return 'open';
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
    setSolved(false);
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

  // Solve detection on reaching 9 letters
  useEffect(() => {
    if (solved) return;
    if (letters.length !== 9) return;
    if (!isValidPath(path)) return;
    const attempt = letters.join('');
    if (attempt === devTargetWord) {
      setSolved(true);
      const payload = telemetryRef.current!.build(attempt);
      onSolve?.({ ...payload, unassisted });
    } else {
      // 9 letters laid down but not the target — shake + bounce back
      triggerShake();
    }
  }, [letters, path, devTargetWord, solved, onSolve, unassisted, triggerShake]);

  const typeLetter = useCallback(
    (letter: string) => {
      if (solved) return;
      const lc = letter.toLowerCase();
      if (!/^[a-z]$/.test(lc)) return;
      // find the cell in grid that matches AND is not yet used AND is not blocked
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
    [grid, path, solved, triggerShake],
  );

  const tapCell = useCallback(
    (cellIdx: number) => {
      if (solved) return;
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
    [path, solved, triggerShake],
  );

  const backspace = useCallback(() => {
    if (solved) return;
    setPath((p) => (p.length === 0 ? p : p.slice(0, -1)));
    lastFlashedWordRef.current = null;
  }, [solved]);

  // Global keyboard listener
  useEffect(() => {
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
  }, [typeLetter, backspace]);

  return [
    { letters, path, cellStates, sequenceByCell, shakeSignal, flashWord, flashKey, solved },
    { typeLetter, tapCell, backspace, reset },
  ];
}
