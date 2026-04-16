'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Diamond, Backspace, ArrowCounterClockwise, Info } from '@phosphor-icons/react';
import { useDarkMode } from '@/lib/useDarkMode';
import { Grid } from '@/components/Grid';
import { WordSlots } from '@/components/WordSlots';
import { SolveModal } from '@/components/SolveModal';
import { TutorialModal } from '@/components/TutorialModal';
import { HomeTiles } from '@/components/HomeTiles';
import { FoundWords } from '@/components/FoundWords';
import { BrowseModal, type BrowseTab } from '@/components/BrowseModal';
import { CreateProfileModal } from '@/components/CreateProfileModal';
import { PremiumGateModal } from '@/components/PremiumGateModal';
import { SettingsModal, type ProfileSnapshot } from '@/components/SettingsModal';
import { SettingsButton } from '@/components/SettingsButton';
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

  // Active puzzle — defaults to today's. Archive navigation swaps it.
  const [activePuzzle, setActivePuzzle] = useState<InitialPuzzle>(initialPuzzle);
  const isArchive = activePuzzle.dayNumber !== initialPuzzle.dayNumber;

  const loadArchivePuzzle = useCallback(async (dayNumber: number) => {
    if (dayNumber === initialPuzzle.dayNumber) {
      setActivePuzzle(initialPuzzle);
      return;
    }
    try {
      const res = await fetch(`/api/puzzle/${dayNumber}`);
      if (!res.ok) return;
      const data = (await res.json()) as InitialPuzzle;
      setActivePuzzle(data);
    } catch {/* best-effort */}
  }, [initialPuzzle]);

  const returnToToday = useCallback(() => {
    setActivePuzzle(initialPuzzle);
  }, [initialPuzzle]);

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

  const [solveResult, setSolveResult] = useState<{
    solveMs: number;
    unassisted: boolean;
    word: string;
    earnedWordmarks: string[];
  } | null>(null);

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

  const handleSolved = useCallback(
    (payload: SolvePayload & { unassisted: boolean; word: string }) => {
      // Prefer the server-side duration. The client-side value is only
      // a fallback for the no-puzzle-load edge case (direct POST), and
      // is wrong for any user who reloaded mid-attempt.
      const serverMs = serverSolveMsRef.current;
      setSolveResult({
        solveMs: serverMs != null ? serverMs : payload.clientSolveMs,
        unassisted: payload.unassisted,
        word: payload.word,
        earnedWordmarks: earnedWordmarksRef.current,
      });
      serverSolveMsRef.current = null;
      earnedWordmarksRef.current = [];
    },
    [],
  );

  // Unassisted mode — read from /api/settings on wallet connect. When
  // true, useGriddle suppresses cell-state hints (available / blocked)
  // so the solver gets no adjacency feedback.
  const [unassistedMode, setUnassistedMode] = useState(false);

  const [state, actions] = useGriddle({
    grid: activePuzzle.grid,
    onSolveAttempt: handleSolveAttempt,
    onSolved: handleSolved,
    disabled: showTutorial,
    unassisted: unassistedMode,
  });

  const handlePlayAgain = useCallback(() => {
    setSolveResult(null);
    actions.reset();
  }, [actions]);

  // Reset the grid when the active puzzle changes (archive navigation).
  const prevDayRef = useRef(activePuzzle.dayNumber);
  useEffect(() => {
    if (prevDayRef.current !== activePuzzle.dayNumber) {
      prevDayRef.current = activePuzzle.dayNumber;
      setSolveResult(null);
      actions.reset();
    }
  }, [activePuzzle.dayNumber, actions]);

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
        if (data?.unassistedModeEnabled) setUnassistedMode(true);
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
  // /api/auth/verify). Apply any pending display name from localStorage,
  // refetch the profile, THEN open Settings. Order matters: opening the
  // modal before the refetch resolves flashes the anonymous CTA for a
  // frame while the async GET is in flight. Strip the query param first
  // so a reload can't re-pop this flow.
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

    let pendingUsername: string | null = null;
    try { pendingUsername = localStorage.getItem('griddle:pending-username'); } catch {/* ignore */}

    (async () => {
      if (pendingUsername) {
        try { localStorage.removeItem('griddle:pending-username'); } catch {/* ignore */}
        try {
          await fetch('/api/profile', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ handle: pendingUsername }),
          });
        } catch {/* best-effort */}
      }
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

  const handleUnlockCrypto = useCallback(() => {
    trackEvent({ name: 'upgrade_clicked', method: 'crypto' });
    // checkout_started fires from PremiumCryptoFlow at the actual
    // permit-signed / tx-broadcast moment, not here — otherwise it
    // would be redundant with upgrade_clicked in the same tick and
    // would blend different semantics with the fiat path (which
    // fires started only after Stripe session creation succeeds).
    setShowCryptoFlow(true);
  }, []);

  /**
   * POST to Stripe checkout and redirect. No wallet required —
   * premium binds to the session in Upstash and migrates to a wallet
   * row on first connect. Passing the wallet when available lets the
   * webhook skip the migration step.
   */
  const handleUnlockFiat = useCallback(async () => {
    trackEvent({ name: 'upgrade_clicked', method: 'fiat' });
    // Track whether we've already fired a specific-reason failure so
    // the generic exception handler doesn't double-count in the funnel.
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
        body: JSON.stringify({ wallet: sessionWallet ?? undefined }),
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
      // checkout_started fires right before the redirect — the fiat
      // checkout_completed is emitted server-side from the Stripe
      // webhook so it's not gated on the user returning to the app.
      trackEvent({ name: 'checkout_started', method: 'fiat' });
      window.location.href = data.url;
    } catch (err) {
      emitFailure('exception');
      throw err;
    }
  }, [sessionWallet]);

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
      />

      <main className="flex-1 flex flex-col items-center px-4 pt-10 pb-6 gap-6">
        <header className="text-center">
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight text-gray-900 dark:text-gray-100">
            Griddle
          </h1>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mt-1 tabular-nums flex items-center justify-center gap-1.5">
            <span>
              #{activePuzzle.dayNumber.toString().padStart(3, '0')}
              {isArchive ? ` · ${activePuzzle.date}` : ' · find the 9-letter word'}
            </span>
            {premium && (
              <span className="text-accent inline-flex items-center" title="Premium unlocked">
                <Diamond className="w-3.5 h-3.5" weight="fill" aria-hidden />
              </span>
            )}
          </p>
          {isArchive && (
            <button
              type="button"
              onClick={returnToToday}
              className="text-xs font-semibold text-brand hover:text-brand/80 mt-1 transition-colors"
            >
              ← Back to today\u2019s puzzle
            </button>
          )}
          <button
            type="button"
            onClick={openTutorial}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-accent hover:text-accent/80 transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          >
            How to play
            <Info className="w-3 h-3" weight="bold" aria-hidden />
          </button>
        </header>

        <FoundWords words={state.foundWords} />

        <Grid
          grid={activePuzzle.grid}
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
            className="btn-secondary inline-flex items-center gap-2"
            onClick={actions.backspace}
            disabled={state.pendingSolve}
          >
            <Backspace className="w-4 h-4" weight="bold" aria-hidden />
            Backspace
          </button>
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2"
            onClick={actions.reset}
            disabled={state.pendingSolve}
          >
            <ArrowCounterClockwise className="w-4 h-4" weight="bold" aria-hidden />
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
        onCreateProfile={() => { setBrowseTab(null); setShowCreateProfile(true); }}
        onUpgrade={() => {
          setBrowseTab(null);
          trackEvent({ name: 'premium_gate_shown', feature: 'premium' });
          setPremiumGate('premium');
        }}
        todayDayNumber={initialPuzzle.dayNumber}
        onLoadPuzzle={loadArchivePuzzle}
      />

      <SettingsModal
        open={showSettings}
        profile={profile}
        sessionWallet={sessionWallet}
        premium={premium}
        dark={dark}
        onToggleDark={toggleDark}
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
          onClose={() => setPremiumGate(null)}
          onUnlockCrypto={handleUnlockCrypto}
          onUnlockFiat={handleUnlockFiat}
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
          grid={activePuzzle.grid}
          solveMs={solveResult.solveMs}
          unassisted={solveResult.unassisted}
          earnedWordmarks={solveResult.earnedWordmarks}
          inMiniApp={inMiniApp}
          onPlayAgain={handlePlayAgain}
          onClose={() => setSolveResult(null)}
        />
      )}
    </>
  );
}
