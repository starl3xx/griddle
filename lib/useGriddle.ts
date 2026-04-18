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
  solved: boolean;
  /** True while an async solve verification is in flight. */
  pendingSolve: boolean;
  /**
   * Every valid 4–8 letter English word the player has constructed
   * during this attempt, newest first. Persists across backspaces AND
   * across Reset button clicks so a mis-path retry doesn't erase the
   * player's collected progress. Cleared only on a confirmed solve
   * (via `triggerSolve`) or a full page reload. De-duped — a word
   * found twice only appears once.
   */
  foundWords: string[];
}

export interface GriddleActions {
  typeLetter: (letter: string) => void;
  tapCell: (cellIdx: number) => void;
  backspace: () => void;
  reset: () => void;
  /** Hard reset for puzzle switches — clears foundWords and counters too. */
  fullReset: () => void;
  /**
   * Merge server-persisted crumbs into the current foundWords list.
   * De-duped against existing entries. Does NOT fire onCrumbFound
   * (these are already persisted — no need to re-save).
   */
  seedFoundWords: (words: string[]) => void;
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
  /**
   * When true, the real-time crumb detection is suppressed — typing
   * valid 4-8 letter words neither adds them to the foundWords list
   * nor fires onCrumbFound. Used by GameClient after a confirmed
   * solve so post-solve exploration can't discover "new" crumbs: the
   * player's solve is committed (first-solve-wins server-side) and
   * additional finds would have nowhere legitimate to land.
   */
  locked?: boolean;
  /**
   * Words to seed `foundWords` with on the FIRST render. Used by the
   * SSR-hydrated crumbs path — the page server-renders persisted
   * crumbs and threads them through here so the FoundWords strip
   * paints populated from tick zero, rather than flashing empty for
   * the one frame between mount and the client-side /api/crumbs
   * fetch resolving. Passed only on first mount; subsequent
   * crumb arrivals still flow through `seedFoundWords`.
   */
  initialFoundWords?: readonly string[];
  /**
   * Fires whenever a new crumb is discovered (not on initial load).
   * The caller can use this to persist the word server-side.
   */
  onCrumbFound?: (word: string) => void;
}

export function useGriddle({
  grid,
  onSolveAttempt,
  onSolved,
  unassisted = false,
  disabled = false,
  locked = false,
  initialFoundWords,
  onCrumbFound,
}: UseGriddleOptions): [GriddleState, GriddleActions] {
  const [path, setPath] = useState<number[]>([]);
  const [shakeSignal, setShakeSignal] = useState(0);
  const [solved, setSolved] = useState(false);
  const [pendingSolve, setPendingSolve] = useState(false);
  const [foundWords, setFoundWords] = useState<string[]>(
    () => (initialFoundWords ? [...initialFoundWords] : []),
  );

  const telemetryRef = useRef<SolveTelemetry | null>(null);
  if (telemetryRef.current === null) telemetryRef.current = new SolveTelemetry();

  /**
   * Wordmark action counters — live in refs (not state) because
   * nothing in the UI reads them mid-attempt; they're only snapshot
   * at solve time to build the /api/solve payload. Refs avoid pointless
   * re-renders every time the player backspaces. Reset-on-solve is
   * handled in triggerSolve's success branch alongside foundWords.
   */
  const backspaceCountRef = useRef(0);
  const resetCountRef = useRef(0);

  /**
   * Ref mirror of `foundWords` state. `triggerSolve` reads this
   * instead of the closure-captured `foundWords` because the 8-letter
   * dictionary check is async — it runs in a useEffect that may
   * resolve AFTER the user types the 9th letter but BEFORE React
   * re-renders with the updated state. Reading from the ref ensures
   * the payload always captures the latest set of Crumbs, including
   * any that resolved between the last render and the solve trigger.
   */
  const foundWordsRef = useRef<string[]>([]);
  useEffect(() => { foundWordsRef.current = foundWords; }, [foundWords]);

  // Ref mirror of onCrumbFound so the word-detection effect always
  // reads the latest callback without listing it in deps (which would
  // re-fire the effect on every render since the prop is a new closure).
  const onCrumbFoundRef = useRef(onCrumbFound);
  useEffect(() => { onCrumbFoundRef.current = onCrumbFound; }, [onCrumbFound]);

  // Dedup ref for the real-time dictionary check — prevents re-
  // enqueueing the same candidate when the effect re-fires on an
  // identical letters state (which shouldn't happen normally but
  // did when FlashBadge was a separate consumer).
  const lastFoundWordRef = useRef<string | null>(null);

  /**
   * Synchronous re-entry guard for solve attempts. Set to the in-flight
   * 9-letter attempt while a /api/solve POST is pending. Cleared in the
   * .finally() of the verify call. Lives in a ref (not state) so reading
   * it inside an input handler reflects the latest value without needing
   * a re-render.
   */
  const inFlightAttemptRef = useRef<string | null>(null);

  // Generation counter — incremented by fullReset (puzzle switch).
  // triggerSolve captures the current value before the async call and
  // bails in .then() if the generation changed, preventing a stale
  // solve verdict from mutating the state of a different puzzle.
  const generationRef = useRef(0);

  const letters = useMemo(() => path.map((i) => grid[i]), [path, grid]);

  const cellStates = useMemo<CellState[]>(() => {
    const used = new Set(path);
    const current = path[path.length - 1] ?? null;
    const blocked = getBlockedCells(current);
    const inProgress = path.length > 0;
    return Array.from({ length: 9 }, (_, i) => {
      if (i === current) return 'current';
      if (used.has(i)) return 'used';
      // Unassisted mode: suppress adjacency hints — all unused cells
      // look the same ('open') so the solver gets no visual feedback
      // about which cells are reachable.
      if (unassisted) return 'open';
      if (blocked.has(i)) return 'blocked';
      return inProgress ? 'available' : 'open';
    });
  }, [path, unassisted]);

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
    // Wordmark counter: only a MID-ATTEMPT Reset press disqualifies
    // Blameless. A reset that happens after a confirmed solve is the
    // "Play Again" transition — handlePlayAgain calls this same
    // function to clear the board for the next attempt, and counting
    // that as a user Reset would make Blameless impossible to earn
    // on any Play Again session (the next attempt would start with
    // resetCountRef=1). Skip the increment when `solved` is true.
    //
    // Additionally, only count a Reset that actually clears letters —
    // pressing Reset on an empty board (accidentally, or right after
    // Play Again) shouldn't disqualify Blameless. Same flag pattern
    // as backspace: the updater receives the latest state, so rapid
    // or stale-closure calls are safe.
    let hadContent = false;
    setPath((p) => {
      if (p.length > 0) hadContent = true;
      return [];
    });
    if (!solved && hadContent) {
      resetCountRef.current += 1;
    } else if (solved) {
      // Play Again path — make sure counters are zero for the next
      // attempt. triggerSolve also zeros them on the success branch,
      // but doing it here too means a reset-after-solve is idempotent
      // even if the solve flow was interrupted.
      backspaceCountRef.current = 0;
      resetCountRef.current = 0;
    }
    inFlightAttemptRef.current = null;
    setSolved(false);
    setPendingSolve(false);
    // Deliberately NOT clearing foundWords here — the player's
    // collected shorter words persist across Reset so a mis-path
    // and retry doesn't erase their progress. The only thing that
    // clears the list is a confirmed solve (handled in the
    // triggerSolve success branch below) or a full page reload.
    // `lastFoundWordRef` also intentionally persists so retyping a
    // previously-found word after Reset doesn't re-enqueue it.
    telemetryRef.current?.reset();
  }, [solved]);

  // Hard reset for puzzle switches — clears everything including
  // foundWords and wordmark counters. Unlike `reset` (which preserves
  // foundWords across mid-puzzle retries), this is a clean slate.
  const fullReset = useCallback(() => {
    generationRef.current += 1;
    setPath([]);
    inFlightAttemptRef.current = null;
    setSolved(false);
    setPendingSolve(false);
    setFoundWords([]);
    // foundWordsRef is the source of truth for the crumb dedup check —
    // reset it synchronously so a dictionary resolution that lands in
    // the window between setFoundWords([]) and the ref-sync effect
    // running can’t false-reject a new-puzzle crumb that happens to
    // match a word from the previous puzzle.
    foundWordsRef.current = [];
    lastFoundWordRef.current = null;
    backspaceCountRef.current = 0;
    resetCountRef.current = 0;
    telemetryRef.current?.reset();
  }, []);

  // Merge server-persisted crumbs into the live list without firing
  // onCrumbFound (they're already saved). Used by GameClient after
  // the async /api/crumbs fetch resolves.
  const seedFoundWords = useCallback((words: string[]) => {
    if (words.length === 0) return;
    setFoundWords((prev) => {
      const existing = new Set(prev);
      const newOnes = words.filter((w) => !existing.has(w));
      if (newOnes.length === 0) return prev;
      // Append persisted crumbs after any newly found ones (newest-first)
      return [...prev, ...newOnes];
    });
  }, []);


  // Real-time shorter-word detection (4-8 letters). The dictionary is
  // lazy-loaded via dynamic import — the first check after page load
  // may take ~50-100ms while the chunk downloads, but `prefetchDictionary`
  // is fired from the first keystroke handler so the chunk is usually
  // already in flight by the time the user types 4 letters.
  useEffect(() => {
    // Post-solve lock: skip crumb detection entirely. See the `locked`
    // prop doc — once a puzzle is committed, further typing shouldn't
    // mint new crumbs with nowhere legitimate to persist.
    if (locked) return;
    if (letters.length < 4 || letters.length > 8) return;
    const candidate = letters.join('');
    if (candidate === lastFoundWordRef.current) return;

    let cancelled = false;
    isDictionaryWord(candidate)
      .then((isWord) => {
        if (cancelled || !isWord) return;
        // No post-await dedup guard needed: any mutation to letters
        // (typeLetter, backspace, reset) changes the effect deps and
        // fires the cleanup, which sets cancelled=true. The cancelled
        // check above is the complete staleness defense.
        // Sync dedup against already-found crumbs via the ref. The
        // previous implementation relied on an `isNew` flag mutated
        // inside the setFoundWords updater, then read immediately
        // after — but React 18 auto-batches setState inside async
        // contexts (`.then`) and defers the updater, so `isNew` was
        // still false when we read it. Net effect: onCrumbFound never
        // fired and the POST to /api/crumbs never went out, leaving
        // zero rows in puzzle_crumbs despite weeks of gameplay. The
        // silent `.catch` on the client-side fetch hid it. Dedup via
        // the ref is synchronous, survives StrictMode double-invoke
        // (the ref write makes the second invocation short-circuit),
        // and keeps the side effect outside the updater.
        if (foundWordsRef.current.includes(candidate)) return;
        foundWordsRef.current = [candidate, ...foundWordsRef.current];
        lastFoundWordRef.current = candidate;
        setFoundWords((prev) =>
          prev.includes(candidate) ? prev : [candidate, ...prev],
        );
        onCrumbFoundRef.current?.(candidate);
      })
      .catch(() => {
        // Dictionary chunk failed to load — silently skip.
        // loadDict() resets its memo on rejection, so the next attempt
        // (next typed letter) will re-fetch automatically.
      });
    return () => {
      cancelled = true;
    };
  }, [letters, locked]);

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
      // Post-solve lock: the puzzle is already banked. Completing the
      // 9-letter word again on a Reset-replay shouldn't re-open the
      // SolveModal, re-POST to /api/solve, or overwrite the frozen
      // `finalSolveMs` with a later duration — first-solve-wins is
      // authoritative, and on anonymous sessions the server can't
      // dedupe so replays would insert fresh solves rows each time.
      // Upstream, GameClient passes `locked=true` once finalSolveMs
      // is set (SSR-hydrated from the prior solve OR set by the
      // live solve path), which also gates the crumb detector above.
      if (locked) return;
      if (finalPath.length !== 9) return;
      if (!isValidPath(finalPath)) return;

      const finalLetters = finalPath.map((i) => grid[i]).join('');
      // Re-entry guard: if a verify for the same letters is already in
      // flight, ignore. inFlightAttemptRef is cleared in finally().
      if (inFlightAttemptRef.current === finalLetters) return;
      inFlightAttemptRef.current = finalLetters;

      // Build the SolvePayload from the telemetry class + the wordmark
      // action counters (tracked here, not in telemetry). Read
      // foundWords from the ref mirror (not the closure) so a
      // dictionary check that resolved between the last render and
      // this invocation is captured in the payload.
      const tele = telemetryRef.current!.build(finalLetters);
      const payload: SolvePayload = {
        ...tele,
        backspaceCount: backspaceCountRef.current,
        resetCount: resetCountRef.current,
        foundWords: [...foundWordsRef.current],
      };
      setPendingSolve(true);
      const gen = generationRef.current;

      onSolveAttempt({ ...payload, unassisted })
        .then((verdict) => {
          // Bail if the puzzle changed while the solve was in flight.
          if (generationRef.current !== gen) return;
          // Treat "solved without word" as a server contract violation
          // (the API guarantees `word` is present when solved=true).
          // If we ever receive solved=true with no word, fall through
          // to the shake path rather than locking the UI into a
          // half-solved state with no SolveModal.
          if (verdict.solved && verdict.word != null) {
            setSolved(true);
            // foundWords intentionally preserved on confirmed solve —
            // the crumbs the player found during the attempt stay
            // visible in the FoundWords strip after the modal closes
            // so a post-solve Reset leaves their discoveries on
            // screen. Post-solve locking lives upstream: GameClient
            // passes `locked=true` once a solve is committed, which
            // gates the crumb-detection effect above against adding
            // any NEW words after the fact.
            lastFoundWordRef.current = null;
            // Wordmark counters reset on confirmed solve so a
            // post-solve replay attempt (short-circuited by the
            // server's first-solve-wins) starts from a clean slate.
            backspaceCountRef.current = 0;
            resetCountRef.current = 0;
            onSolved?.({ ...payload, unassisted, word: verdict.word });
          } else {
            triggerShake();
          }
        })
        .catch(() => {
          if (generationRef.current !== gen) return;
          triggerShake();
        })
        .finally(() => {
          if (generationRef.current !== gen) return;
          setPendingSolve(false);
          inFlightAttemptRef.current = null;
        });
    },
    [grid, solved, onSolveAttempt, onSolved, unassisted, triggerShake, locked],
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
    // Wordmark counter: only count a Backspace that actually shortens
    // the path. We read a flag set inside setPath's updater — the
    // updater receives the LATEST state (even before re-render), so
    // rapid key-repeat past an empty path won't over-count. The flag
    // lives outside the updater so the updater stays pure (safe under
    // React StrictMode double-invocation — setting the flag to true
    // twice is harmless since we only read it once afterward).
    let didShorten = false;
    setPath((p) => {
      if (p.length === 0) return p;
      didShorten = true;
      return p.slice(0, -1);
    });
    if (didShorten) backspaceCountRef.current += 1;
    // Reset the found-word dedup so typing back up to the same
    // word after a backspace re-animates the pill via the useEffect.
    lastFoundWordRef.current = null;
  }, [solved, disabled, pendingSolve]);

  // Global keyboard listener. Disabled/pending both skip attachment so
  // the browser handles keys normally during modals + in-flight solves.
  //
  // Additionally, we bail on any keydown whose target is a form field
  // (input/textarea/select/contenteditable). Without this guard, a user
  // typing into a modal input — e.g. the Sign in email or display-name
  // fields — would have their keystrokes doubly-consumed: once by the
  // input, and again by the game's letter/backspace handler, causing
  // the grid to light up with phantom letters while they type their
  // email. This is a belt-and-suspenders fix for modals that forget to
  // pass `disabled={true}` into useGriddle.
  useEffect(() => {
    if (disabled || pendingSolve) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
      }
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
    {
      letters,
      path,
      cellStates,
      sequenceByCell,
      shakeSignal,
      solved,
      pendingSolve,
      foundWords,
    },
    { typeLetter, tapCell, backspace, reset, fullReset, seedFoundWords },
  ];
}
