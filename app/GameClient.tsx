'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Crown, Backspace, ArrowCounterClockwise, Info } from '@phosphor-icons/react';
import { formatLongDate } from '@/lib/format';
import { useDarkMode } from '@/lib/useDarkMode';
import { useZenMode } from '@/lib/useZenMode';
import { Grid } from '@/components/Grid';
import { WordSlots } from '@/components/WordSlots';
import { SolveModal } from '@/components/SolveModal';
import { TutorialModal } from '@/components/TutorialModal';
import { HomeTiles } from '@/components/HomeTiles';
import { FoundWords } from '@/components/FoundWords';
import { GameTimer } from '@/components/GameTimer';
import { StartGate } from '@/components/StartGate';
import { BrowseModal, type BrowseTab } from '@/components/BrowseModal';
import { CreateProfileModal } from '@/components/CreateProfileModal';
import { PremiumGateModal } from '@/components/PremiumGateModal';
import { SettingsModal, type ProfileSnapshot } from '@/components/SettingsModal';
import { SettingsButton } from '@/components/SettingsButton';
import { pickAvatarSeed } from '@/lib/default-avatar';
import { NextPuzzleCountdown } from '@/components/NextPuzzleCountdown';
import { useGriddle, type SolveVerdict } from '@/lib/useGriddle';
import { useFarcaster } from '@/lib/farcaster';
import { trackEvent } from '@/lib/funnel/client';
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

interface SolveResult {
  solveMs: number;
  unassisted: boolean;
  word: string;
  earnedWordmarks: string[];
  currentStreak: number | null;
  averageMs: number | null;
  percentileRank: number | null;
  dailyRank: number | null;
  isPremium: boolean;
}

interface GameClientProps {
  initialPuzzle: InitialPuzzle;
  /**
   * Session wallet resolved server-side from KV. Seeds the client's
   * `sessionWallet` state so effects keyed on it fire on mount with
   * the correct value — avoiding the "brief null → async populate"
   * race that caused settings / profile / premium reads to fire a
   * beat after the user started playing.
   */
  initialSessionWallet: string | null;
  /**
   * `user_settings.unassistedModeEnabled` resolved server-side from
   * the wallet bound to this session. Seeds `unassistedMode` so the
   * grid's `cellStates` render with hints suppressed from tick zero
   * — no longer possible for a user with Unassisted ON to play a
   * whole attempt with the assisted UI before the async fetch lands.
   */
  initialUnassistedMode: boolean;
  /**
   * `puzzle_loads.started_at` for this session + today's puzzle,
   * serialized as ISO8601. Non-null means the player already pressed
   * Start on an earlier visit — skip the Start gate, resume the timer
   * from the stored stamp. Null for a first visit or a session that
   * hasn't started this puzzle yet.
   */
  initialStartedAt: string | null;
  /**
   * Authoritative solve duration (ms) for this caller's first
   * successful solve of today's puzzle, or null if they haven't
   * solved it yet. Seeds `finalSolveMs` so a refresh after solving
   * renders the frozen timer + crumb lock from tick zero instead of
   * the timer ticking from the ancient started_at with crumb
   * detection armed on a puzzle the player has already banked.
   */
  initialFinalSolveMs: number | null;
  /**
   * Crumbs (4–8 letter words the session has already discovered on
   * today's puzzle) read server-side from `puzzle_crumbs`. Seeds
   * useGriddle's `foundWords` from tick zero so a mid-play refresh
   * keeps the FoundWords strip populated instead of flashing empty
   * for the frame between mount and the client-side refetch. Empty
   * array when nothing has been found yet.
   */
  initialCrumbs: readonly string[];
}

const TUTORIAL_STORAGE_KEY = 'griddle_tutorial_seen_v1';

/**
 * Client wrapper for the game state. The parent `app/page.tsx` is a
 * server component that fetches the puzzle from Neon (without the
 * target word) and passes the shape into here. Game logic, modals,
 * keyboard input, telemetry, and the /api/solve round-trip all live
 * on this side of the server/client boundary.
 */
export default function GameClient({
  initialPuzzle,
  initialSessionWallet,
  initialUnassistedMode,
  initialStartedAt,
  initialFinalSolveMs,
  initialCrumbs,
}: GameClientProps) {
  const { inMiniApp, fid, username, pfpUrl, displayName } = useFarcaster();

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
  const [sessionWallet, setSessionWallet] = useState<string | null>(initialSessionWallet);
  const { dark, toggle: toggleDark } = useDarkMode(sessionWallet);
  const { zen, toggle: toggleZen } = useZenMode();

  // Active puzzle — defaults to today's. Archive navigation swaps it.
  const [activePuzzle, setActivePuzzle] = useState<InitialPuzzle>(initialPuzzle);
  const isArchive = activePuzzle.dayNumber !== initialPuzzle.dayNumber;

  // Ref mirror of the active puzzle's dayNumber so async callbacks
  // (notably handleStart's fetch resolution) can verify the user
  // hasn't navigated away between POST and response without racing
  // against a stale closure capture.
  const activeDayNumberRef = useRef(activePuzzle.dayNumber);
  useEffect(() => {
    activeDayNumberRef.current = activePuzzle.dayNumber;
  }, [activePuzzle.dayNumber]);

  // ── Start gate ────────────────────────────────────────────────────
  // `startedAt` is the epoch-ms timestamp of the player's Start press
  // for the CURRENT active puzzle. Null means the Start gate is still
  // showing — the grid is blurred, input is disabled, and the timer
  // hasn't begun.
  //
  // Seeded from `initialStartedAt` (server-side read of
  // puzzle_loads.started_at during SSR) so a refreshed / resumed
  // session skips the gate and the visible timer picks up where it
  // left off.
  const [startedAt, setStartedAt] = useState<number | null>(
    initialStartedAt != null ? new Date(initialStartedAt).getTime() : null,
  );
  const [startPending, setStartPending] = useState(false);

  // Today's startedAt lives in a ref (not a const) so it stays current
  // when the player presses Start client-side. Seeded from the SSR
  // prop, but updated by handleStart on today's puzzle so a
  // today → archive → today navigation restores the running timer
  // instead of falsely re-showing the Start gate. Archive puzzles
  // recover their own startedAt by re-fetching /api/puzzle/[day], so
  // only today needs in-memory bookkeeping.
  const todayStartedAtRef = useRef<number | null>(
    initialStartedAt != null ? new Date(initialStartedAt).getTime() : null,
  );
  // Today's finalSolveMs follows the same persistence rule. Archive
  // detours would otherwise blow away the frozen solve value on a
  // return-to-today, letting the timer tick fresh from startedAt
  // against a puzzle the player has already banked.
  const todayFinalSolveMsRef = useRef<number | null>(initialFinalSolveMs);

  const loadArchivePuzzle = useCallback(async (dayNumber: number) => {
    if (dayNumber === initialPuzzle.dayNumber) {
      setActivePuzzle(initialPuzzle);
      setStartedAt(todayStartedAtRef.current);
      setFinalSolveMs(todayFinalSolveMsRef.current);
      return;
    }
    // Don't pre-clear finalSolveMs here. Two reasons:
    //   1. On fetch failure / non-ok, we return without restoring —
    //      which would permanently unfreeze today's timer even
    //      though the user never actually navigated away (the
    //      archive switch didn't happen).
    //   2. Even on success, pre-clear would visibly unfreeze today's
    //      timer during the in-flight window because activePuzzle is
    //      still today until the fetch resolves.
    // React 18 batches the three post-fetch set*s in this then
    // callback into a single render, so there's no intermediate
    // "archive puzzle with today's frozen time" frame to avoid.
    try {
      const res = await fetch(`/api/puzzle/${dayNumber}`);
      if (!res.ok) return;
      const data = (await res.json()) as InitialPuzzle & {
        startedAt: string | null;
        previousSolveMs: number | null;
      };
      setActivePuzzle({ dayNumber: data.dayNumber, date: data.date, grid: data.grid });
      setStartedAt(data.startedAt != null ? new Date(data.startedAt).getTime() : null);
      setFinalSolveMs(data.previousSolveMs);
    } catch {/* best-effort */}
  }, [initialPuzzle]);

  const returnToToday = useCallback(() => {
    setActivePuzzle(initialPuzzle);
    setStartedAt(todayStartedAtRef.current);
    setFinalSolveMs(todayFinalSolveMsRef.current);
  }, [initialPuzzle]);

  // Start press → POST /api/puzzle/start. On success, seed startedAt
  // with the server's authoritative timestamp. On failure, fall back
  // to the client clock so gameplay isn't blocked by a flaky POST —
  // the solve route will use loaded_at in that case, which is strictly
  // more generous (slightly inflated time) but keeps the UX moving.
  //
  // `targetDayNumber` is captured at call time. The response handler
  // checks activeDayNumberRef to make sure the user hasn't navigated
  // to a different puzzle while the POST was in flight — if they
  // have, we skip setStartedAt (it would leak the old puzzle's start
  // into the new one) but still stash into todayStartedAtRef when
  // the target was today's puzzle, so a later return-to-today
  // restores the running timer.
  const handleStart = useCallback(async () => {
    if (startPending) return;
    setStartPending(true);
    const targetDayNumber = activePuzzle.dayNumber;
    const apply = (ms: number) => {
      if (activeDayNumberRef.current === targetDayNumber) {
        setStartedAt(ms);
      }
      if (targetDayNumber === initialPuzzle.dayNumber) {
        todayStartedAtRef.current = ms;
      }
    };
    try {
      const res = await fetch('/api/puzzle/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dayNumber: targetDayNumber }),
      });
      if (res.ok) {
        const data = (await res.json()) as { startedAt: string };
        apply(new Date(data.startedAt).getTime());
        return;
      }
    } catch {
      // fall through
    } finally {
      setStartPending(false);
    }
    apply(Date.now());
  }, [activePuzzle.dayNumber, initialPuzzle.dayNumber, startPending]);

  // ── Persisted crumbs ─────────────────────────────────────────────
  // Fetch any previously saved crumbs whenever the active puzzle
  // changes. Seeded into useGriddle as initialFoundWords so the
  // player's earlier discoveries appear immediately on page load.
  const [persistedCrumbs, setPersistedCrumbs] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/crumbs?dayNumber=${activePuzzle.dayNumber}`)
      .then(async (r) => {
        if (!r.ok) {
          // Surface, don’t swallow. An earlier silent `.catch(() => {})`
          // let the "puzzle_crumbs table doesn’t exist" error go
          // unnoticed for weeks. A loud console.error is the minimum
          // signal — infra errors still don’t block gameplay (we fall
          // back to an empty list), but they’re now visible in devtools
          // and Sentry/Vercel log streams.
          console.error('[crumbs] GET failed', r.status, await r.text().catch(() => ''));
          return { crumbs: [] as string[] };
        }
        return r.json() as Promise<{ crumbs: string[] }>;
      })
      .then((data) => {
        if (!cancelled) setPersistedCrumbs(data.crumbs);
      })
      .catch((err) => {
        console.error('[crumbs] GET threw', err);
      });
    return () => { cancelled = true; };
  }, [activePuzzle.dayNumber]);

  // Fire-and-forget POST when a new crumb is discovered during play.
  // Errors are logged, not swallowed — see the GET effect above for the
  // silent-failure post-mortem that motivated this.
  const handleCrumbFound = useCallback((word: string) => {
    fetch('/api/crumbs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dayNumber: activePuzzle.dayNumber, word }),
    })
      .then(async (r) => {
        if (!r.ok) {
          console.error('[crumbs] POST failed', r.status, await r.text().catch(() => ''));
        }
      })
      .catch((err) => {
        console.error('[crumbs] POST threw', err);
      });
  }, [activePuzzle.dayNumber]);


  /**
   * Tracks the Farcaster pfp URL last successfully POSTed to
   * /api/profile/farcaster. Shared between handleWalletConnect
   * (initial connect path) and the pfp-listening useEffect further
   * down (ongoing refresh path) so the two paths can deduplicate
   * against each other. Declared up here — above handleWalletConnect
   * — to stay out of the TDZ when the connect callback closes over it.
   * See the big comment on the sync effect below for the dedup rules.
   */
  const lastSyncedPfpUrlRef = useRef<string | null>(null);

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

  const [solveResult, setSolveResult] = useState<SolveResult | null>(null);

  // Solve reveal is a two-step handoff: /api/solve verdict lands first
  // and populates `pendingSolveResultRef`, then Grid fires
  // `handleReorderComplete` once the tile-shuffle settles and we promote
  // the pending result into state to open SolveModal. Decoupled via ref
  // so a stale SolveModal never opens if the user triggered a reset
  // between verdict and settle.
  const pendingSolveResultRef = useRef<SolveResult | null>(null);

  /**
   * Authoritative server-computed solve duration (ms) from the most
   * recent /api/solve response. `clientSolveMs` from the telemetry is
   * `performance.now() - puzzleLoadedAt`, which resets on every mount
   * — so a user who opens the puzzle, leaves for an hour, and solves
   * from a fresh page view would see an 11-second solve time on the
   * SolveModal even though the server (whose `puzzle_loads.loaded_at`
   * row is preserved across reloads via `ON CONFLICT DO NOTHING`) has
   * the correct hour-long duration. Stash it in a ref between the
   * async verify and the onSolved handoff so handleSolved can prefer
   * the server value when displaying the solve time.
   */
  const serverSolveMsRef = useRef<number | null>(null);
  /**
   * Wordmarks newly earned on the latest solve — captured from the
   * /api/solve response and handed off to handleSolved (which fires
   * from useGriddle after a successful verdict). Lives in a ref for
   * the same reason serverSolveMsRef does: onSolved only carries the
   * telemetry payload, not the verdict body, so we stash verdict-
   * adjacent data here to preserve it across the async boundary.
   */
  const earnedWordmarksRef = useRef<string[]>([]);
  /**
   * Post-solve summary from /api/solve — streak / average / percentile
   * / daily rank / premium flag. Same async-handoff reason as the refs
   * above: the verdict body is captured in handleSolveAttempt, but
   * only consumed in handleSolved → pendingSolveResultRef two async
   * beats later.
   */
  const solveSummaryRef = useRef<{
    currentStreak: number | null;
    averageMs: number | null;
    percentileRank: number | null;
    dailyRank: number | null;
    isPremium: boolean;
  }>({
    currentStreak: null,
    averageMs: null,
    percentileRank: null,
    dailyRank: null,
    isPremium: false,
  });

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
            dayNumber: activePuzzle.dayNumber,
            claimedWord: payload.claimedWord,
            clientSolveMs: payload.clientSolveMs,
            keystrokeIntervalsMs: payload.keystrokeIntervalsMs,
            keystrokeCount: payload.keystrokeCount,
            unassisted: payload.unassisted,
            backspaceCount: payload.backspaceCount,
            resetCount: payload.resetCount,
            foundWords: payload.foundWords,
          }),
        });
        if (!res.ok) return { solved: false };
        const data = (await res.json()) as {
          solved: boolean;
          word?: string;
          serverSolveMs?: number | null;
          earnedWordmarks?: string[];
          currentStreak?: number | null;
          averageMs?: number | null;
          percentileRank?: number | null;
          dailyRank?: number | null;
          isPremium?: boolean;
        };
        // Capture the server-computed duration for the SolveModal
        // display. Null if the session submitted without loading first
        // (direct POST) — in that case we'll fall back to clientSolveMs
        // inside handleSolved.
        serverSolveMsRef.current =
          typeof data.serverSolveMs === 'number' ? data.serverSolveMs : null;
        // Capture newly-earned wordmarks for the SolveModal earn toast.
        earnedWordmarksRef.current = Array.isArray(data.earnedWordmarks)
          ? data.earnedWordmarks
          : [];
        // Capture the post-solve summary so the revamped modal has
        // streak / avg / rank by the time it opens.
        solveSummaryRef.current = {
          currentStreak: typeof data.currentStreak === 'number' ? data.currentStreak : null,
          averageMs: typeof data.averageMs === 'number' ? data.averageMs : null,
          percentileRank: typeof data.percentileRank === 'number' ? data.percentileRank : null,
          dailyRank: typeof data.dailyRank === 'number' ? data.dailyRank : null,
          isPremium: data.isPremium === true,
        };
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
    [activePuzzle.dayNumber],
  );

  /**
   * Authoritative solve duration that survives past the SolveModal
   * close — the visible timer freezes to this value after solve, and
   * the post-solve `locked` flag to useGriddle is derived from its
   * non-null-ness. Distinct from solveResult (which gets cleared on
   * modal close); finalSolveMs persists for the whole puzzle lifetime
   * so the frozen timer stays visible whether or not the modal is up.
   */
  const [finalSolveMs, setFinalSolveMs] = useState<number | null>(initialFinalSolveMs);

  const handleSolved = useCallback(
    (payload: SolvePayload & { unassisted: boolean; word: string }) => {
      // Prefer the server-side duration. The client-side value is only
      // a fallback for the no-puzzle-load edge case (direct POST), and
      // is wrong for any user who reloaded mid-attempt.
      const serverMs = serverSolveMsRef.current;
      const solveMs = serverMs != null ? serverMs : payload.clientSolveMs;
      // Stash the result; Grid will fire onReorderComplete once the
      // tile shuffle settles, and we'll promote the stash to state then.
      pendingSolveResultRef.current = {
        solveMs,
        unassisted: payload.unassisted,
        word: payload.word,
        earnedWordmarks: earnedWordmarksRef.current,
        ...solveSummaryRef.current,
      };
      // Lock in the displayed time immediately — the visible grid
      // timer freezes here, before the reveal animation even starts,
      // rather than waiting for the modal to open. Also drives the
      // `locked` prop to useGriddle that suppresses post-solve crumb
      // discovery.
      setFinalSolveMs(solveMs);
      // Stash into today's ref so a later archive → return-to-today
      // restores the frozen state without needing a page refresh
      // (matches todayStartedAtRef's role for the Start stamp).
      if (activeDayNumberRef.current === initialPuzzle.dayNumber) {
        todayFinalSolveMsRef.current = solveMs;
      }
      serverSolveMsRef.current = null;
      earnedWordmarksRef.current = [];
      solveSummaryRef.current = {
        currentStreak: null,
        averageMs: null,
        percentileRank: null,
        dailyRank: null,
        isPremium: false,
      };
    },
    [initialPuzzle.dayNumber],
  );

  const handleReorderComplete = useCallback(() => {
    const pending = pendingSolveResultRef.current;
    if (pending === null) return;
    pendingSolveResultRef.current = null;
    setSolveResult(pending);
  }, []);

  // Unassisted mode — read from /api/settings on wallet connect. When
  // true, useGriddle suppresses cell-state hints (available / blocked)
  // so the solver gets no adjacency feedback.
  const [unassistedMode, setUnassistedMode] = useState(initialUnassistedMode);

  const [state, actions] = useGriddle({
    grid: activePuzzle.grid,
    onSolveAttempt: handleSolveAttempt,
    onSolved: handleSolved,
    // Input is inert while the tutorial overlay is up OR the Start
    // gate hasn't been cleared — no keystrokes should fill the grid
    // behind a blocking surface.
    disabled: showTutorial || startedAt == null,
    // Post-solve lock: crumb detection is suppressed once finalSolveMs
    // is set. Typing still works (Reset + replay explores the grid)
    // but no new crumbs get added to the strip or POSTed to the crumb
    // store, and any fresh 9-letter attempt is short-circuited by the
    // server's first-solve-wins path.
    locked: finalSolveMs != null,
    unassisted: unassistedMode,
    onCrumbFound: handleCrumbFound,
    // SSR-hydrated crumbs — populates foundWords from tick zero so a
    // mid-play refresh doesn't flash an empty strip. The client-side
    // /api/crumbs fetch below still runs (for archive nav + as a
    // consistency check) and de-dups via seedFoundWords.
    initialFoundWords: initialCrumbs,
  });

  // When persisted crumbs arrive from the server, merge them into the
  // live foundWords list. seedFoundWords is de-duped and doesn't fire
  // onCrumbFound (no re-saving already-persisted words).
  //
  // Destructure stable callbacks from actions (each is a useCallback
  // with [] deps). The actions object itself is a fresh literal every
  // render, so depending on it would re-fire effects on every render.
  const { seedFoundWords, fullReset } = actions;

  // Depend on persistedCrumbs only — seedFoundWords has stable identity.
  useEffect(() => {
    if (persistedCrumbs.length > 0) {
      seedFoundWords(persistedCrumbs);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedCrumbs]);

  // Hard-reset the grid when the active puzzle changes (archive
  // navigation). Uses fullReset instead of reset so foundWords and
  // wordmark counters from the previous puzzle don't leak across.
  const prevDayRef = useRef(activePuzzle.dayNumber);
  useEffect(() => {
    if (prevDayRef.current !== activePuzzle.dayNumber) {
      prevDayRef.current = activePuzzle.dayNumber;
      setSolveResult(null);
      // finalSolveMs is intentionally NOT cleared here — the nav
      // function (loadArchivePuzzle / returnToToday) is authoritative
      // for that value per puzzle. Clearing here would race with the
      // value those functions set in the same tick.
      fullReset();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePuzzle.dayNumber]);

  /**
   * Wallet linking + premium read. Fired once when a wallet connects.
   * The link endpoint retroactively attributes anonymous solves on this
   * session to the wallet, then we read the premium status to gate any
   * future premium-only UI.
   */
  const [premium, setPremium] = useState(false);

  /**
   * The full profile snapshot for the bound identity, or null if the
   * session is anonymous. Owned here (not inside each modal) so the
   * gear button, StatsModal, and SettingsModal all render from the
   * same source of truth — refetched on mount and whenever a mutation
   * needs to be observed.
   */
  const [profile, setProfile] = useState<ProfileSnapshot | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const hasSessionProfile = profile !== null;

  /** Fetches /api/profile and updates local state. Returns the snapshot. */
  const refetchProfile = useCallback(async (): Promise<ProfileSnapshot | null> => {
    try {
      const res = await fetch('/api/profile');
      if (!res.ok) { setProfileLoaded(true); return null; }
      const data = (await res.json()) as { profile: ProfileSnapshot | null };
      setProfile(data.profile);
      setProfileLoaded(true);
      return data.profile;
    } catch {
      setProfileLoaded(true);
      return null;
    }
  }, []);

  // Refs that mirror the reactive identity state so stable callbacks
  // (useCallback with []) can read the latest value without taking
  // `premium` / `sessionWallet` as deps — avoids re-creating the
  // callback on every state change and the downstream re-renders in
  // memoized children.
  const premiumRef = useRef(premium);
  const sessionWalletRef = useRef(sessionWallet);
  useEffect(() => { premiumRef.current = premium; }, [premium]);
  useEffect(() => { sessionWalletRef.current = sessionWallet; }, [sessionWallet]);

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

  // Sync unassisted mode from user_settings when a wallet connects.
  // The useDarkMode hook already fetches /api/settings for dark mode;
  // this effect reads the same endpoint for unassistedModeEnabled so
  // useGriddle can suppress cell hints. Runs on sessionWallet change.
  useEffect(() => {
    if (!sessionWallet) { setUnassistedMode(false); return; }
    fetch('/api/settings')
      .then((r) => r.ok ? r.json() : null)
      .then((data: { unassistedModeEnabled?: boolean } | null) => {
        setUnassistedMode(!!data?.unassistedModeEnabled);
      })
      .catch(() => {/* best-effort */});
  }, [sessionWallet]);

  // Hydrate the profile snapshot from /api/profile on mount. Required so
  // the account state survives a page reload. Skip when the URL is
  // /?auth=ok — the auth-ok effect below owns that path's PATCH → refetch
  // sequence, and running an extra mount fetch in parallel can race:
  // on cold starts the mount GET may resolve AFTER the auth-ok PATCH +
  // GET, overwriting the fresh post-PATCH profile with the pre-PATCH one.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('auth') === 'ok') return;
    }
    void refetchProfile();
  }, [refetchProfile]);

  // Post-magic-link: /?auth=ok means the verify endpoint just bound a
  // session profile (and possibly merged it into a wallet profile, see
  // /api/auth/verify). Refetch the profile, THEN open Settings so the
  // user can pick a username. Order matters: opening the modal before
  // the refetch resolves flashes the anonymous CTA for a frame while
  // the async GET is in flight. Strip the query param first so a
  // reload can't re-pop this flow.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') !== 'ok') return;

    params.delete('auth');
    const qs = params.toString();
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash,
    );

    (async () => {
      await refetchProfile();
      setShowSettings(true);
    })();
  }, [refetchProfile]);

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
      // Emit profile_identified after the link POST so the server-side
      // session → wallet binding exists when the event row is written.
      trackEvent({ name: 'profile_identified', method: 'wallet_connected' });

      // Farcaster miniapp: upsert a rich profile using FID + username + pfp.
      // The API auto-merges with any existing wallet profile and binds the
      // result to the session so /api/profile reads correctly.
      // Read from refs — not from closure — so we always get the
      // latest Farcaster context even though this callback has empty deps.
      //
      // Await this BEFORE the premium migration runs. The farcaster
      // endpoint calls setSessionProfile, and the premium migration
      // path may read session identity state — racing them could leave
      // a window where the wallet is bound but the profile binding
      // isn't. Awaiting serializes the two so downstream reads see a
      // fully-formed session.
      if (inMiniAppRef.current && fidRef.current) {
        // Capture the pfp URL BEFORE the await so we can mark exactly
        // that value as synced after the request resolves. If we read
        // pfpUrlRef.current a second time post-await, a racing SDK
        // update could change it — we'd then mark a URL as "synced"
        // that was never actually POSTed, and the pfp-listening
        // effect would skip the real new URL on its next run.
        const sentPfpUrl = pfpUrlRef.current ?? null;
        try {
          const res = await fetch('/api/profile/farcaster', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              fid: fidRef.current,
              username: usernameRef.current ?? null,
              displayName: displayNameRef.current ?? null,
              avatarUrl: sentPfpUrl,
              wallet: normalized,
            }),
          });
          // Refetch the profile so SettingsModal + the gear avatar
          // reflect the server-side binding without a reload.
          if (res.ok) {
            // Mark the CAPTURED (not re-read) pfp URL as synced so
            // the sibling `lastSyncedPfpUrlRef` effect below doesn't
            // fire a duplicate POST when `setSessionWallet(normalized)`
            // runs moments later. Without this, every Farcaster wallet
            // connect would produce two identical POSTs back-to-back.
            lastSyncedPfpUrlRef.current = sentPfpUrl;
            await refetchProfile();
          }
        } catch {/* best-effort — non-fatal */}
      } else {
        // Non-Farcaster wallet connect: the /api/wallet/link call above
        // may have merged an existing session-profile into the wallet
        // row (or patched the wallet onto it). Refetch to pick up the
        // merged state.
        await refetchProfile();
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

  /**
   * Auto-refresh a Farcaster user's avatar when their pfp URL changes.
   *
   * Problem this solves: `handleWalletConnect` fires once when the
   * wallet connects and snapshots `pfpUrlRef.current` into the profile
   * row. If the Farcaster miniapp SDK later resolves a newer pfp URL
   * (or the user updates their pfp on Farcaster and plays again), that
   * change never propagates into `profiles.avatar_url` — the profile
   * is pinned to whatever was set on first connect.
   *
   * This effect listens for `pfpUrl` changes and re-POSTs to
   * /api/profile/farcaster. The server uses the `avatar_source` column
   * to decide whether the overwrite is allowed:
   *   - `'farcaster'` or `null` → apply the incoming pfp
   *   - `'custom'`              → keep the user's uploaded photo
   *
   * Dedup via `lastSyncedPfpUrlRef` so we don't spam the endpoint when
   * the effect re-runs on unrelated state changes; only fire when the
   * pfp URL actually differs from the last value we synced.
   *
   * The ref itself is declared further up (near the other cross-
   * callback refs) so `handleWalletConnect` can also advance it after
   * its own Farcaster POST — that prevents the connect path's POST
   * from being immediately followed by a duplicate POST from this
   * effect when `setSessionWallet` fires.
   */
  useEffect(() => {
    if (!inMiniApp) return;
    if (!fid) return;
    if (!sessionWallet) return;
    if (!pfpUrl) return;
    if (lastSyncedPfpUrlRef.current === pfpUrl) return;
    // Capture the URL we're about to sync in a local so closure reads
    // are stable across the async boundary. Do NOT mark the ref as
    // synced yet — if the effect tears down before the fetch resolves
    // (e.g. `username` or `displayName` changes and the cleanup aborts
    // the in-flight request), an eagerly-set ref would record the URL
    // as "already synced" and the retry-on-next-effect-run would be
    // skipped, silently losing the pfp update. The ref only moves
    // forward after a confirmed server response.
    const targetPfpUrl = pfpUrl;
    const controller = new AbortController();
    fetch('/api/profile/farcaster', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fid,
        username,
        displayName,
        avatarUrl: targetPfpUrl,
        wallet: sessionWallet,
      }),
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) return;
        lastSyncedPfpUrlRef.current = targetPfpUrl;
        void refetchProfile();
      })
      .catch(() => {/* best-effort; silent — ref stays unset so a later run retries */});
    return () => controller.abort();
  }, [inMiniApp, fid, pfpUrl, sessionWallet, username, displayName, refetchProfile]);

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

  // Modal state. `browseTab` drives the single BrowseModal that hosts
  // Stats, Leaderboard, and Archive as three tabs at the bottom of the
  // sheet (iOS-style). Whichever HomeTile the user taps determines the
  // initial tab; they can switch between tabs inside the modal without
  // closing. Null = modal closed.
  const [browseTab, setBrowseTab] = useState<BrowseTab | null>(null);
  // Optional override for the leaderboard tab's initial day. Used only
  // by the post-solve nav: after an ARCHIVE solve the player expects
  // to see the leaderboard for the puzzle they just solved, not
  // today's. Cleared whenever the Browse modal closes so subsequent
  // HomeTile opens fall back to today.
  const [leaderboardInitialDay, setLeaderboardInitialDay] =
    useState<number | undefined>(undefined);
  useEffect(() => {
    if (browseTab === null) setLeaderboardInitialDay(undefined);
  }, [browseTab]);
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateProfile, setShowCreateProfile] = useState(false);
  const [premiumGate, setPremiumGate] =
    useState<null | 'leaderboard' | 'archive' | 'premium'>(null);

  /**
   * Whether the crypto unlock flow overlay is mounted. True between the
   * user clicking "Pay with crypto" and either success (→ refresh
   * premium, close both modals) or cancel/error (→ close the overlay,
   * leave the gate modal open so they can retry or switch to cash).
   */
  const [showCryptoFlow, setShowCryptoFlow] = useState(false);

  // True while the user has tapped "Pay with crypto" without a wallet
  // yet — we opened the connect flow, and when sessionWallet flips
  // non-null we auto-open the crypto flow so the tap feels continuous.
  // Cleared when the gate modal closes for ANY reason (see the effect
  // below) so a later unrelated connect can't surprise-pop the flow.
  const pendingCryptoAfterConnectRef = useRef(false);

  const handleUnlockCrypto = useCallback(() => {
    trackEvent({ name: 'upgrade_clicked', method: 'crypto' });
    // checkout_started fires from PremiumCryptoFlow at the actual
    // permit-signed / tx-broadcast moment, not here — otherwise it
    // would be redundant with upgrade_clicked in the same tick and
    // would blend different semantics with the fiat path (which
    // fires started only after Stripe session creation succeeds).
    if (!sessionWallet) {
      pendingCryptoAfterConnectRef.current = true;
      triggerConnect();
      return;
    }
    setShowCryptoFlow(true);
  }, [sessionWallet, triggerConnect]);

  // Clear pending crypto intent whenever the gate modal is closed,
  // regardless of the path that closed it (explicit close, fiat
  // checkout complete, crypto unlock complete). Keeping this in a
  // single effect rather than piggy-backing on every setPremiumGate(null)
  // callsite means new paths that close the gate stay safe by default.
  useEffect(() => {
    if (premiumGate === null) {
      pendingCryptoAfterConnectRef.current = false;
    }
  }, [premiumGate]);

  // Auto-resume: if the user tapped "Pay with crypto" before
  // connecting, open the crypto flow as soon as the wallet binding
  // lands. The `!premium` guard prevents a stale intent from surfacing
  // the crypto modal to someone who has already paid via fiat — the
  // pending ref is cleared on gate close, but the extra check is
  // cheap insurance against any race where the ref outlives that.
  useEffect(() => {
    if (!sessionWallet) return;
    if (!pendingCryptoAfterConnectRef.current) return;
    if (premium) return;
    pendingCryptoAfterConnectRef.current = false;
    setShowCryptoFlow(true);
  }, [sessionWallet, premium]);

  const handleUpgradeClickedFiat = useCallback(() => {
    trackEvent({ name: 'upgrade_clicked', method: 'fiat' });
  }, []);

  /**
   * Hosted Stripe Checkout redirect. Only called by PremiumGateModal
   * when `forceHostedFiat` is true — today that means the Farcaster
   * mini app Frame, where cross-origin iframe payment flows are
   * blocked. The embedded path is the default for every other context
   * and is driven by PremiumCheckoutEmbed inside the modal itself.
   */
  const handleUnlockFiatHosted = useCallback(async () => {
    let failedReasonEmitted = false;
    const emitFailure = (reason: string) => {
      if (failedReasonEmitted) return;
      failedReasonEmitted = true;
      trackEvent({ name: 'checkout_failed', method: 'fiat', reason });
    };
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: sessionWallet ?? undefined, mode: 'hosted' }),
      });
      if (!res.ok) {
        const body = await res.text();
        emitFailure(`http_${res.status}`);
        throw new Error(`Checkout failed: ${body}`);
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) {
        emitFailure('no_url');
        throw new Error('Checkout did not return a URL');
      }
      trackEvent({ name: 'checkout_started', method: 'fiat' });
      window.location.href = data.url;
    } catch (err) {
      emitFailure('exception');
      throw err;
    }
  }, [sessionWallet]);

  const handleFiatCheckoutStarted = useCallback(() => {
    trackEvent({ name: 'checkout_started', method: 'fiat' });
  }, []);

  /**
   * Fires after the embedded Stripe flow reports payment complete AND
   * the modal's short poll has confirmed premium via the existing
   * read endpoints. The webhook owns the DB/KV writes; this handler
   * just flips local UI state + closes the modal. `checkout_completed`
   * is emitted server-side from the webhook (accurate) so it's not
   * wired here.
   */
  const handleFiatCheckoutComplete = useCallback(() => {
    setPremium(true);
    setPremiumGate(null);
    if (sessionWallet) {
      void refreshPremium(sessionWallet);
    }
  }, [sessionWallet, refreshPremium]);

  const handleCryptoUnlocked = useCallback(
    (wallet: string) => {
      setShowCryptoFlow(false);
      setPremiumGate(null);
      void refreshPremium(wallet);
    },
    [refreshPremium],
  );

  /**
   * Unified tab open/switch handler. Used by BOTH the HomeTiles row
   * (initial open when the modal is closed) and BrowseModal's bottom
   * tab bar (switching while the modal is already open).
   *
   * All 3 tabs open for ALL users — no premium gate at the tile/tab
   * level. Non-premium users see an upgrade CTA inside the
   * Leaderboard and Archive panels themselves, keeping the full
   * three-tab navigation intact regardless of upgrade state.
   */
  const handleTileClick = useCallback((tab: BrowseTab) => {
    if (tab === 'stats') {
      const variant = premiumRef.current
        ? 'premium'
        : sessionWalletRef.current
          ? 'account'
          : 'anon';
      trackEvent({ name: 'stats_opened', variant });
    }
    setBrowseTab(tab);
  }, []);

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

      <SettingsButton
        onClick={() => setShowSettings(true)}
        avatarUrl={profile?.avatarUrl ?? null}
        pfpUrl={pfpUrl}
        seed={pickAvatarSeed({
          handle: profile?.handle,
          wallet: sessionWallet,
          email: profile?.email,
        })}
      />

      <main className="flex-1 flex flex-col items-center px-4 pt-4 pb-6 gap-6">
        <header className="text-center w-full">
          {/* Timer + title row. Grid columns [1fr auto 1fr] keep the
              h1 precisely centered regardless of timer presence —
              filling or vacating the left column doesn't reflow the
              middle column or the subtitle below. Title and subtitle
              stay pinned to the same visual position whether or not
              the timer is visible. */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3">
            <div className="justify-self-end">
              {/* Zen mode hides the timer pill entirely — solve timing
                  still records server-side, it just isn't shown. The
                  grid's [1fr auto 1fr] layout keeps the title
                  centered whether this cell renders the timer or
                  stays empty, so toggling zen mid-play doesn't
                  reflow the wordmark. */}
              {!zen && startedAt != null && !solveResult && (
                <GameTimer startedAt={startedAt} frozenMs={finalSolveMs} />
              )}
            </div>
            <h1 className="text-4xl sm:text-5xl font-black tracking-tight text-gray-900 dark:text-gray-100 inline-block">
              Griddl<span className="relative inline-block">
                e
                {/* Premium-only crown perched on the final 'e'. The crown
                    is the Premium indicator — replaces the diamond that
                    used to live in the subtitle.

                    Transform lives in an inline `style` so the translate
                    and rotate definitely compose into one `transform`
                    value — mixing arbitrary + preset Tailwind transform
                    utilities with `bottom-full` left the crown stuck at
                    the top of the line-box in the Vercel preview,
                    visibly floating above the ascender of "Griddle"
                    rather than perched on the visible top of the 'e'.
                    The translate-y value has to cross both the ascender
                    space (line-height - x-height) AND Phosphor's
                    internal SVG padding, which is why it's larger than
                    a naive "just clear the letter top" would suggest. */}
                {premium && (
                  <Crown
                    className="absolute bottom-full right-0 w-5 h-5 sm:w-6 sm:h-6 text-accent pointer-events-none"
                    style={{ transform: 'translate(25%, 95%) rotate(18deg)' }}
                    weight="fill"
                    aria-hidden
                  />
                )}
              </span>
            </h1>
            <div aria-hidden />
          </div>
          {/* Subtitle = puzzle number + long human date. Previously we
              flipped between "find the 9-letter word" (today) and the
              raw ISO date (archive) — the rule-restatement was noise
              on every load, and the ISO date was ugly. Showing the
              date always pairs naturally with archive play and lets
              the dedicated "How to play" link carry the rules. */}
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mt-1 tabular-nums">
            #{activePuzzle.dayNumber.toString().padStart(3, '0')} · {formatLongDate(activePuzzle.date)}
          </p>
          {/* Today shows "How to play"; archive swaps it for a quick
              return link. Mutually exclusive on purpose — stacking
              both on archive reads as two competing CTAs. */}
          {isArchive ? (
            <button
              type="button"
              onClick={returnToToday}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-brand hover:text-brand-600 transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
            >
              ← Back to today
            </button>
          ) : (
            <button
              type="button"
              onClick={openTutorial}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-brand hover:text-brand-600 transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
            >
              How to play
              <Info className="w-3 h-3" weight="bold" aria-hidden />
            </button>
          )}
        </header>

        {/* Puzzle area behind the Start gate: FoundWords, Grid,
            WordSlots. The gate renders two siblings on top when
            !startedAt: a backdrop-filter overlay that blurs what's
            visible behind it, and the Start button itself. Using
            `backdrop-blur-*` instead of `blur-*` on the content
            avoids the rectangular halo-clip artifact WebKit produces
            when filter: blur hits a container edge.
            pointer-events-none on the inner content blocks tap
            interaction while gated; useGriddle's `disabled` blocks
            keyboard. Backspace / Reset live OUTSIDE this wrapper
            because they carry no puzzle letters — they're just
            disabled pre-Start, not hidden. */}
        <div className="relative w-full flex flex-col items-center gap-6">
          <div
            className={
              startedAt == null
                ? 'w-full flex flex-col items-center gap-6 pointer-events-none select-none'
                : 'w-full flex flex-col items-center gap-6'
            }
            aria-hidden={startedAt == null}
          >
            <FoundWords words={state.foundWords} />

            <Grid
              grid={activePuzzle.grid}
              cellStates={state.cellStates}
              sequenceByCell={state.sequenceByCell}
              path={state.path}
              shakeSignal={state.shakeSignal}
              solved={state.solved}
              onCellTap={actions.tapCell}
              onReorderComplete={handleReorderComplete}
            />

            <WordSlots letters={state.letters} />
          </div>

          {startedAt == null && (
            <>
              {/* Frosted-glass overlay: blurs whatever's behind it via
                  backdrop-filter. Semi-transparent tint layered on top
                  ensures the blur reads as "hidden" and not
                  "accidentally faint" even on a browser that quietly
                  degrades backdrop-filter to a no-op.

                  Dark-mode tint matches the body's `bg-gray-900` — NOT
                  black — so the overlay doesn't create a visibly
                  darker band against the surrounding page. Using
                  `bg-black/50` here layered a near-black rectangle on
                  top of gray-900, which looked like a hard-edged
                  horizontal stripe spanning the full viewport width.

                  The mask-image gradient fades the bottom ~20% of the
                  overlay so the blur + tint don't end in a visible
                  straight line where the WordSlots row ends. Without
                  the mask the cutoff is a pronounced horizontal edge
                  right above the Backspace / Reset row — especially
                  obvious in dark mode where the tint and body tones
                  are close but not identical. `-webkit-mask-image`
                  pair is for Safari, which still needs the vendor
                  prefix for mask-image as of 2026. */}
              <div
                className="absolute inset-0 backdrop-blur-md bg-white/40 dark:bg-gray-900/40 [mask-image:linear-gradient(to_bottom,black_80%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_80%,transparent_100%)]"
                aria-hidden
              />
              <StartGate onStart={handleStart} pending={startPending} />
            </>
          )}
        </div>

        <div className="flex gap-2 mt-1">
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-1.5 !py-2 !px-3 text-sm"
            onClick={actions.backspace}
            disabled={state.pendingSolve || startedAt == null}
          >
            <Backspace className="w-3.5 h-3.5" weight="bold" aria-hidden />
            Backspace
          </button>
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-1.5 !py-2 !px-3 text-sm"
            onClick={actions.reset}
            disabled={state.pendingSolve || startedAt == null}
          >
            <ArrowCounterClockwise className="w-3.5 h-3.5" weight="bold" aria-hidden />
            Reset
          </button>
        </div>

        <HomeTiles onTileClick={handleTileClick} />

        <NextPuzzleCountdown />
      </main>

      <TutorialModal open={showTutorial} onDismiss={dismissTutorial} />

      <BrowseModal
        openTab={browseTab}
        onTabChange={handleTileClick}
        onClose={() => setBrowseTab(null)}
        premium={premium}
        hasSessionProfile={hasSessionProfile}
        profileLoaded={profileLoaded}
        pfpUrl={profile?.avatarUrl ?? pfpUrl}
        username={profile?.handle ?? username}
        email={profile?.email ?? null}
        onCreateProfile={() => { setBrowseTab(null); setShowCreateProfile(true); }}
        onUpgrade={() => {
          setBrowseTab(null);
          trackEvent({ name: 'premium_gate_shown', feature: 'premium' });
          setPremiumGate('premium');
        }}
        todayDayNumber={initialPuzzle.dayNumber}
        leaderboardInitialDay={leaderboardInitialDay}
        onLoadPuzzle={loadArchivePuzzle}
      />

      <SettingsModal
        open={showSettings}
        profile={profile}
        sessionWallet={sessionWallet}
        premium={premium}
        dark={dark}
        onToggleDark={toggleDark}
        zen={zen}
        onToggleZen={toggleZen}
        onProfileChanged={() => { void refetchProfile(); }}
        onUnassistedChanged={setUnassistedMode}
        onClose={() => setShowSettings(false)}
        onCreateProfile={() => { setShowSettings(false); setShowCreateProfile(true); }}
        onConnect={() => { setShowSettings(false); triggerConnect(); }}
        onUpgrade={() => {
          setShowSettings(false);
          trackEvent({ name: 'premium_gate_shown', feature: 'premium' });
          setPremiumGate('premium');
        }}
        onRefreshPremium={() => { if (sessionWallet) void refreshPremium(sessionWallet); }}
      />

      {/* CreateProfileModal rendered at top level — NOT inside StatsModal —
          so its position:fixed overlay escapes the animate-slide-up transform
          that would create a containing block and clip fixed descendants. */}
      {showCreateProfile && (
        <CreateProfileModal
          onClose={() => { setShowCreateProfile(false); setShowSettings(true); }}
          onConnectWallet={() => { setShowCreateProfile(false); triggerConnect(); }}
          onProfileCreated={async () => {
            // Await the refetch BEFORE opening Settings so the modal
            // renders with the new profile already in hand. Firing
            // refetchProfile() fire-and-forget then opening the modal
            // synchronously flashes the anonymous CTA for a frame while
            // the async GET is in flight.
            await refetchProfile();
            setShowCreateProfile(false);
            setShowSettings(true);
          }}
        />
      )}

      {premiumGate !== null && (
        <PremiumGateModal
          feature={premiumGate}
          sessionWallet={sessionWallet}
          forceHostedFiat={inMiniApp}
          onClose={() => setPremiumGate(null)}
          onUnlockCrypto={handleUnlockCrypto}
          onUnlockFiat={handleUnlockFiatHosted}
          onUpgradeClickedFiat={handleUpgradeClickedFiat}
          onFiatCheckoutStarted={handleFiatCheckoutStarted}
          onFiatCheckoutComplete={handleFiatCheckoutComplete}
        />
      )}

      {showCryptoFlow && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fade-in"
          onClick={() => setShowCryptoFlow(false)}
        >
          <div
            className="modal-sheet animate-slide-up"
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
          dayNumber={activePuzzle.dayNumber}
          word={solveResult.word}
          solveMs={solveResult.solveMs}
          unassisted={solveResult.unassisted}
          earnedWordmarks={solveResult.earnedWordmarks}
          currentStreak={solveResult.currentStreak}
          averageMs={solveResult.averageMs}
          percentileRank={solveResult.percentileRank}
          dailyRank={solveResult.dailyRank}
          isPremium={solveResult.isPremium}
          inMiniApp={inMiniApp}
          onClose={() => setSolveResult(null)}
          onOpenLeaderboard={() => {
            // Seed the leaderboard tab with the puzzle that was just
            // solved — critical for archive solves (would otherwise
            // reset to today's leaderboard, which isn't what the user
            // just completed). For today's solve this equals today so
            // it's a no-op relative to the default.
            setLeaderboardInitialDay(activePuzzle.dayNumber);
            setSolveResult(null);
            setBrowseTab('leaderboard');
          }}
          onOpenArchive={() => {
            setSolveResult(null);
            setBrowseTab('archive');
          }}
        />
      )}
    </>
  );
}
